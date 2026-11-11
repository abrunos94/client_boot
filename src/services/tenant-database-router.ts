import crypto from 'node:crypto';
import { resolveSecretByReference } from '../lib/secrets.ts';
import {
  normalizePhoneE164,
  verifyAppointmentOwnership,
} from '../security/authorization.ts';
import type { SupabaseTenantRestClient } from './supabase-tenant-client.ts';
import type {
  ActorContext,
  AppointmentRecord,
  BusinessPublicInfo,
  BusinessSummary,
  FinancialGoalSummary,
  IntegrationRecord,
  ServiceItem,
  StaffMember,
  TabelaAgendamentos,
  TabelaConfiguracoes,
  TabelaConfiguracoes1,
  TabelaDadosBarbearia,
  TabelaServicos,
  TabelaTemplatesMarketing,
  TabelaVitrineMidias,
  ToolExecutionResult,
} from '../types/index.ts';

/**
 * Representa o projeto Supabase operacional individual (Alternativa A) de uma única empresa cliente,
 * estruturado fielmente com as 7 tabelas reais do banco do cliente:
 * 1. `agendamentos`
 * 2. `servicos`
 * 3. `configuracoes`
 * 4. `configuracoes1`
 * 5. `templates_marketing`
 * 6. `vitrine_midias`
 * 7. `dados_barbearia`
 */
export class IsolatedTenantDatabase {
  public readonly organizationId: string;
  private readonly connectionDsnHash: string;

  // As 7 Tabelas do Projeto Supabase do Cliente
  private readonly tabelaServicos = new Map<string, TabelaServicos>();
  private readonly tabelaAgendamentos = new Map<string, TabelaAgendamentos>();
  private tabelaConfiguracoes: TabelaConfiguracoes = {
    id: 1,
    intervalo: 30,
    dias_trabalhados: ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'],
    meta_diaria: 500.0,
    horarios_semana: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
    duracao_atendimento: 45,
  };
  private tabelaConfiguracoes1: TabelaConfiguracoes1 = {
    id: 1,
    hero_titulo: 'Bem-vindo',
    sobre_texto: 'Atendimento especializado',
    endereco: 'Rua Principal, 100',
  };
  private readonly tabelaTemplatesMarketing: TabelaTemplatesMarketing[] = [];
  private tabelaVitrineMidias: TabelaVitrineMidias | null = null;
  private tabelaDadosBarbearia: TabelaDadosBarbearia | null = null;

  // Membros verificados para autenticação administrativa no WhatsApp (derivados de `dados_barbearia.whatsapp` + equipe)
  private readonly staffMembers = new Map<string, StaffMember>();

  // Índice único parcial equivalente a `uq_agendamentos_data_horario_ativo (data, horario) WHERE status NOT IN ('cancelado', 'cancelled')`
  private readonly activeSlotIndex = new Map<string, string>();
  private readonly slotLocks = new Set<string>();
  private liveSupabaseClient: SupabaseTenantRestClient | null = null;

  constructor(organizationId: string, connectionDsn: string) {
    this.organizationId = organizationId;
    this.connectionDsnHash = crypto
      .createHash('sha256')
      .update(connectionDsn)
      .digest('hex')
      .slice(0, 16);
  }

  public attachLiveSupabaseClient(client: SupabaseTenantRestClient | null): void {
    this.liveSupabaseClient = client;
  }

