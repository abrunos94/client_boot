import { handleWebhookRequest } from './webhook.ts';
import { computeWebhookSignature } from './security/signature-validation.ts';
import { getIntegrationByOrganizationId } from './services/integration-resolver.ts';
import { SupabaseTenantRestClient } from './services/supabase-tenant-client.ts';
import { resolveTenantDatabase } from './services/tenant-database-router.ts';
import type { IntegrationRecord } from './types/index.ts';

const APP_SECRET =
  process.env.META_APP_SECRET ?? 'change_me_meta_app_secret_for_hmac_sha256';

async function sendSignedMessage(text: string, msgIndex: number) {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_live_test',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'phone_id_org_alpha_101' },
              contacts: [
                {
                  profile: { name: 'Teste Automatizado Bot' },
                  wa_id: '5511977771111',
                },
              ],
              messages: [
                {
                  from: '5511977771111',
                  id: `wamid.supatest.${Date.now()}_${msgIndex}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const rawBody = JSON.stringify(payload);
  const signature = computeWebhookSignature(rawBody, APP_SECRET);
  const res = await handleWebhookRequest(
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      rawBody,
    },
    { appSecret: APP_SECRET }
  );

  return JSON.parse(res.body).processed?.[0];
}

async function runLiveSupabaseTest() {
  console.log(`=============================================================`);
  console.log(`🗄️  TESTE REAL COMPLETO — SUPABASE (READ/WRITE) + GEMINI NATURAL`);
  console.log(`=============================================================\n`);

  const baseIntegration = getIntegrationByOrganizationId('org_alpha');
  if (!baseIntegration || !process.env.SUPABASE_URL_ORG_ALPHA) {
    console.error('❌ SUPABASE_URL_ORG_ALPHA não configurada no .env');
    process.exit(1);
  }

  const supabaseIntegration: IntegrationRecord = {
    ...baseIntegration,
    supabaseProjectUrl: process.env.SUPABASE_URL_ORG_ALPHA,
    dbSecretReference: 'secret_ref:supabase:org_alpha',
  };

  const client = new SupabaseTenantRestClient(supabaseIntegration);
  const tenantDb = resolveTenantDatabase(baseIntegration);
  tenantDb.attachLiveSupabaseClient(client);

  console.log(`1. Sincronizando as 7 tabelas reais do seu projeto Supabase...`);
  await tenantDb.syncFromLiveSupabase();

  const snapshot = tenantDb.getSupabaseSnapshot();
  console.log(`  ✅ Serviços sincronizados: ${snapshot.servicos.length}`);
  console.log(`  ✅ Agendamentos existentes sincronizados: ${snapshot.agendamentos.length}`);
  console.log(`  ✅ Templates de marketing sincronizados: ${snapshot.templates_marketing.length}`);

  // 2. Teste de Linguagem Natural + INSERT real na tabela `agendamentos` do Supabase
  console.log(`\n2. Testando agendamento em linguagem natural ("amanhã às 16h" + "Corte + Barba")...`);
  const bookingStep = await sendSignedMessage(
    'Quero agendar um Corte + Barba para amanhã às 16h',
    1
  );
  console.log(`  Tool Acionada pelo Gemini: ${bookingStep?.toolExecuted}`);
  console.log(`  Sucesso da Gravação no Supabase: ${bookingStep?.toolSuccess}`);
  console.log(`  Resposta WhatsApp:\n    ${bookingStep?.replyText}\n`);

  // Extrai o UUID real gerado pelo Supabase na resposta
  const uuidMatch = String(bookingStep?.replyText ?? '').match(
    /\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i
  );

  if (uuidMatch?.[1]) {
    const createdId = uuidMatch[1];
    console.log(`3. Testando cancelamento em 2 etapas no Supabase (ID: ${createdId})...`);

    const cancelReq = await sendSignedMessage(
      `Quero cancelar o agendamento ${createdId}`,
      2
    );
    console.log(`  Etapa 1 (Pedido de Confirmação): ${cancelReq?.replyText}`);

    const confirmReq = await sendSignedMessage('SIM', 3);
    console.log(`  Etapa 2 (Confirmado com "SIM" e atualizado no Supabase): ${confirmReq?.replyText}`);
  }

  console.log(`\n=============================================================`);
  console.log(`✅ Teste Real de Leitura, Escrita e Linguagem Natural Concluído!`);
  console.log(`=============================================================`);
}

runLiveSupabaseTest();
