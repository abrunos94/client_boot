# 🤖 clientflow-bot — Integração oficial do WhatsApp com o ClientFlow

O **`clientflow-bot`** é o microserviço de mensageria e automação do ecossistema **ClientFlow**. Sua responsabilidade é receber e enviar mensagens pelo WhatsApp Business Platform (Cloud API), identificar a empresa e o contexto da conversa e encaminhar a solicitação à camada de inteligência do ClientFlow.

O projeto foi concebido para atender diferentes tipos de prestadores de serviços — como barbearias, salões e outros negócios — e não somente barbearias.

> **Estado do projeto:** arquitetura em planejamento e desenvolvimento. As decisões descritas como “proposta” ou “pendente” ainda precisam ser implementadas, testadas e validadas. Este README não representa uma certificação de segurança nem uma aprovação da Meta.

---

## 🎯 Objetivo

Transformar o WhatsApp empresarial de cada negócio em um canal de atendimento e operação integrado ao ClientFlow.

O sistema deverá permitir:

- Atendimento automatizado aos clientes.
- Consulta de serviços, preços e disponibilidade.
- Solicitação, confirmação, alteração e cancelamento de agendamentos, respeitando regras e confirmações.
- Atendimento administrativo aos profissionais autorizados.
- Consulta de agenda e indicadores permitidos.
- Sincronização das operações com o aplicativo e os demais canais do ClientFlow.

A automação deve reduzir o trabalho operacional sem retirar do backend o controle sobre autorização, regras de negócio e integridade dos dados.

---

## 🧱 Arquitetura geral

O ecossistema será dividido em serviços com responsabilidades distintas:

| Componente | Responsabilidade |
|---|---|
| `clientflow-bot` | Webhooks, integração com a Meta, roteamento de mensagens e entrega de respostas. |
| `clientflow-ai` | Camada própria de inteligência, contexto, orquestração, ferramentas e integração com modelos de IA. |
| Backend de domínio | Regras de negócio, autorização e execução de operações. |
| Supabase/PostgreSQL | Banco operacional individual de cada empresa, conforme a estratégia definida para o produto. |
| ClientFlow Mobile/Web | Interfaces para profissionais e administradores. |
| Meta WhatsApp Business Platform | Canal oficial de mensagens de cada empresa conectada. |

### Fluxo resumido

```text
WhatsApp Business da empresa
          |
          v
Aplicação Meta do ClientFlow
          |
          v
clientflow-bot / Webhook
          |
          v
Identificação segura da integração e da empresa
          |
          v
Backend de domínio + autorização
          |
          +------> clientflow-ai ------> Gemini (modelo inicial)
          |                 |
          |                 v
          |          Solicitação de ferramenta
          |                 |
          v                 v
Banco individual da empresa <--- validação e execução pelo backend
          |
          v
Resposta pelo WhatsApp Cloud API
```

**Regra de segurança:** o modelo de IA não escolhe livremente o banco, não recebe credenciais e não executa SQL. O backend determina o contexto, valida a autorização e executa operações permitidas.

---

## 📱 Integração WhatsApp: uma aplicação central, contas por empresa

A direção arquitetural escolhida é utilizar **uma aplicação da Meta pertencente ao ClientFlow** para gerenciar a integração de múltiplas empresas.

Cada empresa deverá conectar seus próprios ativos do WhatsApp Business, incluindo sua conta WhatsApp Business (WABA) e seu número empresarial, conforme os requisitos e permissões aplicáveis da Meta.

Isso significa:

- O ClientFlow mantém a aplicação de integração central.
- Cada empresa conecta seus próprios ativos do WhatsApp Business.
- Cada integração possui identificadores e credenciais próprios.
- O webhook identifica o número empresarial destinatário (`phone_number_id`) e localiza a integração correspondente.
- A aplicação seleciona o contexto e o banco operacional daquela empresa.
- Uma empresa não deve conseguir consultar ou utilizar os ativos de outra.

### Processo de conexão

A solução deverá avaliar e implementar o **Embedded Signup** da Meta, ou o fluxo oficial aplicável ao modelo de provedor adotado.

A disponibilidade do fluxo, permissões, revisão do aplicativo, verificação empresarial, requisitos de Tech Provider/Solution Partner e eventuais condições comerciais precisam ser confirmados diretamente na documentação e no painel da Meta antes do lançamento.

