# ADR-0002: Registro de Decisões Pendentes de Deliberação Humana

* **Data:** 2026-11-09
* **Status:** Pendente de Deliberação Humana (Bloqueadores para Produção, Não-Bloqueadores para Desenvolvimento Local)
* **Autores:** `ClientFlow Manager` & `Documentador & Code Reviewer`

---

## 1. Contexto

De acordo com o modelo de governança do projeto (`AGENTS_clientflow.md` — Seção 7), nenhum agente de IA está autorizado a transformar decisões arquiteturais abertas, políticas comerciais ou obrigações legais em escolhas definitivas sem aprovação explícita do responsável pelo produto.

Este ADR cataloga as **6 decisões pendentes** que deverão ser deliberadas antes da transição do ambiente local/homologação para o Piloto (Etapa 5).

---

## 2. Decisões Abertas e Opções em Análise

### Decisão Pendente 01 — Topologia Exata dos Bancos Operacionais Individuais [✅ RESOLVIDA NO ADR-0003]
* **Decisão Aprovada pelo Responsável Humano:** **Alternativa A (Um projeto Supabase independente por empresa cliente)**, utilizando o schema de 7 tabelas (`agendamentos`, `servicos`, `configuracoes`, `configuracoes1`, `templates_marketing`, `vitrine_midias`, `dados_barbearia`). Documentado em detalhes no [`ADR-0003`](./ADR-0003-topologia-supabase-por-empresa-e-schema-real.md).

### Decisão Pendente 02 — Onboarding Oficial na Meta (Embedded Signup / Tech Provider)
* **Escopo:** Validar no painel Meta for Developers os requisitos de revisão do aplicativo central, verificação empresarial, permissões (`whatsapp_business_management`, `whatsapp_business_messaging`) e ciclo de renovação/revogação de tokens por empresa.

### Decisão Pendente 03 — Governança LGPD, Retenção e Papéis Contratuais
* **Escopo:** Definir com assessoria jurídica:
  * Os papéis de Controlador (empresa cliente / prestador) e Operador (ClientFlow) nos termos de uso.
  * O prazo oficial de retenção da tabela `chat_history` (atualmente parametrizado em 30 dias no schema SQL inicial) e `audit_logs`.

### Decisão Pendente 04 — Limites Comerciais, Cotas por Plano e Regra de Lembretes Meta
* **Escopo:** Definir a política comercial diante da tarifação da Meta (mensagens fora da janela de 24h CSW exigem Templates pagos):
  * Quais planos terão disparo automático via Template de Utilidade pago vs. notificação para disparo manual via Deep Link (`https://wa.me/...`) implementado em `src/services/whatsapp-messaging.ts`.

### Decisão Pendente 05 — Critérios de Confirmação Explícita ("Duplo Aceite")
* **Escopo:** Confirmar quais ferramentas exigirão sempre etapa intermediária de confirmação por texto (`SIM` / `NÃO`) antes do commit no banco (proposta inicial no catálogo: `request_cancellation`, `request_reschedule` e `request_block_schedule_slot`).

### Decisão Pendente 06 — Avaliação Futura de Modelos de IA Alternativos
* **Escopo:** O provedor inicial definido é o **Google Gemini** (`GeminiAdapter`). Eventual comparação com outros provedores comerciais ou modelos abertos auto-hospedados fica fora do escopo inicial e só será avaliada mediante métricas reais de custo/latência coletadas pelo módulo `src/ai/evaluation.ts`.

