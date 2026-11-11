import type { ToolCallRequest } from '../types/index.ts';

export interface PendingConfirmation {
  readonly organizationId: string;
  readonly actorPhoneE164: string;
  readonly toolCall: ToolCallRequest;
  readonly summaryText: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

const CONFIRMATION_TTL_MS = 10 * 60 * 1000; // 10 minutos
const pendingStore = new Map<string, PendingConfirmation>();

function makeKey(organizationId: string, actorPhoneE164: string): string {
  return `${organizationId}:${actorPhoneE164}`;
}

/**
 * Armazena solicitações de operações críticas (`request_cancellation`, `request_reschedule`, `request_block_schedule_slot`)
 * que exigem confirmação explícita ("SIM" / "NÃO") do usuário antes da gravação no banco.
 * Estritamente isolado por `organizationId` + `actorPhoneE164`.
 */
export const confirmationStore = {
  setPending(params: {
    organizationId: string;
    actorPhoneE164: string;
    toolCall: ToolCallRequest;
    summaryText: string;
    ttlMs?: number;
  }): PendingConfirmation {
    const now = Date.now();
    const record: PendingConfirmation = {
      organizationId: params.organizationId,
      actorPhoneE164: params.actorPhoneE164,
      toolCall: params.toolCall,
      summaryText: params.summaryText,
      createdAt: now,
      expiresAt: now + (params.ttlMs ?? CONFIRMATION_TTL_MS),
    };
    pendingStore.set(
      makeKey(params.organizationId, params.actorPhoneE164),
      record
    );
    return record;
  },

  getPending(
    organizationId: string,
    actorPhoneE164: string
  ): PendingConfirmation | null {
    const key = makeKey(organizationId, actorPhoneE164);
    const record = pendingStore.get(key);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      pendingStore.delete(key);
      return null;
    }
    return record;
  },

  consumePending(
    organizationId: string,
    actorPhoneE164: string
  ): PendingConfirmation | null {
    const record = this.getPending(organizationId, actorPhoneE164);
    if (record) {
      pendingStore.delete(makeKey(organizationId, actorPhoneE164));
    }
    return record;
  },

  clearAll(): void {
    pendingStore.clear();
  },
};

export function parseConfirmationDecision(
  rawText: string
): 'confirm' | 'reject' | null {
  const normalized = rawText.trim().toLowerCase();
  if (
    /^(sim|s|confirmo|confirmar|pode confirmar|de acordo|ok)$/i.test(normalized)
  ) {
    return 'confirm';
  }
  if (/^(n[aã]o|n|cancelar|desistir|nao quero)$/i.test(normalized)) {
    return 'reject';
  }
  return null;
}
