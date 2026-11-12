             
              
                  
                      
           
                           
import {
  resolveRelativeDateFromText,
  resolveTimeFromText,
                          
} from './context-builder.js';
import { classifyMessageIntent } from './intent-router.js';

                                     
                                
                             
                                               
                                       
 

                              
                                
                   
                                
                        
                                             
                                 
                        
                                
                                   
                     
 

/**
 * Adaptador inicial para Google Gemini (`GeminiAdapter`).
 * - Quando `GEMINI_API_KEY` está configurada, realiza Function Calling real na API do Gemini
 *   enviando apenas as ferramentas autorizadas (`context.allowedTools`) e `system_instruction`.
 * - Quando `GEMINI_API_KEY` está vazia (ambiente local/testes), utiliza o motor determinístico local.
 */
export class GeminiAdapter                        {
                  providerName = 'google-gemini';
                   modelName        ;
          simulateFailureMode = false;

  constructor(
    modelName         = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash'
  ) {
    this.modelName = modelName;
  }

         setSimulateFailure(shouldFail         )       {
    this.simulateFailureMode = shouldFail;
  }

          async callLiveGeminiApi(
    context                    ,
    apiKey        
  )                              {
    const primaryModel = process.env.GEMINI_MODEL?.trim() || this.modelName;
    const candidateModels = Array.from(
      new Set([
        primaryModel,
        'gemini-3.8-flash',
        'gemini-flash-lite-latest',
        'gemini-flash-latest',
      ])
    );

    const functionDeclarations = context.allowedTools.map((t) => {
      const rawProps = (t.parametersSchema.properties ?? {})           
               
               
       ;
      const hasProps = Object.keys(rawProps).length > 0;
      return {
        name: t.name,
        description: t.description,
        ...(hasProps
          ? {
              parameters: {
                type: 'OBJECT',
                properties: rawProps,
                required: t.parametersSchema.required ?? [],
              },
            }
          : {}),
      };
    });

    let lastError               = null;

    const baseUrl = (
      process.env.GEMINI_API_BASE_URL?.trim() ||
      'https://generativelanguage.googleapis.com/v1beta'
    ).replace(/\/+$/, '');

    for (const modelName of candidateModels) {
      const endpoint = `${baseUrl}/models/${encodeURIComponent(
        modelName
      )}:generateContent`;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: context.systemInstruction }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: context.sanitizedUserMessage }],
              },
            ],
            tools:
              functionDeclarations.length > 0
                ? [{ function_declarations: functionDeclarations }]
                : undefined,
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 350,
            },
          }),
        });

        if (response.status === 404 || response.status === 503 || response.status === 429) {
          const errBody = await response.text().catch(() => '');
          lastError = new Error(
            `GEMINI_HTTP_ERROR_${response.status} (${modelName}): ${errBody.slice(0, 140)}`
          );
          continue;
        }

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(
            `GEMINI_HTTP_ERROR_${response.status} (${modelName}): ${errBody.slice(0, 180)}`
          );
        }

        const data = (await response.json())     
                              
                       
                             
                              
                                                                                
                 
              
             
         ;

        const parts = data.candidates?.[0]?.content?.parts ?? [];
        const fnCallPart = parts.find((p) => p.functionCall);
        if (fnCallPart?.functionCall) {
          return {
            providerName: this.providerName,
            modelName,
            suggestedToolCall: {
              name: fnCallPart.functionCall.name            ,
              args: fnCallPart.functionCall.args ?? {},
            },
          };
        }

        const textPart = parts.find((p) => p.text);
        return {
          providerName: this.providerName,
          modelName,
          directTextResponse: textPart?.text,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error('GEMINI_ALL_MODELS_UNAVAILABLE');
  }

         async inferToolOrReply(
    context                    ,
    rawUserText        ,
    availableServices                        
  )                              {
    if (this.simulateFailureMode) {
      throw new Error(
        'GEMINI_PROVIDER_TIMEOUT_OR_503: Simulated model unavailability'
      );
    }

    const classification = classifyMessageIntent(rawUserText);
    if (classification.isAdversarial) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
      };
    }

    const liveApiKey = process.env.GEMINI_API_KEY?.trim();
    if (liveApiKey && process.env.NODE_ENV !== 'test') {
      return this.callLiveGeminiApi(context, liveApiKey);
    }

    const isToolInContext = (name        )          =>
      context.allowedTools.some((t) => t.name === name);

    const resolvedDate = resolveRelativeDateFromText(rawUserText);
    const resolvedTime = resolveTimeFromText(rawUserText);
    const apptIdMatch = rawUserText.match(/\b(appt_[a-zA-Z0-9_]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);

    if (
      classification.intent === 'list_services' &&
      isToolInContext('list_services')
    ) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
        suggestedToolCall: {
          name: 'list_services',
          args: {},
        },
      };
    }

    if (
      classification.intent === 'get_business_info' &&
      isToolInContext('get_business_info')
    ) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
        suggestedToolCall: {
          name: 'get_business_info',
          args: {},
        },
      };
    }

    if (
      classification.intent === 'list_available_slots' &&
      isToolInContext('list_available_slots')
    ) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
        suggestedToolCall: {
          name: 'list_available_slots',
          args: {
            date: resolvedDate ?? context.currentDateIso,
          },
        },
      };
    }

    if (
      classification.intent === 'request_booking' &&
      isToolInContext('request_booking')
    ) {
      const lowerText = rawUserText.toLowerCase();
      // Ordena do nome mais específico (maior) para o menor (ex: "Corte + Barba" antes de "Corte")
      const sortedBySpecificity = [...availableServices].sort(
        (a, b) => b.name.length - a.name.length
      );
      const matchedService =
        availableServices.find((s) =>
          lowerText.includes(s.serviceId.toLowerCase())
        ) ??
        sortedBySpecificity.find((s) =>
          lowerText.includes(s.name.toLowerCase())
        ) ??
        sortedBySpecificity.find((s) =>
          lowerText.includes(s.name.split(' ')[0]?.toLowerCase() ?? '')
        ) ??
        availableServices[0];

      if (matchedService && resolvedDate && resolvedTime) {
        return {
          providerName: this.providerName,
          modelName: this.modelName,
          suggestedToolCall: {
            name: 'request_booking',
            args: {
              service_id: matchedService.serviceId,
              date: resolvedDate,
              time: resolvedTime,
              client_name: context.actorDisplayName,
            },
          },
        };
      }
    }

    if (
      classification.intent === 'request_cancellation' &&
      isToolInContext('request_cancellation') &&
      apptIdMatch?.[1]
    ) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
        suggestedToolCall: {
          name: 'request_cancellation',
          args: {
            appointment_id: apptIdMatch[1],
          },
        },
      };
    }

    if (
      classification.intent === 'request_reschedule' &&
      isToolInContext('request_reschedule') &&
      apptIdMatch?.[1] &&
      resolvedDate &&
      resolvedTime
    ) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
        suggestedToolCall: {
          name: 'request_reschedule',
          args: {
            appointment_id: apptIdMatch[1],
            new_date: resolvedDate,
            new_time: resolvedTime,
          },
        },
      };
    }

    if (
      classification.intent === 'get_daily_schedule' &&
      isToolInContext('get_daily_schedule')
    ) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
        suggestedToolCall: {
          name: 'get_daily_schedule',
          args: {
            date: resolvedDate ?? context.currentDateIso,
          },
        },
      };
    }

    if (
      classification.intent === 'get_financial_goal_status' &&
      isToolInContext('get_financial_goal_status')
    ) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
        suggestedToolCall: {
          name: 'get_financial_goal_status',
          args: {
            period: context.currentDateIso.slice(0, 7),
          },
        },
      };
    }

    if (
      classification.intent === 'request_block_schedule_slot' &&
      isToolInContext('request_block_schedule_slot') &&
      resolvedDate &&
      resolvedTime
    ) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
        suggestedToolCall: {
          name: 'request_block_schedule_slot',
          args: {
            date: resolvedDate,
            time: resolvedTime,
            reason: 'Bloqueio operacional pelo profissional',
          },
        },
      };
    }

    if (
      classification.intent === 'get_business_summary' &&
      isToolInContext('get_business_summary')
    ) {
      return {
        providerName: this.providerName,
        modelName: this.modelName,
        suggestedToolCall: {
          name: 'get_business_summary',
          args: {
            period: '2026-11',
          },
        },
      };
    }

    return {
      providerName: this.providerName,
      modelName: this.modelName,
    };
  }

         async formatToolResultReply(
    context                    ,
    toolResult                     
  )                  {
    if (this.simulateFailureMode) {
      throw new Error(
        'GEMINI_PROVIDER_TIMEOUT_OR_503: Simulated model unavailability'
      );
    }

    if (!toolResult.success) {
      return `Não foi possível concluir a solicitação em *${context.organizationName}*: ${toolResult.message}`;
    }

    return toolResult.message;
  }
}

export const defaultGeminiAdapter = new GeminiAdapter();
