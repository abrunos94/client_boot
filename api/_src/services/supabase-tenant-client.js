import { resolveSecretByReference } from '../lib/secrets.js';
             
                    
                     
                      
                       
                       
                 
                           
                           

/**
 * Cliente HTTP PostgREST isolado para Alternativa A (1 Projeto Supabase por Empresa).
 * Regra de Segurança:
 * - Nunca utiliza uma URL ou chave global para múltiplas empresas.
 * - Resolve a credencial do projeto Supabase exclusivamente via `integration.dbSecretReference`
 *   validando que pertence a `integration.organizationId`.
 */
export class SupabaseTenantRestClient {
                  organizationId        ;
                   projectUrl        ;
                   dbSecretReference        ;

  constructor(integration                   ) {
    if (!integration.supabaseProjectUrl) {
      throw new Error(
        `SUPABASE_CLIENT_ERROR: Missing supabaseProjectUrl for organization '${integration.organizationId}'`
      );
    }
    this.organizationId = integration.organizationId;
    this.projectUrl = integration.supabaseProjectUrl.replace(/\/+$/, '');
    this.dbSecretReference = integration.dbSecretReference;
  }

          getHeaders()                         {
    const apiKey = resolveSecretByReference(
      this.dbSecretReference,
      this.organizationId
    );
    return {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
  }

         async fetchServicos()                                     {
    const res = await fetch(
      `${this.projectUrl}/rest/v1/servicos?select=*&order=ordem.asc`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) {
      throw new Error(`SUPABASE_SERVICOS_ERROR_${res.status}`);
    }
    return (await res.json())                    ;
  }

         async fetchConfiguracoes()                                      {
    const res = await fetch(
      `${this.projectUrl}/rest/v1/configuracoes?select=*&limit=1`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) {
      throw new Error(`SUPABASE_CONFIGURACOES_ERROR_${res.status}`);
    }
    const rows = (await res.json())                         ;
    return rows[0] ?? null;
  }

         async fetchConfiguracoes1()                                       {
    const res = await fetch(
      `${this.projectUrl}/rest/v1/configuracoes1?select=*&limit=1`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) {
      throw new Error(`SUPABASE_CONFIGURACOES1_ERROR_${res.status}`);
    }
    const rows = (await res.json())                          ;
    return rows[0] ?? null;
  }

         async fetchDadosBarbearia()                                       {
    const res = await fetch(
      `${this.projectUrl}/rest/v1/dados_barbearia?select=*&limit=1`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) {
      throw new Error(`SUPABASE_DADOS_BARBEARIA_ERROR_${res.status}`);
    }
    const rows = (await res.json())                          ;
    return rows[0] ?? null;
  }

         async fetchTemplatesMarketing()          
                                       
    {
    const res = await fetch(
      `${this.projectUrl}/rest/v1/templates_marketing?select=*`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) {
      throw new Error(`SUPABASE_TEMPLATES_ERROR_${res.status}`);
    }
    return (await res.json())                              ;
  }

         async fetchAllAgendamentos()                                         {
    const res = await fetch(
      `${this.projectUrl}/rest/v1/agendamentos?select=*&order=created_at.desc&limit=500`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) {
      throw new Error(`SUPABASE_AGENDAMENTOS_ALL_ERROR_${res.status}`);
    }
    return (await res.json())                        ;
  }

         async fetchAgendamentosByDate(
    data        
  )                                         {
    const res = await fetch(
      `${this.projectUrl}/rest/v1/agendamentos?select=*&data=eq.${encodeURIComponent(
        data
      )}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) {
      throw new Error(`SUPABASE_AGENDAMENTOS_QUERY_ERROR_${res.status}`);
    }
    return (await res.json())                        ;
  }

         async insertAgendamento(
    payload                                               
  )                              {
    // Verificação prévia de slot ocupado no Supabase (defesa adicional caso o índice único ainda não tenha sido rodado no banco)
    const existingOnDate = await this.fetchAgendamentosByDate(payload.data);
    const activeConflict = existingOnDate.find(
      (row) =>
        row.horario === payload.horario &&
        row.status !== 'cancelado' &&
        row.status !== 'cancelled'
    );
    if (activeConflict) {
      throw new Error('SUPABASE_UNIQUE_CONFLICT_SLOT_ALREADY_BOOKED');
    }

    const res = await fetch(`${this.projectUrl}/rest/v1/agendamentos`, {
      method: 'POST',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      throw new Error('SUPABASE_UNIQUE_CONFLICT_SLOT_ALREADY_BOOKED');
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(
        `SUPABASE_INSERT_AGENDAMENTO_ERROR_${res.status}: ${errText.slice(0, 120)}`
      );
    }

    const rows = (await res.json())                        ;
    if (!rows[0]) {
      throw new Error('SUPABASE_INSERT_EMPTY_RESPONSE');
    }
    return rows[0];
  }

         async updateAgendamentoStatus(
    id        ,
    status        
  )                                     {
    const res = await fetch(
      `${this.projectUrl}/rest/v1/agendamentos?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
        body: JSON.stringify({ status }),
      }
    );
    if (!res.ok) {
      throw new Error(`SUPABASE_UPDATE_STATUS_ERROR_${res.status}`);
    }
    const rows = (await res.json())                        ;
    return rows[0] ?? null;
  }

         async updateAgendamentoSlot(
    id        ,
    newData        ,
    newHorario        
  )                                     {
    const existingOnDate = await this.fetchAgendamentosByDate(newData);
    const activeConflict = existingOnDate.find(
      (row) =>
        row.id !== id &&
        row.horario === newHorario &&
        row.status !== 'cancelado' &&
        row.status !== 'cancelled'
    );
    if (activeConflict) {
      throw new Error('SUPABASE_UNIQUE_CONFLICT_SLOT_ALREADY_BOOKED');
    }

    const res = await fetch(
      `${this.projectUrl}/rest/v1/agendamentos?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
        body: JSON.stringify({ data: newData, horario: newHorario }),
      }
    );
    if (res.status === 409) {
      throw new Error('SUPABASE_UNIQUE_CONFLICT_SLOT_ALREADY_BOOKED');
    }
    if (!res.ok) {
      throw new Error(`SUPABASE_UPDATE_SLOT_ERROR_${res.status}`);
    }
    const rows = (await res.json())                        ;
    return rows[0] ?? null;
  }
}
