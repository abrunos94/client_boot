import { logger } from '../lib/logger.ts';
import { resolveSecretByReference } from '../lib/secrets.ts';
import type { IntegrationRecord } from '../types/index.ts';

export interface OutboundWhatsAppMessage {
  readonly correlationId: string;
  readonly integration: IntegrationRecord;
  readonly recipientPhone: string;
  readonly text: string;
  readonly withinCustomerServiceWindow: boolean;
}

export interface WhatsAppDeliveryResult {
  readonly delivered: boolean;
  readonly channel: 'cloud_api_service_window' | 'deep_link_fallback';
  readonly externalMessageId?: string;
  readonly deepLinkUrl?: string;
  readonly estimatedBillable: boolean;
}

/**
 * Gera deep link `https://wa.me/...` como alternativa operacional quando o envio
 * automático fora da janela de 24h (CSW) exigir template pago não habilitado pela empresa.
 */
export function buildManualWhatsAppDeepLink(
  recipientPhone: string,
  text: string
): string {
  const digits = recipientPhone.replace(/\D/g, '');
  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${digits}?text=${encodedText}`;
}

async function postToMetaCloudApiWithRetry(params: {
  phoneNumberId: string;
  accessToken: string;
  recipientPhone: string;
  text: string;
  maxRetries?: number;
}): Promise<string> {
  const apiVersion = process.env.META_GRAPH_API_VERSION ?? 'v21.0';
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(
    params.phoneNumberId
  )}/messages`;
  const maxRetries = params.maxRetries ?? 2;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${params.accessToken}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.recipientPhone.replace(/\D/g, ''),
          type: 'text',
          text: { preview_url: false, body: params.text },
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          messages?: Array<{ id?: string }>;
        };
        return data.messages?.[0]?.id ?? `wamid.live.${Date.now()}`;
      }

      if (response.status >= 500 || response.status === 429) {
        lastError = new Error(`META_CLOUD_API_TRANSIENT_${response.status}`);
        const backoffMs = Math.min(200 * Math.pow(2, attempt), 1500);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      throw new Error(`META_CLOUD_API_REJECTED_${response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;
    }
  }

  throw lastError ?? new Error('META_CLOUD_API_UNKNOWN_FAILURE');
}

/**
 * Despacha resposta pela WhatsApp Cloud API utilizando estritamente a credencial
 * (`secretReference`) e o `phoneNumberId` da empresa proprietária da integração.
 */
export async function sendWhatsAppMessage(
  params: OutboundWhatsAppMessage
): Promise<WhatsAppDeliveryResult> {
  // Resolve o token da empresa no exato momento do envio (e valida isolamento de tenant)
  const accessToken = resolveSecretByReference(
    params.integration.secretReference,
    params.integration.organizationId
  );

  if (!accessToken) {
    throw new Error('WHATSAPP_SEND_ERROR: Missing WABA access token');
  }

  // Respeito às regras comerciais da Meta: fora da janela de 24h (CSW), mensagens livres não são permitidas
  if (!params.withinCustomerServiceWindow) {
    const deepLinkUrl = buildManualWhatsAppDeepLink(
      params.recipientPhone,
      params.text
    );
    logger.log({
      level: 'info',
      correlationId: params.correlationId,
      event: 'whatsapp.csw_closed_deep_link_generated',
      organizationId: params.integration.organizationId,
      integrationId: params.integration.integrationId,
      metadata: {
        recipientPhone: params.recipientPhone,
        reason:
          'Outside 24h Customer Service Window; fallback to manual deep link',
      },
    });
    return {
      delivered: false,
      channel: 'deep_link_fallback',
      deepLinkUrl,
      estimatedBillable: false,
    };
  }

  const isDryRun =
    process.env.META_DRY_RUN !== 'false' || process.env.NODE_ENV === 'test';

  const externalMessageId = isDryRun
    ? `wamid.out.${params.integration.organizationId}.${Date.now()}`
    : await postToMetaCloudApiWithRetry({
        phoneNumberId: params.integration.phoneNumberId,
        accessToken,
        recipientPhone: params.recipientPhone,
        text: params.text,
      });

  logger.log({
    level: 'info',
    correlationId: params.correlationId,
    event: 'whatsapp.message_sent',
    organizationId: params.integration.organizationId,
    integrationId: params.integration.integrationId,
    operationStatus: 'delivered',
    metadata: {
      phoneNumberId: params.integration.phoneNumberId,
      recipientPhone: params.recipientPhone,
      externalMessageId,
      category: 'service',
      estimatedBillable: false,
      accessToken,
    },
  });

  return {
    delivered: true,
    channel: 'cloud_api_service_window',
    externalMessageId,
    estimatedBillable: false,
  };
}
