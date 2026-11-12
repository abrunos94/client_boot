                              
                   
                          
                       
                     
                          
                        
                        
                               
                                 
                          
                                   
                                    

                                       
                                    
                                  
                                      
 

const PROMPT_INJECTION_PATTERNS                 
                  
                 
   = [
  {
    pattern: /ignore\s+(todas\s+as\s+|as\s+)?instru[cç][oõ]es/i,
    reason: 'Direct instruction override attempt',
  },
  {
    pattern: /system_instruction|system\s+prompt|gemini_api_key|service_role/i,
    reason: 'System prompt or secret exfiltration attempt',
  },
  {
    pattern: /drop\s+table|select\s+\*\s+from|union\s+select/i,
    reason: 'SQL injection pattern in conversational payload',
  },
  {
    pattern: /modo\s+desenvolvedor|sou\s+o\s+dono.*faturamento|outros\s+clientes/i,
    reason: 'Semantic privilege escalation / data exfiltration attempt',
  },
  {
    pattern: /org_beta|org_alpha|banco\s+da\s+empresa/i,
    reason: 'Cross-tenant routing manipulation attempt',
  },
];

/**
 * Classifica a intenção da mensagem e detecta tentativas de Prompt Injection
 * ou escalada semântica antes mesmo da execução de ferramentas.
 */
export function classifyMessageIntent(rawText        )                       {
  const normalized = rawText.trim().toLowerCase();

  for (const rule of PROMPT_INJECTION_PATTERNS) {
    if (rule.pattern.test(rawText)) {
      return {
        intent: 'adversarial_injection_attempt',
        isAdversarial: true,
        adversarialReason: rule.reason,
      };
    }
  }

  if (
    normalized.includes('faturamento') ||
    normalized.includes('resumo do negócio') ||
    normalized.includes('receita')
  ) {
    return { intent: 'get_business_summary', isAdversarial: false };
  }

  if (normalized.includes('meta financeira') || normalized.includes('metas')) {
    return { intent: 'get_financial_goal_status', isAdversarial: false };
  }

  if (
    normalized.includes('agenda do dia') ||
    normalized.includes('agenda de hoje') ||
    normalized.includes('meus atendimentos')
  ) {
    return { intent: 'get_daily_schedule', isAdversarial: false };
  }

  if (normalized.includes('bloquear') || normalized.includes('folga')) {
    return { intent: 'request_block_schedule_slot', isAdversarial: false };
  }

  if (normalized.includes('cancelar')) {
    return { intent: 'request_cancellation', isAdversarial: false };
  }

  if (normalized.includes('remarcar') || normalized.includes('reagendar')) {
    return { intent: 'request_reschedule', isAdversarial: false };
  }

  if (
    normalized.includes('agendar') ||
    normalized.includes('marcar horario') ||
    normalized.includes('marcar horário') ||
    normalized.includes('reservar')
  ) {
    return { intent: 'request_booking', isAdversarial: false };
  }

  if (
    normalized.includes('horários disponíveis') ||
    normalized.includes('horarios disponiveis') ||
    normalized.includes('horários livres') ||
    normalized.includes('disponibilidade')
  ) {
    return { intent: 'list_available_slots', isAdversarial: false };
  }

  if (
    normalized.includes('serviços') ||
    normalized.includes('servicos') ||
    normalized.includes('preços') ||
    normalized.includes('precos') ||
    normalized.includes('valores')
  ) {
    return { intent: 'list_services', isAdversarial: false };
  }

  if (
    normalized.includes('endereço') ||
    normalized.includes('endereco') ||
    normalized.includes('onde fica') ||
    normalized.includes('localização') ||
    normalized.includes('localizacao') ||
    normalized.includes('chave pix') ||
    normalized.includes('pix') ||
    normalized.includes('instagram')
  ) {
    return { intent: 'get_business_info', isAdversarial: false };
  }

  return { intent: 'general_greeting_or_ambiguous', isAdversarial: false };
}

