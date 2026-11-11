import type { IntegrationRecord } from '../types/index.ts';

/**
 * Cadastro Central de Integrações (Control Plane).
 * Regra Inegociável:
 * - Armazena APENAS metadados de roteamento (`integrationId`, `organizationId`, `wabaId`, `phoneNumberId`, `secretReference`, `status`).
 * - NUNCA armazena dados operacionais das empresas.
 * - O `organizationId` é resolvido exclusivamente pelo `phoneNumberId` destinatário validado no webhook.
 */

const CENTRAL_INTEGRATION_REGISTRY = new Map<string, IntegrationRecord>([
  [
    'phone_id_org_alpha_101',
    {
      integrationId: 'int_alpha_001',
      organizationId: 'org_alpha',
      organizationName: 'Barbearia Alpha',
      segment: 'barbershop',
      wabaId: 'waba_alpha_9001',
      phoneNumberId: 'phone_id_org_alpha_101',
      secretReference: 'secret_ref:waba:org_alpha',
      dbSecretReference: 'secret_ref:db:org_alpha',
      supabaseProjectUrl: process.env.SUPABASE_URL_ORG_ALPHA,
      status: 'active',
      createdAt: '2026-10-01T10:00:00Z',
      updatedAt: '2026-11-01T10:00:00Z',
      revokedAt: null,
    },
  ],
  [
    'phone_id_org_beta_202',
    {
      integrationId: 'int_beta_002',
      organizationId: 'org_beta',
      organizationName: 'Clínica Estética Beta',
      segment: 'clinic',
      wabaId: 'waba_beta_9002',
      phoneNumberId: 'phone_id_org_beta_202',
      secretReference: 'secret_ref:waba:org_beta',
      dbSecretReference: 'secret_ref:db:org_beta',
      status: 'active',
      createdAt: '2026-10-05T10:00:00Z',
      updatedAt: '2026-11-01T10:00:00Z',
      revokedAt: null,
    },
  ],
  [
    'phone_id_org_revoked_999',
    {
      integrationId: 'int_revoked_999',
      organizationId: 'org_revoked',
      organizationName: 'Estúdio Inativo',
      segment: 'studio',
      wabaId: 'waba_revoked_999',
      phoneNumberId: 'phone_id_org_revoked_999',
      secretReference: 'secret_ref:waba:org_revoked',
      dbSecretReference: 'secret_ref:db:org_revoked',
      status: 'revoked',
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-10-15T10:00:00Z',
      revokedAt: '2026-10-15T10:00:00Z',
    },
  ],
]);

/**
 * Resolve a integração a partir do `phone_number_id` recebido no webhook.
 * Fail-Closed: Se não existir, não estiver `active` ou possuir `revokedAt`, recusa imediatamente.
 */
export function resolveIntegrationByPhoneNumberId(
  phoneNumberId: string | undefined
): IntegrationRecord | null {
  if (!phoneNumberId || typeof phoneNumberId !== 'string') {
    return null;
  }

  const normalizedPhoneId = phoneNumberId.trim();

  // Permite usar o phone_number_id real da Meta configurado na Vercel via variável de ambiente
  const envAlphaPhoneId = process.env.META_PHONE_NUMBER_ID_ORG_ALPHA?.trim();
  if (envAlphaPhoneId && normalizedPhoneId === envAlphaPhoneId) {
    const alphaTemplate = CENTRAL_INTEGRATION_REGISTRY.get(
      'phone_id_org_alpha_101'
    );
    if (
      alphaTemplate &&
      alphaTemplate.status === 'active' &&
      alphaTemplate.revokedAt === null
    ) {
      return {
        ...alphaTemplate,
        phoneNumberId: envAlphaPhoneId,
        wabaId: process.env.META_WABA_ID_ORG_ALPHA?.trim() || alphaTemplate.wabaId,
        supabaseProjectUrl:
          process.env.SUPABASE_URL_ORG_ALPHA?.trim() ||
          alphaTemplate.supabaseProjectUrl,
      };
    }
  }

  const record = CENTRAL_INTEGRATION_REGISTRY.get(normalizedPhoneId);
  if (!record) {
    return null;
  }

  if (record.status !== 'active' || record.revokedAt !== null) {
    return null;
  }

  return {
    ...record,
    supabaseProjectUrl:
      record.organizationId === 'org_alpha'
        ? process.env.SUPABASE_URL_ORG_ALPHA?.trim() || record.supabaseProjectUrl
        : record.supabaseProjectUrl,
  };
}

export function getIntegrationByOrganizationId(
  organizationId: string
): IntegrationRecord | null {
  for (const record of CENTRAL_INTEGRATION_REGISTRY.values()) {
    if (
      record.organizationId === organizationId &&
      record.status === 'active' &&
      record.revokedAt === null
    ) {
      return record;
    }
  }
  return null;
}

export function registerIntegrationRecord(record: IntegrationRecord): void {
  if (!record.phoneNumberId || !record.organizationId) {
    throw new Error('CENTRAL_REGISTRY_ERROR: Missing phoneNumberId or organizationId');
  }
  CENTRAL_INTEGRATION_REGISTRY.set(record.phoneNumberId.trim(), record);
}

export function revokeIntegrationByOrganizationId(
  organizationId: string
): IntegrationRecord | null {
  for (const [phoneId, record] of CENTRAL_INTEGRATION_REGISTRY.entries()) {
    if (record.organizationId === organizationId) {
      const revoked: IntegrationRecord = {
        ...record,
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      CENTRAL_INTEGRATION_REGISTRY.set(phoneId, revoked);
      return revoked;
    }
  }
  return null;
}

