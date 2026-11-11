import type {
  ActorContext,
  ActorRole,
  AppointmentRecord,
  StaffMember,
  ToolName,
} from '../types/index.ts';

const CLIENT_ALLOWED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'list_services',
  'list_available_slots',
  'get_business_info',
  'request_booking',
  'request_cancellation',
  'request_reschedule',
]);

const PROFESSIONAL_ALLOWED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'list_services',
  'list_available_slots',
  'get_business_info',
  'get_daily_schedule',
  'get_financial_goal_status',
  'request_block_schedule_slot',
]);

const ADMIN_ALLOWED_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'list_services',
  'list_available_slots',
  'get_business_info',
  'get_daily_schedule',
  'get_financial_goal_status',
  'request_block_schedule_slot',
  'get_business_summary',
]);

export function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/**
 * Resolve de forma determinística a identidade e o papel do remetente
 * consultando exclusivamente a tabela de profissionais ativos do banco daquela empresa.
 * Regra: O telefone só concede papel profissional/admin se estiver ativo E com vínculo verificado (`verifiedAt != null`).
 */
export function resolveActorContext(
  organizationId: string,
  senderPhone: string,
  staffMembers: readonly StaffMember[],
  profileName?: string
): ActorContext {
  const normalizedPhone = normalizePhoneE164(senderPhone);

  const matchedStaff = staffMembers.find(
    (s) => normalizePhoneE164(s.phoneE164) === normalizedPhone
  );

  if (matchedStaff && matchedStaff.isActive && matchedStaff.verifiedAt !== null) {
    return {
      organizationId,
      phoneE164: normalizedPhone,
      role: matchedStaff.role,
      staffId: matchedStaff.staffId,
      displayName: matchedStaff.fullName,
      isVerifiedStaff: true,
    };
  }

  return {
    organizationId,
    phoneE164: normalizedPhone,
    role: 'client',
    displayName: profileName ?? 'Cliente',
    isVerifiedStaff: false,
  };
}

/**
 * Verifica no backend se o perfil autenticado tem permissão para invocar a ferramenta.
 */
export function isToolAuthorizedForRole(
  role: ActorRole,
  toolName: ToolName
): boolean {
  if (role === 'admin') {
    return ADMIN_ALLOWED_TOOLS.has(toolName);
  }
  if (role === 'professional') {
    return PROFESSIONAL_ALLOWED_TOOLS.has(toolName);
  }
  return CLIENT_ALLOWED_TOOLS.has(toolName);
}

/**
 * Previne IDOR (Insecure Direct Object Reference):
 * Um cliente final só pode cancelar ou reagendar um agendamento que pertença
 * ao seu próprio telefone autenticado e dentro da mesma organização.
 */
export function verifyAppointmentOwnership(
  actor: ActorContext,
  appointment: AppointmentRecord
): boolean {
  if (actor.role === 'admin' || actor.role === 'professional') {
    return actor.isVerifiedStaff;
  }

  if (!appointment.clientPhone) {
    return false;
  }

  return (
    normalizePhoneE164(appointment.clientPhone) ===
    normalizePhoneE164(actor.phoneE164)
  );
}
