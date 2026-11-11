import { logger } from '../lib/logger.ts';
import {
  isToolAuthorizedForRole,
  verifyAppointmentOwnership,
} from '../security/authorization.ts';
import type { IsolatedTenantDatabase } from '../services/tenant-database-router.ts';
import type {
  ActorContext,
  IntegrationRecord,
  ToolCallRequest,
  ToolExecutionResult,
} from '../types/index.ts';
import {
  confirmationStore,
  parseConfirmationDecision,
} from './confirmation-store.ts';
import { buildMinimizedContext } from './context-builder.ts';
import {
  buildAdversarialRefusalReply,
  buildAmbiguousOrGreetingReply,
  buildMissingBookingParamsReply,
} from './conversation-policy.ts';
import { aiEvaluation } from './evaluation.ts';
import { classifyMessageIntent } from './intent-router.ts';
import { defaultGeminiAdapter, type LLMProvider } from './provider-adapter.ts';
import { validateAndSanitizeAIResponse } from './response-validator.ts';
import { getToolDeclarationByName } from './tool-registry.ts';

export interface OrchestrateAIParams {
  readonly correlationId: string;
  readonly integration: IntegrationRecord;
  readonly actor: ActorContext;
  readonly tenantDb: IsolatedTenantDatabase;
  readonly userMessage: string;
  readonly provider?: LLMProvider;
}

export interface OrchestrateAIResult {
  readonly replyText: string;
  readonly executedToolResult?: ToolExecutionResult;
  readonly blockedBySecurity: boolean;
}

/**
 * Pré-valida permissão de perfil e propriedade do recurso (anti-IDOR) ANTES
 * de abrir estado de confirmação ou executar escrita no banco.
 */
function prevalidateToolAccessAndOwnership(params: {
  actor: ActorContext;
  tenantDb: IsolatedTenantDatabase;
  toolCall: ToolCallRequest;
}): ToolExecutionResult | null {
  const { actor, tenantDb, toolCall } = params;

  if (!isToolAuthorizedForRole(actor.role, toolCall.name)) {
    return {
      success: false,
      toolName: toolCall.name,
      errorCode: 'UNAUTHORIZED_ROLE',
      message: `Operação '${toolCall.name}' não autorizada para o perfil '${actor.role}'.`,
    };
  }

  if (
    toolCall.name === 'request_cancellation' ||
    toolCall.name === 'request_reschedule'
  ) {
    const appointmentId = String(toolCall.args.appointment_id ?? '');
    const existing = tenantDb.getAppointmentById(appointmentId);
    if (!existing) {
      return {
        success: false,
        toolName: toolCall.name,
        errorCode: 'NOT_FOUND',
        message: 'Agendamento não encontrado no banco desta empresa.',
      };
    }

    if (!verifyAppointmentOwnership(actor, existing)) {
      return {
        success: false,
        toolName: toolCall.name,
        errorCode: 'RESOURCE_OWNERSHIP_VIOLATION',
        message:
          'Acesso negado: você só pode cancelar ou alterar agendamentos vinculados ao seu próprio número de telefone.',
      };
    }
  }

  return null;
}

/**
 * Executa de forma determinística no backend a ferramenta sugerida pelo `clientflow-ai`,
 * revalidando perfil, propriedade do recurso e operando estritamente no banco da empresa.
 */