  /**
   * Sincroniza o estado operacional com as 7 tabelas reais do projeto Supabase da empresa.
   */
  public async syncFromLiveSupabase(): Promise<void> {
    if (!this.liveSupabaseClient) return;

    const [
      servicos,
      configuracoes,
      configuracoes1,
      dadosBarbearia,
      templates,
      agendamentos,
    ] = await Promise.all([
      this.liveSupabaseClient.fetchServicos(),
      this.liveSupabaseClient.fetchConfiguracoes(),
      this.liveSupabaseClient.fetchConfiguracoes1(),
      this.liveSupabaseClient.fetchDadosBarbearia(),
      this.liveSupabaseClient.fetchTemplatesMarketing(),
      this.liveSupabaseClient.fetchAllAgendamentos(),
    ]);

    this.configureSupabaseTables({
      configuracoes: configuracoes ?? undefined,
      configuracoes1: configuracoes1 ?? undefined,
      dadosBarbearia: dadosBarbearia ?? undefined,
      templatesMarketing: templates,
    });

    if (dadosBarbearia?.whatsapp) {
      const ownerPhone = normalizePhoneE164(dadosBarbearia.whatsapp);
      this.staffMembers.set('staff_supabase_owner', {
        staffId: 'staff_supabase_owner',
        fullName:
          dadosBarbearia.nome_proprietario ??
          dadosBarbearia.proprietario ??
          'Proprietário',
        phoneE164: ownerPhone,
        role: 'admin',
        isActive: true,
        verifiedAt: new Date().toISOString(),
      });
    }

    this.tabelaServicos.clear();
    for (const s of servicos) {
      this.tabelaServicos.set(String(s.id), {
        id: String(s.id),
        created_at: s.created_at,
        nome: s.nome,
        preco: Number(s.preco),
        ordem: Number(s.ordem),
      });
    }

    this.tabelaAgendamentos.clear();
    this.activeSlotIndex.clear();
    for (const a of agendamentos) {
      this.tabelaAgendamentos.set(String(a.id), {
        ...a,
        id: String(a.id),
        valor: Number(a.valor),
      });
      if (a.status !== 'cancelado' && a.status !== 'cancelled') {
        this.activeSlotIndex.set(`${a.data}:${a.horario}`, String(a.id));
      }
    }
  }

  public getConnectionFingerprint(): string {
    return `${this.organizationId}:${this.connectionDsnHash}`;
  }

  public configureSupabaseTables(params: {
    configuracoes?: TabelaConfiguracoes;
    configuracoes1?: TabelaConfiguracoes1;
    dadosBarbearia?: TabelaDadosBarbearia;
    templatesMarketing?: readonly TabelaTemplatesMarketing[];
    vitrineMidias?: TabelaVitrineMidias;
  }): void {
    if (params.configuracoes) {
      this.tabelaConfiguracoes = params.configuracoes;
    }
    if (params.configuracoes1) {
      this.tabelaConfiguracoes1 = params.configuracoes1;
    }
    if (params.dadosBarbearia) {
      this.tabelaDadosBarbearia = params.dadosBarbearia;
    }
    if (params.templatesMarketing) {
      this.tabelaTemplatesMarketing.length = 0;
      this.tabelaTemplatesMarketing.push(...params.templatesMarketing);
    }
    if (params.vitrineMidias) {
      this.tabelaVitrineMidias = params.vitrineMidias;
    }
  }

  public getSupabaseSnapshot() {
    return {
      servicos: Array.from(this.tabelaServicos.values()).sort(
        (a, b) => a.ordem - b.ordem
      ),
      agendamentos: Array.from(this.tabelaAgendamentos.values()),
      configuracoes: this.tabelaConfiguracoes,
      configuracoes1: this.tabelaConfiguracoes1,
      dados_barbearia: this.tabelaDadosBarbearia,
      templates_marketing: [...this.tabelaTemplatesMarketing],
      vitrine_midias: this.tabelaVitrineMidias,
    };
  }