**Não presumir que basta criar uma aplicação Meta para conectar qualquer número.** O onboarding deve ser testado com contas reais de empresas e seguir os requisitos vigentes da plataforma.

### Cadastro central de integrações

É necessário manter um registro central que associe, no mínimo:

- Identificador interno da empresa (`organization_id`).
- Identificador da integração.
- `waba_id`.
- `phone_number_id`.
- Estado da conexão.
- Referência segura ao segredo/token.
- Datas de criação, renovação e revogação.

Tokens não devem ser armazenados em texto puro em tabelas comuns, logs, código-fonte ou variáveis acessíveis ao navegador. Preferir um gerenciador de segredos ou armazenamento criptografado com chave protegida separadamente. Aplicar rotação, revogação e privilégio mínimo.

---

## 🗄️ Bancos de dados: isolamento por empresa

**Requisito definido para o produto:** cada empresa cliente do ClientFlow terá seu próprio banco de dados operacional. Os dados de uma empresa não deverão ser compartilhados com o banco operacional de outra.

Ainda está pendente decidir a forma de provisionamento:

1. Um projeto Supabase independente por empresa; ou
2. Bancos PostgreSQL separados dentro de uma infraestrutura gerenciada; ou
3. Outra topologia que preserve efetivamente o requisito de isolamento.

Essas opções não são equivalentes em isolamento, custo, limites, operação e manutenção. A decisão deve considerar quantidade projetada de clientes, custo por projeto, backups, migrações, monitoramento e recuperação.

### Roteador de bancos

O roteador será um componente de backend. Ele deverá:

1. Receber uma identidade de integração validada.
2. Resolver o `organization_id` por meio de um cadastro central confiável.
3. Obter a referência de conexão/segredo correspondente.
4. Abrir conexão com o banco daquela empresa.
5. Aplicar autorização e regras de domínio.
6. Encerrar ou reutilizar a conexão de forma segura.

Não aceitar `organization_id`, URL de banco ou credenciais enviados livremente pelo usuário ou pelo modelo de IA. Não permitir que o Gemini selecione a conexão.

### Migrações e operação

Será necessário manter uma versão de schema padronizada e automatizar migrações por empresa, com:

- Controle de versão do schema.
- Execução gradual e monitorada.
- Backup antes de alterações críticas.
- Estratégia de rollback ou recuperação.
- Verificação de compatibilidade entre versões.
- Provisionamento e desativação controlados.

---

## 🧠 ClientFlow AI — camada própria de inteligência

O ClientFlow terá uma camada de inteligência independente do fornecedor do modelo. O nome proposto para esse serviço é **`clientflow-ai`**.

A recomendação é **não treinar um modelo de linguagem do zero nesta fase**. Em vez disso, desenvolver a inteligência de negócio do ClientFlow e utilizar modelos existentes por meio de uma interface intercambiável.

### Responsabilidades do `clientflow-ai`

- Interpretar a intenção da mensagem.
- Montar contexto mínimo e específico da empresa.
- Aplicar instruções e políticas do produto.
- Solicitar ferramentas disponíveis para aquele perfil.
- Tratar respostas, erros e ambiguidades.
- Solicitar confirmação em operações sensíveis.
- Registrar métricas e eventos sem expor dados desnecessários.

### Modelo inicial

O **Google Gemini** é o provedor inicial previsto, usando Function Calling quando adequado. O modelo exato, limites, preço, retenção de dados, região de processamento e condições de uso devem ser revalidados antes da produção.

### Independência do provedor

O `clientflow-ai` deverá usar uma interface interna de provedor, permitindo avaliar ou substituir o Gemini por outro modelo no futuro sem reescrever as regras de negócio.

Hospedar um modelo próprio de código aberto poderá ser avaliado futuramente se houver justificativa mensurável de custo, privacidade, latência ou desempenho. Isso não faz parte do primeiro escopo.

### Segurança da IA

