import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { orchestrateClientFlowAI } from '../src/ai/index.ts';
import { logger } from '../src/lib/logger.ts';
import { resolveActorContext } from '../src/security/authorization.ts';
import { idempotencyStore } from '../src/security/idempotency.ts';
import { validateWebhookSignature } from '../src/security/signature-validation.ts';
import { resolveIntegrationByPhoneNumberId } from '../src/services/integration-resolver.ts';
import { SupabaseTenantRestClient } from '../src/services/supabase-tenant-client.ts';
import { resolveTenantDatabase } from '../src/services/tenant-database-router.ts';
import { verifyWebhookSubscription } from '../src/services/webhook-verification.ts';
import { sendWhatsAppMessage } from '../src/services/whatsapp-messaging.ts';
import type { MetaWebhookPayload } from '../src/types/index.ts';

export interface WebhookHttpRequest {
  readonly method: 'GET' | 'POST' | string;
  readonly query?: Record<string, string | undefined>;
  readonly headers: Record<string, string | undefined>;
  readonly rawBody?: Buffer | string;
}

export interface WebhookHttpResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const DEFAULT_APP_SECRET =
  process.env.META_APP_SECRET ?? 'change_me_meta_app_secret_for_hmac_sha256';
const DEFAULT_VERIFY_TOKEN =
  process.env.META_WEBHOOK_VERIFY_TOKEN ?? 'change_me_webhook_verify_token';

/**
 * Handler oficial do Webhook Meta (`api/webhook.ts`) seguindo as 11 etapas obrigatórias:
 * 1. GET Verification Challenge
 * 2. Preservação do Raw Body no POST
 * 3. Validação criptográfica HMAC-SHA256 (`X-Hub-Signature-256`)
 * 4. Validação estrutural e telemetria de status/tarifação (`statuses` -> `pricing`)
 * 5. Controle atômico de idempotência (`wamid`)
 * 6. Resolução da integração pelo `phone_number_id` no Cadastro Central
 * 7. Roteamento para o banco operacional individual da empresa (`tenant-database-router`)
 * 8. Autenticação e autorização determinística do ator (`authorization.ts`)
 * 9. Orquestração segura com `clientflow-ai`
 * 10. Execução validada de ferramentas no banco da empresa
 * 11. Despacho via WhatsApp Cloud API com a credencial exclusiva da empresa
 */