  public seedInitialData(
    services: readonly ServiceItem[],
    staff: readonly StaffMember[],
    initialAppointments: readonly AppointmentRecord[] = []
  ): void {
    this.tabelaServicos.clear();
    this.tabelaAgendamentos.clear();
    this.staffMembers.clear();
    this.activeSlotIndex.clear();
    this.slotLocks.clear();

    services.forEach((s, index) => {
      this.tabelaServicos.set(s.serviceId, {
        id: s.serviceId,
        created_at: new Date().toISOString(),
        nome: s.name,
        preco: Number((s.priceCents / 100).toFixed(2)),
        ordem: s.ordem ?? index + 1,
      });
    });

    for (const member of staff) {
      this.staffMembers.set(member.staffId, member);
    }

    for (const appt of initialAppointments) {
      const srvRow = appt.serviceId
        ? this.tabelaServicos.get(appt.serviceId)
        : undefined;
      const statusPt =
        appt.status === 'confirmed'
          ? 'confirmado'
          : appt.status === 'cancelled'
          ? 'cancelado'
          : 'bloqueado';

      this.tabelaAgendamentos.set(appt.appointmentId, {
        id: appt.appointmentId,
        created_at: appt.createdAt,
        cliente_nome: appt.clientName ?? appt.blockReason ?? 'Reservado',
        servico: srvRow?.nome ?? appt.serviceId ?? 'Bloqueio',
        telefone: appt.clientPhone ?? '',
        data: appt.date,
        horario: appt.time,
        status: statusPt,
        valor: srvRow?.preco ?? 0,
      });

      if (appt.status === 'confirmed' || appt.status === 'blocked') {
        const slotKey = `${appt.date}:${appt.time}`;
        this.activeSlotIndex.set(slotKey, appt.appointmentId);
      }
    }
  }

  private mapRowToAppointmentRecord(row: TabelaAgendamentos): AppointmentRecord {
    const defaultStaff = Array.from(this.staffMembers.values())[0];
    const matchedService = Array.from(this.tabelaServicos.values()).find(
      (s) => s.nome === row.servico || s.id === row.servico
    );
    const normalizedStatus =
      row.status === 'cancelado' || row.status === 'cancelled'
        ? 'cancelled'
        : row.status === 'bloqueado' || row.status === 'blocked'
        ? 'blocked'
        : 'confirmed';

    return {
      appointmentId: row.id,
      staffId: defaultStaff?.staffId ?? 'staff_default',
      serviceId: matchedService?.id ?? null,
      serviceName: row.servico,
      valorReais: row.valor,
      clientPhone: row.telefone || null,
      clientName: row.cliente_nome || null,
      date: row.data,
      time: row.horario,
      status: normalizedStatus,
      blockReason: normalizedStatus === 'blocked' ? row.servico : undefined,
      origin: 'whatsapp',
      createdAt: row.created_at,
    };
  }

  public getStaffMembers(): readonly StaffMember[] {
    return Array.from(this.staffMembers.values());
  }

  public getAppointmentById(
    appointmentId: string
  ): AppointmentRecord | undefined {
    const row = this.tabelaAgendamentos.get(appointmentId);
    return row ? this.mapRowToAppointmentRecord(row) : undefined;
  }

  public listServices(): readonly ServiceItem[] {
    const duracaoPadrao = this.tabelaConfiguracoes.duracao_atendimento;
    return Array.from(this.tabelaServicos.values())
      .sort((a, b) => a.ordem - b.ordem)
      .map((row) => ({
        serviceId: row.id,
        name: row.nome,
        durationMinutes: duracaoPadrao,
        priceCents: Math.round(row.preco * 100),
        isActive: true,
        ordem: row.ordem,
      }));
  }

  public getBusinessPublicInfo(): BusinessPublicInfo {
    const c1 = this.tabelaConfiguracoes1;
    const parts = [
      c1.end_rua
        ? `${c1.end_rua}${c1.end_numero ? `, ${c1.end_numero}` : ''}`
        : '',
      c1.end_cidade
        ? `${c1.end_cidade}${c1.end_estado ? `/${c1.end_estado}` : ''}`
        : '',
      c1.end_cep ? `CEP ${c1.end_cep}` : '',
    ].filter(Boolean);

    const formattedAddress =
      c1.endereco?.trim() || parts.join(' - ') || 'Endereço sob consulta';

    const empresaNome =
      this.tabelaDadosBarbearia?.nome_empresa?.trim() ||
      this.tabelaDadosBarbearia?.empresa?.trim() ||
      c1.hero_titulo;

    return {
      empresa: empresaNome,
      sobreTexto: c1.sobre_texto,
      endereco: formattedAddress,
      instagram: this.tabelaDadosBarbearia?.instagram,
      chavePix: this.tabelaDadosBarbearia?.chave_pix,
    };
  }

