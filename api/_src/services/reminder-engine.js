                                                           
import { resolveTenantDatabase } from './tenant-database-router.js';
import {
  sendWhatsAppMessage,
                              
} from './whatsapp-messaging.js';

                                       
                                 
                              
                               
                                   
                                            
 

/**
 * Motor de Lembretes Inteligentes baseado na tabela `templates_marketing` do banco Supabase da empresa.
 * - Busca o template pelo `gatilho` (ex: `lembrete_24h`).
 * - Interpola com segurança `{cliente_nome}`, `{servico}`, `{horario}`, `{data}` e `{empresa}`.
 * - Respeita as regras comerciais da Meta: se `withinCustomerServiceWindow === false`,
 *   gera automaticamente o Deep Link (`https://wa.me/...`) sem cobrar disparo de template não autorizado.
 */
export async function processAppointmentRemindersForDate(params   
                                 
                     
                       
                                       
 )                                           {
  const tenantDb = resolveTenantDatabase(params.integration);
  const trigger = params.triggerName ?? 'lembrete_24h';
  const templateRow = tenantDb.getMarketingTemplateByTrigger(trigger);
  const publicInfo = tenantDb.getBusinessPublicInfo();

  const defaultBaseText =
    'Olá {cliente_nome}, lembramos do seu agendamento de {servico} em {data} às {horario} na {empresa}.';
  const baseText = templateRow?.texto_base ?? defaultBaseText;

  const schedule = tenantDb
    .getDailySchedule(params.targetDate)
    .filter((appt) => appt.status === 'confirmed' && appt.clientPhone);

  const dispatched                         = [];

  for (const appt of schedule) {
    const clientName = appt.clientName ?? 'Cliente';
    const clientPhone = appt.clientPhone ?? '';
    const serviceName = appt.serviceName ?? 'Atendimento';

    const renderedMessage = baseText
      .replace(/\{cliente_nome\}/g, clientName)
      .replace(/\{servico\}/g, serviceName)
      .replace(/\{horario\}/g, appt.time)
      .replace(/\{data\}/g, appt.date)
      .replace(/\{empresa\}/g, publicInfo.empresa);

    const delivery = await sendWhatsAppMessage({
      correlationId: `rem_${params.integration.organizationId}_${appt.appointmentId}`,
      integration: params.integration,
      recipientPhone: clientPhone,
      text: renderedMessage,
      withinCustomerServiceWindow: params.withinCustomerServiceWindow,
    });

    dispatched.push({
      appointmentId: appt.appointmentId,
      clientName,
      clientPhone,
      renderedMessage,
      delivery,
    });
  }

  return dispatched;
}

