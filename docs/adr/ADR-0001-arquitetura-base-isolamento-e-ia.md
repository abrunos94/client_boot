# ADR-0001: Arquitetura Base Multi-Tenant, Isolamento por Empresa e Camada `clientflow-ai`

* **Data:** 2026-11-09
* **Status:** Aceito (Fundação Implementada em Simulação Local / Homologação Inicial; Conexões de Produção Pendentes)
* **Autores:** Equipe de Agentes ClientFlow (`Documentador & Code Reviewer`, `ClientFlow Manager`, `Security Engineer`, `Database Architect`, `Backend Developer`, `AI Engineer`)
* **Aprovador Humano:** Alex Bruno (Responsável pelo Produto)

---

## 1. Contexto

O ecossistema **ClientFlow** atende prestadores de serviços de múltiplos segmentos (barbearias, salões de beleza, clínicas de estética, estúdios e afins) cuja operação diária é predominantemente móvel. O objetivo do **`clientflow-bot`** e da camada **`clientflow-ai`** é transformar o WhatsApp empresarial de cada negócio em um canal automatizado para clientes finais (consulta e agendamento) e em um assistente operacional seguro para profissionais e administradores (agenda, bloqueios e metas).

Para evitar riscos críticos comuns em arquiteturas SaaS multi-tenant com IA (vazamento de dados entre empresas, execução de comandos indevidos por *prompt injection*, duplicidade de reservas concorrentes e exposição de credenciais), foram estabelecidos princípios arquiteturais inegociáveis.

---

## 2. Decisões Arquiteturais Adotadas

### 2.1. Aplicação Meta Central com Ativos Individuais por Empresa
* O ClientFlow mantém uma aplicação central na Meta WhatsApp Business Platform.
* Cada empresa cliente conecta seus próprios ativos (`waba_id` e `phone_number_id`).
* É proibido utilizar um único token genérico compartilhado entre diferentes empresas.

### 2.2. Separação Estrita entre Cadastro Central e Banco Operacional Individual
* **Cadastro Central de Integrações (`central_integrations`):** Armazena exclusivamente metadados de roteamento (`integration_id`, `organization_id`, `waba_id`, `phone_number_id`, `secret_reference`, `db_secret_reference`, `status`, `revoked_at`).
* **Banco Operacional Individual da Empresa:** Cada empresa cliente possui seu próprio banco operacional isolado contendo serviços, profissionais, agendamentos, histórico conversacional minimizado e logs de auditoria. Dados operacionais de empresas distintas jamais coexistem na mesma tabela compartilhada.

### 2.3. Backend Determinístico como Única Autoridade de Segurança
* A resolução de `organization_id` ocorre **exclusivamente** a partir do `phone_number_id` destinatário validado criptograficamente (`X-Hub-Signature-256` sobre o `raw body`) no webhook da Meta e consultado no Cadastro Central.
* O modelo de IA (`clientflow-ai` / Gemini) **nunca** escolhe o banco de dados, **nunca** recebe tokens/credenciais, **nunca** executa SQL livre e **nunca** decide permissões.
* O catálogo de ferramentas (`tool-registry`) é segregado no backend antes da chamada ao modelo: conversas de `client` jamais recebem declarações de ferramentas administrativas (`get_daily_schedule`, `get_financial_goal_status`, `request_block_schedule_slot`, `get_business_summary`).

### 2.4. Controle Atômico de Concorrência e Idempotência
* Webhooks repetidos (`message.id` / `wamid`) são retidos pela camada de idempotência (`idempotency.ts` / tabela `processed_webhooks`).
* Reservas de horários utilizam trava transacional e índice único parcial (`uq_appointments_active_slot`) para impedir *double-booking* em chamadas simultâneas (`Promise.all`).
* Nenhuma resposta declara sucesso ao usuário antes da confirmação real de gravação pelo backend (*Zero Alucinação Transacional*).

---

## 3. Auditoria de Honestidade Documental (Estado Atual no Repositório)

Em conformidade com as regras do `Documentador & Code Reviewer`, a tabela abaixo distingue o que já é **código implementado e testado** do que permanece como **simulação local ou pendência externa**:

| Componente / Requisito | Estado no Código Atual (`v0.1.0`) | Arquivo(s) de Referência | O que falta para Produção |
|---|---|---|---|
| Validação `X-Hub-Signature-256` (raw body) e `GET` Challenge | **Implementado e Testado** | `src/security/signature-validation.ts`, `src/services/webhook-verification.ts` | Configurar `META_APP_SECRET` real em Secret Manager de produção |
| Controle de Idempotência de Webhook (`wamid`) | **Implementado (Em Memória) e Testado** | `src/security/idempotency.ts`, `sql/001_central_registry_and_tenant_schema.sql` | Conectar persistência na tabela PostgreSQL `processed_webhooks` |
| Resolução de Integração (`phone_number_id` -> `organization_id`) | **Implementado (Store Local) e Testado** | `src/services/integration-resolver.ts` | Conectar ao banco do Cadastro Central (`central_integrations`) |
| Roteador de Bancos Individuais e Lock Contra *Double-Booking* | **Implementado (Isolado em Memória) e Testado** | `src/services/tenant-database-router.ts` | Decidir topologia final (Supabase por empresa vs. PostgreSQL separado) e conectar pooler |
| Autorização por Perfil + Prevenção de IDOR | **Implementado e Testado** | `src/security/authorization.ts` | Integrar fluxo formal de verificação/onboarding de números de profissionais |
| Camada `clientflow-ai` (7 Módulos + Segregação de Tools) | **Implementado e Testado** | `src/ai/*.ts` | Ativar `GEMINI_API_KEY` em homologação e validar estado de confirmação em 2 etapas |
| Despacho WhatsApp Cloud API + Regra CSW 24h / Deep Link | **Implementado (Dry-Run + Fetch Pronto) e Testado** | `src/services/whatsapp-messaging.ts` | Validar templates aprovados na Meta e tabela de custos vigente |
| Suíte Automatizada das 5 Baterias de QA e Segurança | **Implementado (15/15 Testes Passando)** | `tests/clientflow.test.ts` | Expandir para testes de integração com banco PostgreSQL real |

---

## 4. Consequências

* **Positivas:** O projeto já conta com estrutura executável (`npm test`, `npm run demo`, `npm run dev`), tipagem estrita em TypeScript (`strict: true`), sanitização automática de logs (`[REDACTED]`) e cobertura automatizada contra vazamento entre empresas, corrida de agendamento e *prompt injection*.
* **Negativas / Trade-offs:** A operação de múltiplos bancos operacionais individuais exigirá automação rigorosa de provisionamento e migrações versionadas antes da entrada em produção (registrado no `ADR-0002`).

