import http from 'node:http';
import { URL } from 'node:url';
import { handleWebhookRequest } from '../api/webhook.ts';
import { computeWebhookSignature } from './security/signature-validation.ts';

const PORT = Number(process.env.PORT ?? 3000);
const APP_SECRET =
  process.env.META_APP_SECRET ?? 'change_me_meta_app_secret_for_hmac_sha256';

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (reqUrl.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        service: 'clientflow-bot',
        aiLayer: 'clientflow-ai',
        status: 'healthy',
        tenantsConfigured: ['org_alpha', 'org_beta'],
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  if (reqUrl.pathname === '/api/webhook') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks);

    const query: Record<string, string | undefined> = {};
    for (const [k, v] of reqUrl.searchParams.entries()) {
      query[k] = v;
    }

    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k] = Array.isArray(v) ? v[0] : v;
    }

    const result = await handleWebhookRequest({
      method: req.method ?? 'GET',
      query,
      headers,
      rawBody,
    });

    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      error: 'Not Found',
      endpoints: ['/health', '/api/webhook'],
    })
  );
});

server.listen(PORT, () => {
  const samplePayload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_alpha_9001',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'phone_id_org_alpha_101' },
              contacts: [{ profile: { name: 'Lucas' }, wa_id: '5511977770000' }],
              messages: [
                {
                  from: '5511977770000',
                  id: 'wamid.demo_001',
                  timestamp: '1762700000',
                  type: 'text',
                  text: { body: 'Quais são os serviços e preços?' },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const sampleSig = computeWebhookSignature(samplePayload, APP_SECRET);

  console.log(`\n=============================================================`);
  console.log(`🤖 clientflow-bot + clientflow-ai rodando em http://localhost:${PORT}`);
  console.log(`- GET  http://localhost:${PORT}/health`);
  console.log(`- GET  http://localhost:${PORT}/api/webhook (Verificação Meta)`);
  console.log(`- POST http://localhost:${PORT}/api/webhook (Eventos assinados)`);
  console.log(`- Header de exemplo X-Hub-Signature-256: ${sampleSig}`);
  console.log(`=============================================================\n`);
});
