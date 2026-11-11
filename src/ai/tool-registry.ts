import type { ActorRole, ToolDeclaration, ToolName } from '../types/index.ts';

/**
 * Catálogo estrito de ferramentas do `clientflow-ai`.
 * Regra de Segurança:
 * - Quando o perfil autenticado for `client`, as definições de ferramentas administrativas
 *   (`get_daily_schedule`, `get_financial_goal_status`, `request_block_schedule_slot`, `get_business_summary`)
 *   NÃO são sequer incluídas no contexto enviado ao modelo.
 */

const ALL_TOOLS: readonly ToolDeclaration[] = [
  // Catálogo Cliente Final
  {
    name: 'list_services',
    description:
      'Lista os serviços ativos publicados pela empresa com duração e preço.',
    allowedRoles: ['client', 'professional', 'admin'],
    requiresConfirmation: false,
    parametersSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_available_slots',
    description:
      'Consulta os horários disponíveis para agendamento em uma data específica (YYYY-MM-DD).',
    allowedRoles: ['client', 'professional', 'admin'],
    requiresConfirmation: false,
    parametersSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
        service_id: {
          type: 'string',
          description: 'Identificador opcional do serviço',
        },
      },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_business_info',
    description:
      'Consulta informações públicas da empresa nas tabelas configuracoes1 e dados_barbearia (endereço, chave PIX, Instagram e texto sobre).',
    allowedRoles: ['client', 'professional', 'admin'],
    requiresConfirmation: false,
    parametersSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'request_booking',
    description:
      'Solicita a reserva de um horário para o cliente autenticado na empresa atual.',
    allowedRoles: ['client'],
    requiresConfirmation: false,
    parametersSchema: {
      type: 'object',
      properties: {
        service_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:mm' },
        client_name: { type: 'string' },
      },
      required: ['service_id', 'date', 'time', 'client_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_cancellation',
    description:
      'Solicita o cancelamento de um agendamento pertencente ao cliente autenticado.',
    allowedRoles: ['client'],
    requiresConfirmation: true,
    parametersSchema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string' },
      },
      required: ['appointment_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_reschedule',
    description:
      'Solicita a remarcação de um agendamento pertencente ao cliente autenticado.',
    allowedRoles: ['client'],
    requiresConfirmation: true,
    parametersSchema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string' },
        new_date: { type: 'string' },
        new_time: { type: 'string' },
      },
      required: ['appointment_id', 'new_date', 'new_time'],
      additionalProperties: false,
    },
  },

  // Catálogo Profissional / Administrador
  {
    name: 'get_daily_schedule',
    description:
      'Consulta a agenda operacional completa de uma data (exclusivo para profissional/admin autenticado).',
    allowedRoles: ['professional', 'admin'],
    requiresConfirmation: false,
    parametersSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_financial_goal_status',
    description:
      'Consulta o progresso da meta financeira do período (exclusivo para profissional/admin autenticado).',
    allowedRoles: ['professional', 'admin'],
    requiresConfirmation: false,
    parametersSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Ex: 2026-11' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_block_schedule_slot',
    description:
      'Bloqueia um horário na agenda da empresa por motivo operacional ou folga (exclusivo para profissional/admin).',
    allowedRoles: ['professional', 'admin'],
    requiresConfirmation: true,
    parametersSchema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        time: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['date', 'time', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_business_summary',
    description:
      'Retorna o resumo operacional e receita estimada da empresa no período (exclusivo para administrador).',
    allowedRoles: ['admin'],
    requiresConfirmation: false,
    parametersSchema: {
      type: 'object',
      properties: {
        period: { type: 'string' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
];

export function getAuthorizedToolCatalog(
  role: ActorRole
): readonly ToolDeclaration[] {
  return ALL_TOOLS.filter((tool) => tool.allowedRoles.includes(role));
}

export function getToolDeclarationByName(
  name: ToolName
): ToolDeclaration | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}
