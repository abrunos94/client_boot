/**
 * Controle atômico de idempotência para evitar reprocessamento de webhooks
 * reentregues pela Meta (`wamid` / `message.id`).
 */

interface IdempotencyEntry {
  readonly messageId: string;
  readonly organizationId: string;
  readonly processedAt: number;
  readonly expiresAt: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const processedMessages = new Map<string, IdempotencyEntry>();

export const idempotencyStore = {
  /**
   * Tenta adquirir a trava atômica de processamento para um `messageId`.
   * Retorna `true` se for a primeira vez (pode processar) ou `false` se já foi processado/em andamento.
   */
  tryAcquireMessageLock(
    messageId: string,
    organizationId: string,
    ttlMs: number = DEFAULT_TTL_MS
  ): boolean {
    if (!messageId || !organizationId) {
      return false;
    }

    const now = Date.now();
    const compositeKey = `${organizationId}:${messageId}`;
    const existing = processedMessages.get(compositeKey);

    if (existing && existing.expiresAt > now) {
      return false;
    }

    processedMessages.set(compositeKey, {
      messageId,
      organizationId,
      processedAt: now,
      expiresAt: now + ttlMs,
    });

    return true;
  },

  hasProcessed(messageId: string, organizationId: string): boolean {
    const compositeKey = `${organizationId}:${messageId}`;
    const existing = processedMessages.get(compositeKey);
    if (!existing) return false;
    if (existing.expiresAt <= Date.now()) {
      processedMessages.delete(compositeKey);
      return false;
    }
    return true;
  },

  clearAll(): void {
    processedMessages.clear();
  },
};