- Tratar mensagens, anexos e histórico como conteúdo não confiável.
- Mitigar prompt injection e tentativas de manipular ferramentas.
- Não colocar segredos ou credenciais no prompt.
- Não permitir SQL livre gerado pelo modelo.
- Disponibilizar somente ferramentas necessárias ao perfil autorizado.
- Validar parâmetros e permissões no backend, mesmo após Function Calling.
- Exigir confirmação explícita para ações de impacto.
- Limitar dados pessoais enviados ao provedor de IA.
- Definir retenção, exclusão e auditoria do contexto.

---

## 👥 Perfis de atendimento

O desenho inicial prevê dois contextos principais:

### 1. Atendimento ao cliente

- Consultar serviços e preços publicados pela empresa.
- Consultar disponibilidade.
- Coletar somente os dados necessários.
- Solicitar criação, alteração ou cancelamento de agendamento.
- Confirmar a operação e informar o resultado.

### 2. Atendimento ao profissional/administrador

- Consultar agenda e indicadores autorizados.
- Consultar metas e informações financeiras permitidas.
- Bloquear horários e registrar folgas.
- Alterar operações somente após validação de identidade, permissão e parâmetros.

O número de telefone pode ser um sinal de identificação, mas não deve ser tratado isoladamente como prova suficiente de autorização para ações administrativas sensíveis. Deve existir processo seguro de vinculação, gestão de usuários, revogação e recuperação de acesso.

---

## 🔐 Segurança e proteção de dados

Segurança e privacidade são requisitos estruturais do projeto, não funcionalidades posteriores.

### Controles obrigatórios antes da produção

1. **Autenticação e autorização no backend:** cada operação valida identidade, empresa, papel e permissão.
2. **Isolamento por empresa:** o roteador só pode resolver conexões a partir de registros confiáveis.
3. **Webhook:** validar a assinatura `X-Hub-Signature-256` usando o segredo da aplicação Meta e o corpo original da requisição, além da verificação inicial do webhook.
4. **Segredos:** armazenar tokens e chaves em mecanismo apropriado, com rotação e revogação.
5. **Idempotência:** impedir que reenvios de webhook executem uma mesma operação mais de uma vez.
6. **Concorrência:** impedir reservas simultâneas para o mesmo recurso e horário por meio de transações e restrições no banco.
7. **Auditoria:** registrar operações administrativas, ator, empresa, horário, resultado e identificador de correlação, evitando registrar conteúdo sensível sem necessidade.
8. **Minimização:** enviar ao modelo somente os dados necessários para a tarefa.
9. **Retenção:** definir prazos para histórico de conversa, logs e dados operacionais.
10. **Incidentes:** estabelecer monitoramento, resposta, comunicação e recuperação.

### LGPD

O produto deverá documentar finalidades, bases legais aplicáveis, transparência, direitos dos titulares, retenção, operadores/suboperadores, compartilhamento com provedores e transferência internacional quando aplicável.

A definição dos papéis de controlador e operador depende da relação concreta entre ClientFlow e cada empresa cliente. Contratos, avisos de privacidade e procedimentos deverão ser revisados com profissional jurídico especializado.

---

## 💬 Regras de mensagens e custos da Meta

Não assumir que o uso da WhatsApp Cloud API é integralmente gratuito.

A cobrança depende das regras vigentes da Meta, categoria do template, país do destinatário, entrega, janela de atendimento e demais condições aplicáveis.

Antes de implementar lembretes e mensagens iniciadas pela empresa:

- Consultar a tabela oficial de preços vigente para o Brasil.
- Verificar as regras atuais da janela de atendimento.
- Validar aprovação e categoria dos templates.
- Registrar eventos de envio, entrega, falha e custo estimado.
- Oferecer alternativas de envio quando a mensagem automática não for permitida ou não for economicamente adequada.

O fluxo de lembrete por deep link pode ser considerado como alternativa operacional, mas não deve ser apresentado como substituto automático de todas as regras da Meta.

---

## ⚙️ Tecnologias previstas

| Camada | Tecnologia prevista | Observação |
|---|---|---|
| Runtime | Node.js + TypeScript | Tipagem estrita e validação de payloads. |
| Hospedagem | Vercel ou serviço equivalente | Validar limites, timeout, concorrência e custo. |
| Mensageria | WhatsApp Business Platform / Cloud API | Aplicação central do ClientFlow e ativos conectados por empresa. |
| IA | Gemini inicialmente | Acesso por meio do `clientflow-ai`. |
| Banco | Supabase/PostgreSQL | Banco operacional separado por empresa; topologia pendente. |
| Tarefas agendadas | A definir | Avaliar cron, filas, retries e observabilidade. |
| Segredos | Gerenciador de segredos | Não manter tokens em texto puro. |
| Observabilidade | A definir | Logs estruturados, métricas, alertas e rastreamento. |

