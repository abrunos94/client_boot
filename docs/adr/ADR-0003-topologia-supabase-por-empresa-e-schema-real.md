# ADR-0003: Topologia de Banco Individual (Alternativa A — Projeto Supabase por Empresa) e Mapeamento do Schema de 7 Tabelas

* **Data:** 2026-11-09
* **Status:** Aprovado pelo Responsável do Produto e Implementado no Modelo de Domínio
* **Autores:** `Database Architect`, `Backend & WhatsApp Developer`, `Security Engineer` e `Documentador & Code Reviewer`
* **Aprovador Humano:** Alex Bruno (Responsável pelo Produto)

---

## 1. Contexto e Decisão Tomada

Estava pendente no `ADR-0002` a decisão sobre a topologia exata dos bancos operacionais individuais por empresa. O responsável pelo produto deliberou e aprovou oficialmente:

1. **Topologia Escolhida:** **Alternativa A — Um Projeto Supabase independente por empresa cliente.**
   * Cada empresa possui sua própria instância Supabase (`supabase_url` e chave de API exclusiva armazenada via `secret_reference` no cofre de segredos e vinculada ao `organization_id` no Cadastro Central).
   * Isolamento físico e lógico total de dados operacionais, credenciais e recursos.
2. **Schema Padrão do Banco do Cliente (7 Tabelas Operacionais):**
   Cada projeto Supabase de cliente possui a seguinte estrutura de 7 tabelas já estabelecida no ecossistema ClientFlow:

```text
+-----------------------+             +-----------------------+
|     agendamentos      |             |       servicos        |
+-----------------------+             +-----------------------+
| id (UUID - PK)        |             | id (UUID - PK)        |
| created_at (Timestamp)|             | created_at (Timestamp)|
| cliente_nome (Text)   |             | nome (Text)           |
| servico (Text)        |             | preco (Numeric)       |
| telefone (Text)       |             | ordem (Integer)       |
| data (Text)           |             +-----------------------+
| horario (Text)        |
| status (Text)         |             +-----------------------+
| valor (Numeric)       |             |  templates_marketing  |
+-----------------------+             +-----------------------+
                                      | id (Identity - PK)    |
+-----------------------+             | criado_em (Timestamp) |
|     configuracoes     |             | gatilho (Text)        |
+-----------------------+             | texto_base (Text)     |
| id (Integer - PK)     |             +-----------------------+
| intervalo (Integer)   |
| dias_trabalhados(JSONB|             +-----------------------+
| meta_diaria (Numeric) |             |    vitrine_midias     |
| horarios_semana(JSONB)|             +-----------------------+
| duracao_atendimento(I)|             | id (BigInt - PK)      |
+-----------------------+             | url_hero (Text)       |
                                      | url_sobre (Text)      |
+-----------------------+             | tipo_exibicao (Text)  |
|    configuracoes1     |             | dados_galeria (JSONB) |
+-----------------------+             | dados_produtos(JSONB) |
| id (BigInt - PK)      |             | ultima_atualizacao(TS)|
| hero_titulo (Text)    |             +-----------------------+
| sobre_texto (Text)    |
| endereco (Vários Text)|             +-----------------------+
| mapa_iframe (Text)    |             |    dados_barbearia    |
+-----------------------+             +-----------------------+
                                      | id (BigInt - PK)      |
                                      | proprietario / empresa|
                                      | whatsapp / instagram  |
                                      | url_logo / chave_pix  |
                                      +-----------------------+
```

---

## 2. Mapeamento entre as Ferramentas do `clientflow-ai` e as 7 Tabelas do Supabase

| Ferramenta / Operação | Tabela(s) do Projeto Supabase da Empresa | Regra de Segurança e Integridade Aplicada |
|---|---|---|
| `list_services()` | `servicos` (`nome`, `preco`, `ordem`) + `configuracoes` (`duracao_atendimento`) | Ordenado por `ordem ASC`; somente leitura pública daquela empresa |
| `list_available_slots(date)` | `configuracoes` (`horarios_semana`, `dias_trabalhados`) + `agendamentos` (`data`, `horario`, `status`) | Filtra horários ocupados onde `status NOT IN ('cancelado', 'cancelled')` |
| `request_booking(...)` | `agendamentos` (`INSERT`) + `servicos` (validação de `nome` e `preco`) | Protegido por índice único parcial `uq_agendamentos_data_horario_ativo (data, horario)` contra *double-booking* |
| `request_cancellation(id)` | `agendamentos` (`UPDATE status = 'cancelado'`) | Exige verificação de propriedade (`agendamentos.telefone === actor.phoneE164`) + confirmação explícita `SIM` |
| `request_reschedule(id, ...)` | `agendamentos` (`UPDATE data, horario`) | Exige verificação de propriedade + confirmação explícita `SIM` + verificação de conflito no novo horário |
| `get_daily_schedule(date)` | `agendamentos` (`SELECT WHERE data = :date`) | Exclusivo para profissional/admin autenticado (`dados_barbearia.whatsapp`) |
| `get_financial_goal_status` | `agendamentos` (`SUM(valor)`) + `configuracoes` (`meta_diaria`) | Exclusivo para profissional/admin autenticado |
| `request_block_schedule_slot` | `agendamentos` (`INSERT status = 'bloqueado', valor = 0`) | Exclusivo para profissional/admin autenticado + confirmação explícita `SIM` |
| `get_business_summary` | `agendamentos` (contagem por `status` e soma de `valor`) | Exclusivo para administrador autenticado |

---

## 3. Artefatos de Código Atualizados

1. **`sql/001_central_registry_and_tenant_schema.sql`:** DDL atualizado com as 7 tabelas exatas do cliente e o índice único parcial `uq_agendamentos_data_horario_ativo`.
2. **`src/types/index.ts`:** Tipagens `TabelaAgendamentos`, `TabelaServicos`, `TabelaConfiguracoes`, `TabelaConfiguracoes1`, `TabelaTemplatesMarketing`, `TabelaVitrineMidias` e `TabelaDadosBarbearia`.
3. **`src/services/supabase-tenant-client.ts`:** Cliente HTTP PostgREST isolado por projeto Supabase (`SupabaseTenantRestClient`).
4. **`src/services/tenant-database-router.ts` & `src/services/tenant-provisioning.ts`:** Roteador e provisionador automatizado operando sobre as 7 tabelas do cliente.