  public getMarketingTemplateByTrigger(
    gatilho: string
  ): TabelaTemplatesMarketing | undefined {
    return this.tabelaTemplatesMarketing.find((t) => t.gatilho === gatilho);
  }

  private findServiceByIdOrName(idOrName: string): TabelaServicos | undefined {
    const direct = this.tabelaServicos.get(idOrName);
    if (direct) return direct;

    const normalized = idOrName.trim().toLowerCase();
    const all = Array.from(this.tabelaServicos.values()).sort(
      (a, b) => b.nome.length - a.nome.length
    );

    return (
      all.find((s) => s.nome.toLowerCase() === normalized) ??
      all.find((s) => s.nome.toLowerCase().includes(normalized)) ??
      all.find((s) => normalized.includes(s.nome.toLowerCase()))
    );
  }

  public listAvailableSlots(date: string, serviceId?: string): readonly string[] {
    if (serviceId && !this.findServiceByIdOrName(serviceId)) {
      return [];
    }

    return this.tabelaConfiguracoes.horarios_semana.filter((time) => {
      const slotKey = `${date}:${time}`;
      return !this.activeSlotIndex.has(slotKey) && !this.slotLocks.has(slotKey);
    });
  }

  /**
   * Grava na tabela `agendamentos` do projeto Supabase da empresa com trava atômica
   * contra Double-Booking (`uq_agendamentos_data_horario_ativo`).
   */
  public async createBookingAtomic(params: {
    actor: ActorContext;
    serviceId: string;
    date: string;
    time: string;
    clientName: string;
    origin?: 'whatsapp' | 'app' | 'web';
  }): Promise<ToolExecutionResult> {
    const servicoRow = this.findServiceByIdOrName(params.serviceId);
    if (!servicoRow) {
      return {
        success: false,
        toolName: 'request_booking',
        errorCode: 'NOT_FOUND',
        message: `Serviço '${params.serviceId}' não encontrado na tabela 'servicos' desta empresa.`,
      };
    }

    const slotKey = `${params.date}:${params.time}`;

    if (this.slotLocks.has(slotKey) || this.activeSlotIndex.has(slotKey)) {
      const nearbySlots = this.listAvailableSlots(params.date, servicoRow.id);
      return {
        success: false,
        toolName: 'request_booking',
        errorCode: 'SLOT_ALREADY_BOOKED',
        data: { nearbyAvailableSlots: nearbySlots },
        message: `O horário ${params.time} em ${params.date} acabou de ser ocupado. Horários livres próximos: ${nearbySlots.join(', ') || 'nenhum nesta data'}.`,
      };
    }

    this.slotLocks.add(slotKey);
    try {
      await Promise.resolve();

      if (this.activeSlotIndex.has(slotKey)) {
        return {
          success: false,
          toolName: 'request_booking',
          errorCode: 'SLOT_ALREADY_BOOKED',
          message: `Conflito de concorrência: o horário ${params.time} já está reservado.`,
        };
      }

      let novoAgendamento: TabelaAgendamentos;

      if (this.liveSupabaseClient) {
        try {
          novoAgendamento = await this.liveSupabaseClient.insertAgendamento({
            cliente_nome: params.clientName.trim().slice(0, 80),
            servico: servicoRow.nome,
            telefone: normalizePhoneE164(params.actor.phoneE164),
            data: params.date,
            horario: params.time,
            status: 'confirmado',
            valor: Number(servicoRow.preco),
          });
        } catch (err) {
          if (
            err instanceof Error &&
            err.message.includes('SLOT_ALREADY_BOOKED')
          ) {
            return {
              success: false,
              toolName: 'request_booking',
              errorCode: 'SLOT_ALREADY_BOOKED',
              message: `O horário ${params.time} em ${params.date} já está ocupado no banco da empresa.`,
            };
          }
          throw err;
        }
      } else {
        const appointmentId = `appt_${this.organizationId}_${crypto.randomUUID().slice(0, 8)}`;
        novoAgendamento = {
          id: appointmentId,
          created_at: new Date().toISOString(),
          cliente_nome: params.clientName.trim().slice(0, 80),
          servico: servicoRow.nome,
          telefone: normalizePhoneE164(params.actor.phoneE164),
          data: params.date,
          horario: params.time,
          status: 'confirmado',
          valor: servicoRow.preco,
        };
      }

      this.tabelaAgendamentos.set(novoAgendamento.id, novoAgendamento);
      this.activeSlotIndex.set(slotKey, novoAgendamento.id);

      const record = this.mapRowToAppointmentRecord(novoAgendamento);

      return {
        success: true,
        toolName: 'request_booking',
        data: record,
        message: `Agendamento confirmado com sucesso (${novoAgendamento.id}) para ${servicoRow.nome} em ${params.date} às ${params.time} (Valor: R$ ${Number(servicoRow.preco).toFixed(2)}).`,
      };
    } finally {
      this.slotLocks.delete(slotKey);
    }
  }