Não há garantia de custo zero. Planos gratuitos, cotas, limites e políticas dos fornecedores podem mudar e devem ser verificados antes de cada etapa de lançamento.

---

## 🧪 Qualidade e critérios de liberação

O sistema não deverá ser liberado para produção antes de passar por testes que incluam:

- Uma empresa não consegue acessar dados de outra.
- Uma integração WhatsApp não consegue selecionar o banco de outra empresa.
- Um cliente não consegue executar ferramentas administrativas.
- Um número administrativo não autorizado não consegue consultar informações restritas.
- Reenvio de webhook não duplica agendamentos nem operações.
- Duas reservas concorrentes não ocupam indevidamente o mesmo horário.
- Prompt injection não contorna autorização ou regras de negócio.
- Tokens e dados pessoais não aparecem em logs ou respostas indevidas.
- Falhas do Gemini, Meta ou banco são tratadas sem confirmar operações não realizadas.
- Backup e restauração individual são testados.

O piloto deve começar com poucas empresas, dados controlados e monitoramento próximo.

---

## 🧭 Decisões pendentes

| Tema | Situação |
|---|---|
| Banco separado por empresa | Requisito definido |
| Topologia exata do banco | Pendente |
| Aplicação Meta central do ClientFlow | Direção escolhida |
| Onboarding via Embedded Signup | A validar com requisitos atuais da Meta |
| Conta WABA e número por empresa | Direção escolhida |
| Armazenamento e rotação de tokens | Projetar e implementar |
| `clientflow-ai` como camada própria | Direção escolhida |
| Gemini como modelo inicial | Direção escolhida |
| Hospedagem de modelo próprio | Fora do escopo inicial |
| Preços e templates Meta | Verificar antes da produção |
| Política LGPD e retenção | Projetar e validar |
| Testes de segurança independentes | Necessários antes de escala |

---

## 📂 Estrutura de pastas proposta

```text
clientflow-bot/
├── api/
│   └── webhook.ts
├── src/
│   ├── lib/
│   │   ├── meta.ts
│   │   ├── secrets.ts
│   │   └── logger.ts
│   ├── services/
│   │   ├── webhook-verification.ts
│   │   ├── integration-resolver.ts
│   │   ├── tenant-database-router.ts
│   │   └── whatsapp-messaging.ts
│   ├── security/
│   │   ├── authorization.ts
│   │   ├── signature-validation.ts
│   │   └── idempotency.ts
│   └── types/
├── docs/
│   ├── ARCHITECTURE_WHATSAPP_AI.md
│   └── AGENTS.md
├── .env.example
├── package.json
├── tsconfig.json
└── vercel.json
```

A estrutura é uma proposta de organização, não uma descrição garantida do código já implementado.

---

## 🚀 Desenvolvimento

O fluxo básico de instalação permanece:

```bash
git clone https://github.com/abrunos94/clientflow-bot.git
cd clientflow-bot
npm install
```

Antes de configurar variáveis e publicar o serviço, revisar o `.env.example`, os ambientes de desenvolvimento/homologação/produção e o mecanismo de gerenciamento de segredos.

Não utilizar chaves reais em arquivos versionados. Nunca enviar `SUPABASE_SERVICE_ROLE_KEY`, tokens da Meta ou chaves de IA ao aplicativo mobile, frontend, repositório ou prompts.

---

## 📚 Documentação

- [`docs/ARCHITECTURE_WHATSAPP_AI.md`](./docs/ARCHITECTURE_WHATSAPP_AI.md) — arquitetura, integrações, isolamento, segurança e decisões técnicas.
- [`docs/AGENTS.md`](./docs/AGENTS.md) — equipe de agentes, responsabilidades, limites e fluxo de trabalho.

---

Desenvolvido por **Alex Bruno** — parte do ecossistema ClientFlow.
