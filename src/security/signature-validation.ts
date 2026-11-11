import crypto from 'node:crypto';

/**
 * Valida a assinatura criptográfica `X-Hub-Signature-256` da Meta no corpo bruto (rawBody).
 * Utiliza comparação em tempo constante (`crypto.timingSafeEqual`) para prevenir timing attacks.
 */
export function validateWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const receivedHex = signatureHeader.slice(prefix.length).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(receivedHex)) {
    return false;
  }

  const payloadBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(rawBody, 'utf8');

  const expectedHex = crypto
    .createHmac('sha256', appSecret)
    .update(payloadBuffer)
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (receivedBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}

/**
 * Gera cabeçalho `X-Hub-Signature-256` para testes locais e simulador de webhook.
 */
export function computeWebhookSignature(
  rawBody: Buffer | string,
  appSecret: string
): string {
  const payloadBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(rawBody, 'utf8');
  const hex = crypto
    .createHmac('sha256', appSecret)
    .update(payloadBuffer)
    .digest('hex');
  return `sha256=${hex}`;
}