export async function executeValidatedDomainTool(params: {
  actor: ActorContext;
  tenantDb: IsolatedTenantDatabase;
  toolCall: ToolCallRequest;
}): Promise<ToolExecutionResult> {
  const { actor, tenantDb, toolCall } = params;

  const prevalidationError = prevalidateToolAccessAndOwnership(params);
  if (prevalidationError) {
    return prevalidationError;
  }

  switch (toolCall.name) {
    case 'list_services': {
      const services = tenantDb.listServices();
      const formatted = services
        .map(
          (s) =>
            `• *${s.name}* (${s.durationMinutes} min) — R$ ${(
              s.priceCents / 100
            ).toFixed(2)}`
        )
        .join('\n');
      return {
        success: true,
        toolName: 'list_services',
        data: services,
        message: `Serviços disponíveis:\n${formatted}`,
      };
    }

    case 'list_available_slots': {
      const date = String(toolCall.args.date ?? '2026-11-10');
      const serviceId = toolCall.args.service_id
        ? String(toolCall.args.service_id)
        : undefined;
      const slots = tenantDb.listAvailableSlots(date, serviceId);
      return {
        success: true,
        toolName: 'list_available_slots',
        data: { date, slots },
        message:
          slots.length > 0
            ? `Horários livres em ${date}: ${slots.join(', ')}.`
            : `Não há horários livres na data ${date}.`,
      };
    }

    case 'get_business_info': {
      const info = tenantDb.getBusinessPublicInfo();
      const lines = [
        `*${info.empresa}* — ${info.sobreTexto}`,
        `📍 Endereço: ${info.endereco}`,
      ];
      if (info.instagram) lines.push(`📸 Instagram: ${info.instagram}`);
      if (info.chavePix) lines.push(`💠 Chave PIX: ${info.chavePix}`);
      return {
        success: true,
        toolName: 'get_business_info',
        data: info,
        message: lines.join('\n'),
      };
    }

    case 'request_booking': {
      const serviceId = String(toolCall.args.service_id ?? '');
      const date = String(toolCall.args.date ?? '');
      const time = String(toolCall.args.time ?? '');
      const clientName = String(
        toolCall.args.client_name ?? actor.displayName ?? 'Cliente'
      );
      return tenantDb.createBookingAtomic({
        actor,
        serviceId,
        date,
        time,
        clientName,
        origin: 'whatsapp',
      });
    }

    case 'request_cancellation': {
      const appointmentId = String(toolCall.args.appointment_id ?? '');
      return tenantDb.cancelAppointmentAtomic({
        actor,
        appointmentId,
      });
    }

    case 'request_reschedule': {
      const appointmentId = String(toolCall.args.appointment_id ?? '');
      const newDate = String(toolCall.args.new_date ?? '');
      const newTime = String(toolCall.args.new_time ?? '');
      return tenantDb.rescheduleAppointmentAtomic({
        actor,
        appointmentId,
        newDate,
        newTime,
      });
    }

    case 'get_daily_schedule': {
      const date = String(toolCall.args.date ?? '2026-11-10');
      const items = tenantDb.getDailySchedule(date);
      const summary =
        items.length > 0
          ? items
              .map(
                (a) =>
                  `• ${a.time} — ${a.clientName ?? a.blockReason ?? 'Reservado'} (${a.status})`
              )
              .join('\n')
          : 'Nenhum compromisso registrado nesta data.';
      return {
        success: true,
        toolName: 'get_daily_schedule',
        data: items,
        message: `Agenda de ${date}:\n${summary}`,
      };
    }

    case 'get_financial_goal_status': {
      const period = String(toolCall.args.period ?? '2026-11');
      const goal = tenantDb.getFinancialGoalStatus(period);
      return {
        success: true,
        toolName: 'get_financial_goal_status',
        data: goal,
        message: `Meta financeira (${period}): R$ ${(
          goal.achievedCents / 100
        ).toFixed(2)} de R$ ${(goal.targetCents / 100).toFixed(2)} (${
          goal.completionPercentage
        }%).`,
      };
    }

    case 'request_block_schedule_slot': {
      const date = String(toolCall.args.date ?? '');
      const time = String(toolCall.args.time ?? '');
      const reason = String(toolCall.args.reason ?? 'Bloqueio administrativo');
      return tenantDb.blockScheduleSlotAtomic({
        actor,
        date,
        time,
        reason,
      });
    }

    case 'get_business_summary': {
      const period = String(toolCall.args.period ?? '2026-11');
      const summary = tenantDb.getBusinessSummary(period);
      return {
        success: true,
        toolName: 'get_business_summary',
        data: summary,
        message: `Resumo operacional (${period}): ${
          summary.totalAppointments
        } confirmados, ${
          summary.cancelledAppointments
        } cancelados, receita estimada R$ ${(
          summary.estimatedRevenueCents / 100
        ).toFixed(2)}.`,
      };
    }
  }
}

