import { logger } from '../lib/logger.ts';
import { registerSecretReference } from '../lib/secrets.ts';
import { normalizePhoneE164 } from '../security/authorization.ts';
import type {
  IntegrationRecord,
  ServiceItem,
  TabelaConfiguracoes,
  TabelaConfiguracoes1,
  TabelaDadosBarbearia,
} from '../types/index.ts';
import { registerIntegrationRecord } from './integration-resolver.ts';
import {
  IsolatedTenantDatabase,
  registerTenantDatabaseInstance,
  resolveTenantDatabase,
} from './tenant-database-router.ts';

export interface ProvisionNewSupabaseTenantParams {
  readonly organizationId: string;
  readonly segment: IntegrationRecord['segment'];
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly wabaAccessToken: string;
  readonly supabaseProjectUrl: string;
  readonly supabaseServiceKey: string;
  readonly dadosBarbearia: TabelaDadosBarbearia;
  readonly configuracoes: TabelaConfiguracoes;
  readonly configuracoes1: TabelaConfiguracoes1;
  readonly initialServices: readonly ServiceItem[];
}

export interface ProvisionTenantResult {
  readonly integration: IntegrationRecord;
  readonly healthCheckPassed: boolean;
  readonly tablesInitialized: readonly string[];
}

/**
 * Pipeline Automatizado de Ciclo de Vida de Tenant (Alternativa A: 1 Projeto Supabase por Empresa).
 * Executa:
 * 1. Armazenamento isolado dos segredos (Token WABA + Chave do Projeto Supabase) no Vault por `secret_reference`.
 * 2. Inicialização das 7 tabelas padrão do projeto Supabase (`servicos`, `agendamentos`, `configuracoes`, `configuracoes1`, `templates_marketing`, `vitrine_midias`, `dados_barbearia`).
 * 3. Vinculação automática do telefone do proprietário (`dados_barbearia.whatsapp`) como Administrador verificado.
 * 4. Registro atômico no Cadastro Central (`central_integrations`).
 * 5. Health Check de conectividade e isolamento.
 */
export function provisionSupabaseTenant(
  params: ProvisionNewSupabaseTenantParams
): ProvisionTenantResult {
  const wabaSecretRef = `secret_ref:waba:${params.organizationId}`;
  const dbSecretRef = `secret_ref:db:${params.organizationId}`;

  // 1. Registra referências seguras no cofre isolado por organização
  registerSecretReference({
    secretReference: wabaSecretRef,
    organizationId: params.organizationId,
    secretValue: params.wabaAccessToken,
  });

  registerSecretReference({
    secretReference: dbSecretRef,
    organizationId: params.organizationId,
    secretValue: `${params.supabaseProjectUrl}|${params.supabaseServiceKey}`,
  });

  // 2. Cria instância isolada do banco operacional Supabase com as 7 tabelas
  const tenantDb = new IsolatedTenantDatabase(
    params.organizationId,
    `${params.supabaseProjectUrl}|${params.supabaseServiceKey}`
  );

  tenantDb.configureSupabaseTables({
    configuracoes: params.configuracoes,
    configuracoes1: params.configuracoes1,
    dadosBarbearia: params.dadosBarbearia,
    templatesMarketing: [],
  });

  const ownerName =
    params.dadosBarbearia.nome_proprietario ??
    params.dadosBarbearia.proprietario ??
    'Proprietário';
  const companyName =
    params.dadosBarbearia.nome_empresa ??
    params.dadosBarbearia.empresa ??
    'Empresa';

  // 3. Vincula o proprietário (`dados_barbearia.whatsapp`) como Admin verificado
  tenantDb.seedInitialData(params.initialServices, [
    {
      staffId: `staff_${params.organizationId}_owner`,
      fullName: ownerName,
      phoneE164: normalizePhoneE164(params.dadosBarbearia.whatsapp),
      role: 'admin',
      isActive: true,
      verifiedAt: new Date().toISOString(),
    },
  ]);

  registerTenantDatabaseInstance(params.organizationId, tenantDb);

  // 4. Registra no Cadastro Central de Integrações
  const now = new Date().toISOString();
  const integration: IntegrationRecord = {
    integrationId: `int_${params.organizationId}`,
    organizationId: params.organizationId,
    organizationName: companyName,
    segment: params.segment,
    wabaId: params.wabaId,
    phoneNumberId: params.phoneNumberId,
    secretReference: wabaSecretRef,
    dbSecretReference: dbSecretRef,
    supabaseProjectUrl: params.supabaseProjectUrl,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };

  registerIntegrationRecord(integration);

  // 5. Health check de roteamento e isolamento
  const verifiedDb = resolveTenantDatabase(integration);
  const snapshot = verifiedDb.getSupabaseSnapshot();
  const snapshotCompany =
    snapshot.dados_barbearia?.nome_empresa ?? snapshot.dados_barbearia?.empresa;
  const healthCheckPassed =
    verifiedDb.organizationId === params.organizationId &&
    snapshotCompany === companyName;

  logger.log({
    level: 'info',
    correlationId: `prov_${params.organizationId}`,
    event: 'tenant.supabase_provisioned',
    organizationId: params.organizationId,
    integrationId: integration.integrationId,
    operationStatus: healthCheckPassed ? 'active' : 'error',
    metadata: {
      supabaseProjectUrl: params.supabaseProjectUrl,
      phoneNumberId: params.phoneNumberId,
      servicesCount: snapshot.servicos.length,
    },
  });

  return {
    integration,
    healthCheckPassed,
    tablesInitialized: [
      'agendamentos',
      'servicos',
      'configuracoes',
      'configuracoes1',
      'templates_marketing',
      'vitrine_midias',
      'dados_barbearia',
    ],
  };
}
