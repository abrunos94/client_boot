export type IntegrationStatus = 'active' | 'pending' | 'suspended' | 'revoked';

export interface IntegrationRecord {
  readonly integrationId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly segment: 'barbershop' | 'salon' | 'clinic' | 'studio' | 'general';
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly secretReference: string;
  readonly dbSecretReference: string;
  readonly supabaseProjectUrl?: string;
  readonly status: IntegrationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revokedAt: string | null;
}

// ============================================================================
// Interfaces Exatas do Schema Supabase por Empresa (Alternativa A)
// ============================================================================

export interface TabelaAgendamentos {
  readonly id: string; // UUID - PK
  readonly created_at: string; // Timestamp
  readonly cliente_nome: string; // Text
  readonly servico: string; // Text
  readonly telefone: string; // Text
  readonly data: string; // Text (YYYY-MM-DD)
  readonly horario: string; // Text (HH:mm)
  readonly status: string; // Text ('confirmado' | 'cancelado' | 'bloqueado' | 'confirmed' | 'cancelled' | 'blocked')
  readonly valor: number; // Numeric
}

export interface TabelaServicos {
  readonly id: string; // UUID - PK
  readonly created_at: string; // Timestamp
  readonly nome: string; // Text
  readonly preco: number; // Numeric
  readonly ordem: number; // Integer
}

export interface TabelaConfiguracoes {
  readonly id: number; // Integer - PK
  readonly intervalo: number; // Integer
  readonly dias_trabalhados: readonly string[]; // JSONB
  readonly meta_diaria: number; // Numeric
  readonly horarios_semana: readonly string[]; // JSONB
  readonly duracao_atendimento: number; // Integer
}

export interface TabelaConfiguracoes1 {
  readonly id: number; // BigInt - PK
  readonly created_at?: string;
  readonly hero_titulo: string; // Text
  readonly sobre_texto: string; // Text
  readonly endereco?: string; // Text legado/consolidado
  readonly end_rua?: string;
  readonly end_numero?: string;
  readonly end_cidade?: string;
  readonly end_estado?: string;
  readonly end_cep?: string;
  readonly end_tel?: string;
  readonly mapa_iframe?: string; // Text
}

export interface TabelaTemplatesMarketing {
  readonly id: number; // Identity - PK
  readonly criado_em: string; // Timestamp
  readonly gatilho: string; // Text
  readonly texto_base: string; // Text
}

export interface TabelaVitrineMidias {
  readonly id: number; // BigInt - PK
  readonly url_hero: string; // Text
  readonly url_sobre: string; // Text
  readonly tipo_exibicao: string; // Text
  readonly dados_galeria: readonly unknown[]; // JSONB
  readonly dados_produtos: readonly unknown[]; // JSONB
  readonly ultima_atualizacao_midia?: string; // Timestamp
  readonly ultima_atualizacao?: string; // Timestamp
}

export interface TabelaDadosBarbearia {
  readonly id: number; // BigInt - PK
  readonly nome_proprietario?: string; // Text (coluna real no Supabase)
  readonly nome_empresa?: string; // Text (coluna real no Supabase)
  readonly proprietario?: string; // Alias compatível
  readonly empresa?: string; // Alias compatível
  readonly documento?: string;
  readonly whatsapp: string; // Text
  readonly instagram?: string; // Text
  readonly facebook?: string;
  readonly link_site?: string;
  readonly url_logo?: string; // Text
  readonly chave_pix?: string; // Text
}

// ============================================================================
// Modelos de Domínio e Segurança Internos do Bot / AI
// ============================================================================

export type ActorRole = 'client' | 'professional' | 'admin';

export interface ActorContext {
  readonly organizationId: string;
  readonly phoneE164: string;
  readonly role: ActorRole;
  readonly staffId?: string;
  readonly displayName?: string;
  readonly isVerifiedStaff: boolean;
}

export interface ServiceItem {
  readonly serviceId: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceCents: number;
  readonly isActive: boolean;
  readonly ordem?: number;
}

export interface StaffMember {
  readonly staffId: string;
  readonly fullName: string;
  readonly phoneE164: string;
  readonly role: 'professional' | 'admin';
  readonly isActive: boolean;
  readonly verifiedAt: string | null;
}

export type AppointmentStatus = 'confirmed' | 'cancelled' | 'blocked';

export interface AppointmentRecord {
  readonly appointmentId: string;
  readonly staffId: string;
  readonly serviceId: string | null;
  readonly serviceName?: string;
  readonly valorReais?: number;
  readonly clientPhone: string | null;
  readonly clientName: string | null;
  readonly date: string; // YYYY-MM-DD
  readonly time: string; // HH:mm
  readonly status: AppointmentStatus;
  readonly blockReason?: string;
  readonly origin: 'whatsapp' | 'app' | 'web';
  readonly createdAt: string;
}

export interface FinancialGoalSummary {
  readonly period: string;
  readonly targetCents: number;
  readonly achievedCents: number;
  readonly completionPercentage: number;
  readonly totalConfirmedAppointments: number;
  readonly metaDiariaReais?: number;
}

export interface BusinessSummary {
  readonly period: string;
  readonly totalAppointments: number;
  readonly cancelledAppointments: number;
  readonly blockedSlots: number;
  readonly estimatedRevenueCents: number;
}

export interface BusinessPublicInfo {
  readonly empresa: string;
  readonly sobreTexto: string;
  readonly endereco: string;
  readonly instagram?: string;
  readonly chavePix?: string;
}

export type ClientToolName =
  | 'list_services'
  | 'list_available_slots'
  | 'get_business_info'
  | 'request_booking'
  | 'request_cancellation'
  | 'request_reschedule';

export type StaffToolName =
  | 'get_daily_schedule'
  | 'get_financial_goal_status'
  | 'request_block_schedule_slot'
  | 'get_business_summary';

export type ToolName = ClientToolName | StaffToolName;

export interface ToolDeclaration {
  readonly name: ToolName;
  readonly description: string;
  readonly allowedRoles: readonly ActorRole[];
  readonly requiresConfirmation: boolean;
  readonly parametersSchema: Record<string, unknown>;
}

export interface ToolCallRequest {
  readonly name: ToolName;
  readonly args: Record<string, unknown>;
}

export interface ToolExecutionResult {
  readonly success: boolean;
  readonly toolName: ToolName;
  readonly data?: unknown;
  readonly errorCode?:
    | 'SLOT_ALREADY_BOOKED'
    | 'UNAUTHORIZED_ROLE'
    | 'RESOURCE_OWNERSHIP_VIOLATION'
    | 'INVALID_PARAMETERS'
    | 'NOT_FOUND'
    | 'CONFIRMATION_REQUIRED'
    | 'INTERNAL_ERROR';
  readonly message: string;
}

export interface MetaWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      field: string;
      value: {
        messaging_product: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: Array<{
          profile?: { name?: string };
          wa_id?: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
        }>;
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id: string;
          pricing?: {
            billable: boolean;
            pricing_model: string;
            category: 'service' | 'utility' | 'marketing' | 'authentication';
          };
        }>;
      };
    }>;
  }>;
}