/**
 * Orquestrador principal do `clientflow-ai` (Ciclo Seguro de Function Calling em 8 Etapas).
 */
export async function orchestrateClientFlowAI(
  params: OrchestrateAIParams
): Promise<OrchestrateAIResult> {
  const startTime = Date.now();
  const provider = params.provider ?? defaultGeminiAdapter;
  const services = params.tenantDb.listServices();

  // Etapa 1 e 2: Contexto minimizado e catálogo de ferramentas segregado por perfil
  const context = buildMinimizedContext({
    integration: params.integration,
    actor: params.actor,
    services,
    rawUserMessage: params.userMessage,
  });

  // Verifica se há uma operação pendente de confirmação explícita ("SIM" / "NÃO") para este usuário nesta organização
  const pendingConfirmation = confirmationStore.getPending(
    params.integration.organizationId,
    params.actor.phoneE164
  );
  const decision = parseConfirmationDecision(params.userMessage);

  if (pendingConfirmation && decision !== null) {
    confirmationStore.consumePending(
      params.integration.organizationId,
      params.actor.phoneE164
    );

    if (decision === 'reject') {
      return {
        replyText:
          'Operação cancelada conforme solicitado. Nenhuma alteração foi realizada.',
        blockedBySecurity: false,
      };
    }

    // Revalida permissões e executa a operação agora confirmada pelo usuário
    const confirmedResult = await executeValidatedDomainTool({
      actor: params.actor,
      tenantDb: params.tenantDb,
      toolCall: pendingConfirmation.toolCall,
    });

    const formattedReply = await provider.formatToolResultReply(
      context,
      confirmedResult
    );
    const validated = validateAndSanitizeAIResponse(
      formattedReply,
      confirmedResult
    );

    return {
      replyText: validated.sanitizedResponse,
      executedToolResult: confirmedResult,
      blockedBySecurity: !validated.valid,
    };
  }

  const intentCheck = classifyMessageIntent(params.userMessage);
  if (intentCheck.isAdversarial) {
    logger.log({
      level: 'security',
      correlationId: params.correlationId,
      event: 'ai.prompt_injection_blocked',
      organizationId: params.integration.organizationId,
      integrationId: params.integration.integrationId,
      actorRole: params.actor.role,
      operationStatus: 'denied',
      metadata: {
        reason: intentCheck.adversarialReason,
      },
    });

    const safeRefusal = buildAdversarialRefusalReply(params.integration);
    aiEvaluation.recordMetric({
      correlationId: params.correlationId,
      organizationId: params.integration.organizationId,
      providerName: provider.providerName,
      latencyMs: Date.now() - startTime,
      estimatedInputTokens: context.sanitizedUserMessage.length / 4,
      estimatedOutputTokens: safeRefusal.length / 4,
      securityBlocked: true,
    });

    return {
      replyText: safeRefusal,
      blockedBySecurity: true,
    };
  }

  const adminIntents = new Set([
    'get_daily_schedule',
    'get_financial_goal_status',
    'request_block_schedule_slot',
    'get_business_summary',
  ]);
  if (params.actor.role === 'client' && adminIntents.has(intentCheck.intent)) {
    logger.log({
      level: 'security',
      correlationId: params.correlationId,
      event: 'ai.unauthorized_admin_intent_by_client',
      organizationId: params.integration.organizationId,
      integrationId: params.integration.integrationId,
      actorRole: params.actor.role,
      toolName: intentCheck.intent,
      operationStatus: 'denied',
    });

    return {
      replyText:
        'Acesso negado: esta consulta é restrita a profissionais e administradores autenticados da empresa.',
      blockedBySecurity: true,
    };
  }

  try {
    // Etapa 3: Invoca o adaptador de modelo (Gemini)
    const inference = await provider.inferToolOrReply(
      context,
      params.userMessage,
      services
    );

    if (!inference.suggestedToolCall) {
      const reply =
        intentCheck.intent === 'request_booking'
          ? buildMissingBookingParamsReply(params.integration)
          : buildAmbiguousOrGreetingReply(params.integration);

      return {
        replyText: reply,
        blockedBySecurity: false,
      };
    }

    // Etapa 4: Pré-validação de autorização e propriedade (bloqueia IDOR imediatamente)
    const prevalidationError = prevalidateToolAccessAndOwnership({
      actor: params.actor,
      tenantDb: params.tenantDb,
      toolCall: inference.suggestedToolCall,
    });

    if (prevalidationError) {
      const deniedReply = await provider.formatToolResultReply(
        context,
        prevalidationError
      );
      return {
        replyText: deniedReply,
        executedToolResult: prevalidationError,
        blockedBySecurity:
          prevalidationError.errorCode === 'UNAUTHORIZED_ROLE' ||
          prevalidationError.errorCode === 'RESOURCE_OWNERSHIP_VIOLATION',
      };
    }

    // Etapa 5: Se a ferramenta exigir confirmação explícita (`requiresConfirmation: true`), registra pendência e pede "SIM/NÃO"
    const toolDecl = getToolDeclarationByName(inference.suggestedToolCall.name);
    if (toolDecl?.requiresConfirmation) {
      const summaryText = `Confirma a execução de *${inference.suggestedToolCall.name}*? Responda *SIM* para confirmar ou *NÃO* para cancelar.`;
      confirmationStore.setPending({
        organizationId: params.integration.organizationId,
        actorPhoneE164: params.actor.phoneE164,
        toolCall: inference.suggestedToolCall,
        summaryText,
      });

      const pendingResult: ToolExecutionResult = {
        success: false,
        toolName: inference.suggestedToolCall.name,
        errorCode: 'CONFIRMATION_REQUIRED',
        message: summaryText,
      };

      return {
        replyText: summaryText,
        executedToolResult: pendingResult,
        blockedBySecurity: false,
      };
    }

    // Etapa 6: O serviço de domínio no backend executa a operação transacional no banco individual da empresa
    const toolResult = await executeValidatedDomainTool({
      actor: params.actor,
      tenantDb: params.tenantDb,
      toolCall: inference.suggestedToolCall,
    });

    // Etapa 7: Resultado real devolvido ao modelo para formulação da resposta
    const candidateReply = await provider.formatToolResultReply(
      context,
      toolResult
    );

    // Etapa 8: Auditoria de saída pelo `response-validator`
    const validated = validateAndSanitizeAIResponse(candidateReply, toolResult);

    aiEvaluation.recordMetric({
      correlationId: params.correlationId,
      organizationId: params.integration.organizationId,
      providerName: provider.providerName,
      latencyMs: Date.now() - startTime,
      estimatedInputTokens: Math.ceil(context.systemInstruction.length / 4),
      estimatedOutputTokens: Math.ceil(validated.sanitizedResponse.length / 4),
      toolSuggested: inference.suggestedToolCall.name,
      securityBlocked: !validated.valid,
    });

    return {
      replyText: validated.sanitizedResponse,
      executedToolResult: toolResult,
      blockedBySecurity: !validated.valid,
    };
  } catch (error) {
    logger.log({
      level: 'error',
      correlationId: params.correlationId,
      event: 'ai.provider_failure_safe_fallback',
      organizationId: params.integration.organizationId,
      integrationId: params.integration.integrationId,
      actorRole: params.actor.role,
      operationStatus: 'error',
      metadata: {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return {
      replyText: `No momento nosso assistente automático da *${params.integration.organizationName}* está temporariamente indisponível. Nenhuma alteração foi realizada no seu agendamento. Por favor, tente novamente em alguns instantes.`,
      blockedBySecurity: false,
    };
  }
}