  public async cancelAppointmentAtomic(params: {
    actor: ActorContext;
    appointmentId: string;
  }): Promise<ToolExecutionResult> {
    const existingRow = this.tabelaAgendamentos.get(params.appointmentId);
    if (!existingRow) {
      return {
        success: false,
        toolName: 'request_cancellation',
        errorCode: 'NOT_FOUND',
        message: 'Agendamento não encontrado na tabela agendamentos desta empresa.',
      };
    }

    const mapped = this.mapRowToAppointmentRecord(existingRow);
    if (!verifyAppointmentOwnership(params.actor, mapped)) {
      return {
        success: false,
        toolName: 'request_cancellation',
        errorCode: 'RESOURCE_OWNERSHIP_VIOLATION',
        message:
          'Acesso negado: você só pode cancelar ou alterar agendamentos vinculados ao seu próprio número de telefone.',
      };
    }

    if (this.liveSupabaseClient) {
      await this.liveSupabaseClient.updateAgendamentoStatus(
        existingRow.id,
        'cancelado'
      );
    }

    const slotKey = `${existingRow.data}:${existingRow.horario}`;
    this.activeSlotIndex.delete(slotKey);

    const updatedRow: TabelaAgendamentos = {
      ...existingRow,
      status: 'cancelado',
    };
    this.tabelaAgendamentos.set(existingRow.id, updatedRow);

    return {
      success: true,
      toolName: 'request_cancellation',
      data: this.mapRowToAppointmentRecord(updatedRow),
      message: `Agendamento ${existingRow.id} cancelado com sucesso.`,
    };
  }