export async function handleWebhookRequest(
  req: WebhookHttpRequest,
  config?: {
    appSecret?: string;
    verifyToken?: string;
  }
): Promise<WebhookHttpResponse> {
  const correlationId = `corr_${crypto.randomUUID().slice(0, 12)}`;
  const appSecret = config?.appSecret ?? DEFAULT_APP_SECRET;
  const verifyToken = config?.verifyToken ?? DEFAULT_VERIFY_TOKEN;

  // Etapa 1: Verificação inicial do Webhook (GET)
  if (req.method === 'GET') {
    const verification = verifyWebhookSubscription(
      {
        mode: req.query?.['hub.mode'],
        verifyToken: req.query?.['hub.verify_token'],
        challenge: req.query?.['hub.challenge'],
      },
      verifyToken
    );

    return {
      statusCode: verification.statusCode,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: verification.body,
    };
  }

  if (req.method !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  // Etapa 2 e 3: Preservação do Raw Body e Validação de Assinatura X-Hub-Signature-256
  const rawBody = req.rawBody ?? '';
  const signatureHeader =
    req.headers['x-hub-signature-256'] ?? req.headers['X-Hub-Signature-256'];

  if (!validateWebhookSignature(rawBody, signatureHeader, appSecret)) {
    logger.log({
      level: 'security',
      correlationId,
      event: 'webhook.signature_validation_failed',
      operationStatus: 'denied',
      metadata: {
        hasSignatureHeader: Boolean(signatureHeader),
      },
    });

    return {
      statusCode: 401,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        error: 'Unauthorized: Invalid X-Hub-Signature-256',
      }),
    };
  }

  // Etapa 4: Validação estrutural do payload JSON
  let payload: MetaWebhookPayload;
  try {
    const rawString = Buffer.isBuffer(rawBody)
      ? rawBody.toString('utf8')
      : rawBody;
    payload = JSON.parse(rawString) as MetaWebhookPayload;
  } catch {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Bad Request: Malformed JSON body' }),
    };
  }

  if (payload.object !== 'whatsapp_business_account' || !payload.entry) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Unsupported webhook object type' }),
    };
  }

  const results: Array<Record<string, unknown>> = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;

      // Etapa 6: Resolução da integração exclusivamente via `phone_number_id` no Cadastro Central
      const integration = resolveIntegrationByPhoneNumberId(phoneNumberId);
      if (!integration) {
        logger.log({
          level: 'security',
          correlationId,
          event: 'webhook.integration_not_found_or_revoked',
          operationStatus: 'denied',
          metadata: {
            phoneNumberId: phoneNumberId ?? 'missing',
          },
        });

        return {
          statusCode: 403,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            error:
              'Forbidden: Integration not found, inactive, or revoked in Central Registry',
          }),
        };
      }

      // Tratamento de eventos de status/faturamento da Meta (`statuses` -> `pricing`)
      if (value.statuses && value.statuses.length > 0) {
        for (const statusEvent of value.statuses) {
          logger.log({
            level: 'info',
            correlationId,
            event: 'webhook.status_pricing_telemetry',
            organizationId: integration.organizationId,
            integrationId: integration.integrationId,
            operationStatus: statusEvent.status,
            metadata: {
              messageId: statusEvent.id,
              billable: statusEvent.pricing?.billable ?? false,
              category: statusEvent.pricing?.category ?? 'service',
              pricingModel: statusEvent.pricing?.pricing_model ?? 'CBP',
            },
          });
        }
      }

      // Processamento de mensagens recebidas
      for (const message of value.messages ?? []) {
        // Etapa 5: Controle atômico de idempotência por `message.id` (`wamid`) e organização
        const acquired = idempotencyStore.tryAcquireMessageLock(
          message.id,
          integration.organizationId
        );

        if (!acquired) {
          logger.log({
            level: 'info',
            correlationId,
            event: 'webhook.duplicate_message_ignored',
            organizationId: integration.organizationId,
            integrationId: integration.integrationId,
            operationStatus: 'deduplicated',
            metadata: {
              messageId: message.id,
            },
          });

          results.push({
            messageId: message.id,
            organizationId: integration.organizationId,
            status: 'duplicate_ignored',
          });
          continue;
        }

        // Etapa 7: Roteamento seguro para o Banco Operacional Individual da Empresa
        const tenantDb = resolveTenantDatabase(integration);
        if (
          integration.supabaseProjectUrl &&
          integration.organizationId === 'org_alpha' &&
          Boolean(process.env.SUPABASE_SERVICE_KEY_ORG_ALPHA) &&
          process.env.NODE_ENV !== 'test'
        ) {
          const liveClient = new SupabaseTenantRestClient({
            ...integration,
            dbSecretReference: 'secret_ref:supabase:org_alpha',
          });
          tenantDb.attachLiveSupabaseClient(liveClient);
          await tenantDb.syncFromLiveSupabase();
        }

        // Etapa 8: Autenticação e Autorização de Domínio no banco daquela empresa
        const contactName = value.contacts?.[0]?.profile?.name;
        const actor = resolveActorContext(
          integration.organizationId,
          message.from,
          tenantDb.getStaffMembers(),
          contactName
        );

        const userText =
          message.type === 'text' && message.text?.body
            ? message.text.body
            : '';

        if (!userText) {
          const unsupportedReply = `Olá! No momento o atendimento automático da *${integration.organizationName}* processa apenas mensagens de texto. Por favor, envie sua solicitação por escrito.`;
          await sendWhatsAppMessage({
            correlationId,
            integration,
            recipientPhone: message.from,
            text: unsupportedReply,
            withinCustomerServiceWindow: true,
          });
          results.push({
            messageId: message.id,
            organizationId: integration.organizationId,
            replyText: unsupportedReply,
          });
          continue;
        }

        // Etapas 9 e 10: Orquestração com `clientflow-ai` e execução validada no banco da empresa
        const aiResult = await orchestrateClientFlowAI({
          correlationId,
          integration,
          actor,
          tenantDb,
          userMessage: userText,
        });

        // Etapa 11: Despacho via WhatsApp Cloud API usando a credencial exclusiva da empresa
        const delivery = await sendWhatsAppMessage({
          correlationId,
          integration,
          recipientPhone: message.from,
          text: aiResult.replyText,
          withinCustomerServiceWindow: true,
        });

        results.push({
          messageId: message.id,
          organizationId: integration.organizationId,
          actorRole: actor.role,
          replyText: aiResult.replyText,
          toolExecuted: aiResult.executedToolResult?.toolName ?? null,
          toolSuccess: aiResult.executedToolResult?.success ?? null,
          blockedBySecurity: aiResult.blockedBySecurity,
          deliveryChannel: delivery.channel,
        });
      }
    }
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      correlationId,
      processed: results,
    }),
  };
}

/**
 * Desativa o bodyParser padrão da Vercel para preservar os bytes exatos do payload
 * necessários para a validação criptográfica `X-Hub-Signature-256` (HMAC-SHA256).
 */
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Entrypoint oficial para Vercel Serverless Functions (`GET /api/webhook` e `POST /api/webhook`).
 */
export default async function vercelWebhookHandler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const host = req.headers.host ?? 'localhost';
  const parsedUrl = new URL(req.url ?? '/api/webhook', `https://${host}`);
  const query: Record<string, string | undefined> = {};
  parsedUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks);

  const normalizedHeaders: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    normalizedHeaders[key.toLowerCase()] = Array.isArray(value)
      ? value.join(', ')
      : value;
  }

  const response = await handleWebhookRequest({
    method: req.method ?? 'GET',
    query,
    headers: normalizedHeaders,
    rawBody,
  });

  res.writeHead(response.statusCode, response.headers);
  res.end(response.body);
}
