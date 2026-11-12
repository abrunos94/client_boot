                                                           

/**
 * Define as políticas conversacionais (`conversation-policy`):
 * - Mensagens enxutas adequadas ao WhatsApp mobile.
 * - Multissegmento (barbearias, salões, clínicas, estúdios).
 * - Solicitação de parâmetros faltantes quando a intenção está incompleta.
 */
export function buildAmbiguousOrGreetingReply(
  integration                   
)         {
  return `Olá! Bem-vindo(a) ao atendimento da *${integration.organizationName}*. Como posso ajudar hoje?\n- Consultar *serviços e preços*\n- Ver *horários disponíveis*\n- *Agendar* ou *cancelar* um horário`;
}

export function buildMissingBookingParamsReply(
  integration                   
)         {
  return `Para realizar seu agendamento na *${integration.organizationName}*, informe por favor o *serviço*, a *data* (ex: 2026-11-10) e o *horário* desejado (ex: 10:00).`;
}

export function buildAdversarialRefusalReply(
  integration                   
)         {
  return `Desculpe, só posso ajudar com informações públicas de serviços e agendamentos referentes ao seu atendimento na *${integration.organizationName}*.`;
}