  public async rescheduleAppointmentAtomic(params: {
    actor: ActorContext;
    appointmentId: string;
    newDate: string;
    newTime: string;
  }): Promise<ToolExecutionResult> {
    const existingRow = this.tabelaAgendamentos.get(params.appointmentId);
    if (
      !existingRow ||
      existingRow.status === 'cancelado' ||
      existingRow.status === 'cancelled'
    ) {
      return {
        success: false,
        toolName: 'request_reschedule',
        errorCode: 'NOT_FOUND',
        message: 'Agendamento ativo não encontrado para reagendamento.',
      };
    }

    const mapped = this.mapRowToAppointmentRecord(existingRow);
    if (!verifyAppointmentOwnership(params.actor, mapped)) {
      return {
        success: false,
        toolName: 'request_reschedule',
        errorCode: 'RESOURCE_OWNERSHIP_VIOLATION',
        message:
          'Acesso negado: você não possui permissão para alterar o agendamento de outro cliente.',
      };
    }

    const newSlotKey = `${params.newDate}:${params.newTime}`;
    if (this.slotLocks.has(newSlotKey) || this.activeSlotIndex.has(newSlotKey)) {
      return {
        success: false,
        toolName: 'request_reschedule',
        errorCode: 'SLOT_ALREADY_BOOKED',
        message: `O novo horário (${params.newDate} às ${params.newTime}) já está ocupado.`,
      };
    }

    if (this.liveSupabaseClient) {
      await this.liveSupabaseClient.updateAgendamentoSlot(
        existingRow.id,
        params.newDate,
        params.newTime
      );
    }

    const oldSlotKey = `${existingRow.data}:${existingRow.horario}`;
    this.activeSlotIndex.delete(oldSlotKey);

    const updatedRow: TabelaAgendamentos = {
      ...existingRow,
      data: params.newDate,
      horario: params.newTime,
    };
    this.tabelaAgendamentos.set(existingRow.id, updatedRow);
    this.activeSlotIndex.set(newSlotKey, existingRow.id);

    return {
      success: true,
      toolName: 'request_reschedule',
      data: this.mapRowToAppointmentRecord(updatedRow),
      message: `Agendamento ${existingRow.id} reagendado para ${params.newDate} às ${params.newTime}.`,
    };
  }

  public getDailySchedule(date: string): readonly AppointmentRecord[] {
    return Array.from(this.tabelaAgendamentos.values())
      .filter(
        (row) =>
          row.data === date &&
          row.status !== 'cancelado' &&
          row.status !== 'cancelled'
      )
      .map((row) => this.mapRowToAppointmentRecord(row));
  }

  public getFinancialGoalStatus(period: string): FinancialGoalSummary {
    const confirmedRows = Array.from(this.tabelaAgendamentos.values()).filter(
      (row) => row.status === 'confirmado' || row.status === 'confirmed'
    );
    const achievedReais = confirmedRows.reduce((acc, r) => acc + Number(r.valor), 0);
    const metaDiariaReais = this.tabelaConfiguracoes.meta_diaria;
    const diasMes = 26; // Média de dias trabalhados no período
    const targetCents = Math.round(metaDiariaReais * diasMes * 100);
    const achievedCents = Math.round(achievedReais * 100);

    return {
      period,
      targetCents,
      achievedCents,
      completionPercentage:
        targetCents > 0
          ? Number(((achievedCents / targetCents) * 100).toFixed(2))
          : 0,
      totalConfirmedAppointments: confirmedRows.length,
      metaDiariaReais,
    };
  }

  public async blockScheduleSlotAtomic(params: {
    actor: ActorContext;
    date: string;
    time: string;
    reason: string;
  }): Promise<ToolExecutionResult> {
    const slotKey = `${params.date}:${params.time}`;
    if (this.slotLocks.has(slotKey) || this.activeSlotIndex.has(slotKey)) {
      return {
        success: false,
        toolName: 'request_block_schedule_slot',
        errorCode: 'SLOT_ALREADY_BOOKED',
        message: `O horário ${params.time} em ${params.date} já possui agendamento ou bloqueio ativo.`,
      };
    }

    const appointmentId = `blk_${this.organizationId}_${crypto.randomUUID().slice(0, 8)}`;
    const bloqueioRow: TabelaAgendamentos = {
      id: appointmentId,
      created_at: new Date().toISOString(),
      cliente_nome: 'BLOQUEIO DE AGENDA',
      servico: params.reason,
      telefone: params.actor.phoneE164,
      data: params.date,
      horario: params.time,
      status: 'bloqueado',
      valor: 0,
    };

    this.tabelaAgendamentos.set(appointmentId, bloqueioRow);
    this.activeSlotIndex.set(slotKey, appointmentId);

    return {
      success: true,
      toolName: 'request_block_schedule_slot',
      data: this.mapRowToAppointmentRecord(bloqueioRow),
      message: `Horário ${params.date} às ${params.time} bloqueado com sucesso (${params.reason}).`,
    };
  }

