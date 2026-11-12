                                                             

                                           
                          
                                     
                                    
 

const FORBIDDEN_OUTPUT_PATTERNS = [
  /simulated_meta_token_[a-z0-9_]+/i,
  /secret_ref:[a-z0-9:_]+/i,
  /postgres:\/\/[^\s]+/i,
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /GEMINI_API_KEY/i,
  /<untrusted_user_input>/i,
];

/**
 * Inspeciona a saída do modelo antes do envio pelo WhatsApp Cloud API (`response-validator`).
 * 1. Impede vazamento de tokens, referências de segredos ou strings de conexão.
 * 2. Impede alucinação transacional (declarar que agendou/cancelou quando `toolResult.success === false`).
 */
export function validateAndSanitizeAIResponse(
  candidateText        ,
  executedToolResult                      
)                           {
  for (const pattern of FORBIDDEN_OUTPUT_PATTERNS) {
    if (pattern.test(candidateText)) {
      return {
        valid: false,
        sanitizedResponse:
          'Desculpe, ocorreu um erro ao processar sua resposta com segurança. Tente novamente em instantes.',
        violationReason: 'Detected sensitive token or internal reference in AI response',
      };
    }
  }

  // Se uma ferramenta de escrita falhou no backend, a resposta jamais pode afirmar que foi "confirmado com sucesso"
  if (executedToolResult && !executedToolResult.success) {
    if (/agendamento confirmado com sucesso/i.test(candidateText)) {
      return {
        valid: false,
        sanitizedResponse: `Atenção: a operação não foi concluída. ${executedToolResult.message}`,
        violationReason:
          'Transactional hallucination prevented: model claimed success after backend rejection',
      };
    }
  }

  return {
    valid: true,
    sanitizedResponse: candidateText.trim(),
  };
}