  public getBusinessSummary(period: string): BusinessSummary {
    const allRows = Array.from(this.tabelaAgendamentos.values());
    const confirmed = allRows.filter(
      (a) => a.status === 'confirmado' || a.status === 'confirmed'
    );
    const cancelled = allRows.filter(
      (a) => a.status === 'cancelado' || a.status === 'cancelled'
    );
    const blocked = allRows.filter(
      (a) => a.status === 'bloqueado' || a.status === 'blocked'
    );

    const revenueReais = confirmed.reduce((acc, r) => acc + Number(r.valor), 0);

    return {
      period,
      totalAppointments: confirmed.length,
      cancelledAppointments: cancelled.length,
      blockedSlots: blocked.length,
      estimatedRevenueCents: Math.round(revenueReais * 100),
    };
  }
}

const tenantDatabaseInstances = new Map<string, IsolatedTenantDatabase>();

export function resetAndSeedTenantDatabases(): void {
  tenantDatabaseInstances.clear();

  // Provisiona Projeto Supabase Individual da Empresa Alpha (Barbearia Alpha)
  const dsnAlpha = resolveSecretByReference('secret_ref:db:org_alpha', 'org_alpha');
  const dbAlpha = new IsolatedTenantDatabase('org_alpha', dsnAlpha);
  dbAlpha.configureSupabaseTables({
    configuracoes: {
      id: 1,
      intervalo: 30,
      dias_trabalhados: ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'],
      meta_diaria: 600.0,
      horarios_semana: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
      duracao_atendimento: 45,
    },
    configuracoes1: {
      id: 1,
      hero_titulo: 'Barbearia Alpha — Estilo Clássico',
      sobre_texto: 'Tradição em cortes masculinos e barba terapia.',
      endereco: 'Av. Paulista, 1000 - São Paulo/SP',
    },
    dadosBarbearia: {
      id: 1,
      proprietario: 'Carlos (Admin Alpha)',
      empresa: 'Barbearia Alpha',
      whatsapp: '+5511999990001',
      instagram: '@barbearia_alpha',
      chave_pix: 'pix@barbeariaalpha.com.br',
    },
    templatesMarketing: [
      {
        id: 1,
        criado_em: '2026-10-01T10:00:00Z',
        gatilho: 'lembrete_24h',
        texto_base: 'Olá {cliente_nome}, lembramos do seu horário de {servico} amanhã às {horario}!',
      },
    ],
  });
  dbAlpha.seedInitialData(
    [
      {
        serviceId: 'srv_alpha_corte',
        name: 'Corte Masculino Clássico',
        durationMinutes: 45,
        priceCents: 6000,
        isActive: true,
        ordem: 1,
      },
      {
        serviceId: 'srv_alpha_barba',
        name: 'Barba Terapia com Toalha Quente',
        durationMinutes: 45,
        priceCents: 4500,
        isActive: true,
        ordem: 2,
      },
    ],
    [
      {
        staffId: 'staff_alpha_1',
        fullName: 'Carlos (Admin Alpha)',
        phoneE164: '+5511999990001',
        role: 'admin',
        isActive: true,
        verifiedAt: '2026-10-01T12:00:00Z',
      },
    ],
    [
      {
        appointmentId: 'appt_alpha_existing_1',
        staffId: 'staff_alpha_1',
        serviceId: 'srv_alpha_corte',
        clientPhone: '+5511988881111',
        clientName: 'Cliente Alpha Um',
        date: '2026-11-10',
        time: '09:00',
        status: 'confirmed',
        origin: 'whatsapp',
        createdAt: '2026-11-08T10:00:00Z',
      },
    ]
  );

  // Provisiona Projeto Supabase Individual da Empresa Beta (Clínica Estética Beta)
  const dsnBeta = resolveSecretByReference('secret_ref:db:org_beta', 'org_beta');
  const dbBeta = new IsolatedTenantDatabase('org_beta', dsnBeta);
  dbBeta.configureSupabaseTables({
    configuracoes: {
      id: 1,
      intervalo: 60,
      dias_trabalhados: ['seg', 'ter', 'qua', 'qui', 'sex'],
      meta_diaria: 1200.0,
      horarios_semana: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'],
      duracao_atendimento: 60,
    },
    configuracoes1: {
      id: 1,
      hero_titulo: 'Clínica Estética Beta',
      sobre_texto: 'Protocolos faciais e corporais avançados.',
      endereco: 'Rua Oscar Freire, 500 - São Paulo/SP',
    },
    dadosBarbearia: {
      id: 1,
      proprietario: 'Dra. Marina (Admin Beta)',
      empresa: 'Clínica Estética Beta',
      whatsapp: '+5521999990002',
      instagram: '@clinica_beta',
      chave_pix: 'financeiro@clinicabeta.com.br',
    },
  });
  dbBeta.seedInitialData(
    [
      {
        serviceId: 'srv_beta_limpeza',
        name: 'Limpeza de Pele Profunda',
        durationMinutes: 60,
        priceCents: 18000,
        isActive: true,
        ordem: 1,
      },
      {
        serviceId: 'srv_beta_drenagem',
        name: 'Drenagem Linfática Facial',
        durationMinutes: 60,
        priceCents: 15000,
        isActive: true,
        ordem: 2,
      },
    ],
    [
      {
        staffId: 'staff_beta_1',
        fullName: 'Dra. Marina (Admin Beta)',
        phoneE164: '+5521999990002',
        role: 'admin',
        isActive: true,
        verifiedAt: '2026-10-05T12:00:00Z',
      },
    ],
    [
      {
        appointmentId: 'appt_beta_secret_99',
        staffId: 'staff_beta_1',
        serviceId: 'srv_beta_limpeza',
        clientPhone: '+5521977772222',
        clientName: 'Paciente Beta Confidencial',
        date: '2026-11-10',
        time: '14:00',
        status: 'confirmed',
        origin: 'app',
        createdAt: '2026-11-08T11:00:00Z',
      },
    ]
  );

  tenantDatabaseInstances.set('org_alpha', dbAlpha);
  tenantDatabaseInstances.set('org_beta', dbBeta);
}

resetAndSeedTenantDatabases();

export function registerTenantDatabaseInstance(
  organizationId: string,
  dbInstance: IsolatedTenantDatabase
): void {
  tenantDatabaseInstances.set(organizationId, dbInstance);
}

/**
 * Roteador Seguro de Bancos Operacionais (`tenant-database-router`).
 */
export function resolveTenantDatabase(
  verifiedIntegration: IntegrationRecord
): IsolatedTenantDatabase {
  if (
    !verifiedIntegration ||
    verifiedIntegration.status !== 'active' ||
    verifiedIntegration.revokedAt !== null
  ) {
    throw new Error(
      'TENANT_ROUTER_ERROR: Integration is not active or has been revoked'
    );
  }

  resolveSecretByReference(
    verifiedIntegration.dbSecretReference,
    verifiedIntegration.organizationId
  );

  const db = tenantDatabaseInstances.get(verifiedIntegration.organizationId);
  if (!db) {
    throw new Error(
      `TENANT_ROUTER_ERROR: Isolated operational database not found for organization '${verifiedIntegration.organizationId}'`
    );
  }

  if (db.organizationId !== verifiedIntegration.organizationId) {
    throw new Error(
      'TENANT_ISOLATION_CRITICAL: Database organizationId mismatch'
    );
  }

  return db;
}
