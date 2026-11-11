# Arquitetura Técnica — `clientflow-bot` e `clientflow-ai`

**Projeto:** ClientFlow  
**Escopo:** integração WhatsApp, inteligência artificial e acesso aos bancos individuais das empresas  
**Estado:** arquitetura proposta; itens pendentes precisam de validação e implementação.

---

## 1. Objetivo e princípios

O `clientflow-bot` é o serviço de integração oficial com o WhatsApp Business Platform. Ele recebe eventos da Meta, identifica a integração empresarial, encaminha a solicitação para o backend e entrega a resposta pelo canal apropriado.

O `clientflow-ai` é a camada própria de inteligência do ClientFlow. Ela organiza contexto, interpreta intenções e solicita ferramentas de domínio. O Gemini será o primeiro provedor de modelo previsto, mas a arquitetura deverá permitir substituição futura.

### Princípios obrigatórios

1. Cada empresa cliente possui seu próprio banco operacional.
2. Uma aplicação Meta central do ClientFlow gerencia a integração de múltiplas empresas, cada uma conectando seus próprios ativos WhatsApp Business.
3. O backend, e não o modelo de IA, é responsável por autenticação, autorização e execução.
4. Credenciais nunca são fornecidas ao modelo de IA.
5. O sistema aplica minimização de dados e rastreabilidade.
6. Falhas externas não podem resultar em operações confirmadas que não foram concluídas.
7. Segurança, privacidade e integridade são critérios de aceite.

---

## 2. Contexto operacional

O público inicial inclui barbearias, mas o produto deverá atender outros prestadores de serviços. A operação é predominantemente móvel: o profissional pode estar atendendo e precisar consultar a agenda ou executar ações sem navegar por várias telas.

O WhatsApp é um canal adicional ao aplicativo ClientFlow, não o banco de dados nem a fonte definitiva das regras de negócio.

### Perfis de uso

- **Cliente final:** consulta serviços, preços, horários e solicita operações de agendamento.
- **Profissional/administrador:** consulta informações e executa operações autorizadas da própria empresa.
- **Operador da plataforma:** administra integrações e suporte com acesso controlado e auditado; não deve ter acesso indiscriminado aos dados operacionais.

---

## 3. Visão geral da arquitetura

```text
                 CLIENTFLOW
        Aplicativo mobile / painel web
                      |
                      v
             Backend de domínio
                      |
          +-----------+-----------+
          |                       |
          v                       v
   Cadastro central         clientflow-ai
   de organizações          Orquestração de IA
   e integrações                   |
          |                        v
          |                 Provedor de modelo
          |                    Gemini*
          |
          v
WhatsApp Business Platform
Aplicação Meta do ClientFlow
          |
          v
   clientflow-bot / Webhook
          |
          v
Validação + idempotência
          |
          v
Resolução da integração
          |
          v
Autorização e contexto da empresa
          |
          v
Roteador seguro do banco
          |
          v
Banco operacional individual
          |
          v
Resposta validada -> WhatsApp Cloud API

* Gemini é o provedor inicial previsto, não uma dependência permanente.
```

Os serviços podem ser implantados separadamente ou inicialmente como módulos de um mesmo repositório, desde que suas responsabilidades e limites de segurança permaneçam claros.

---

## 4. WhatsApp Business Platform: modelo multiempresa

### 4.1 Aplicação Meta central

A direção escolhida é manter uma aplicação da Meta pertencente ao ClientFlow para a integração da plataforma.

Cada empresa cliente conectará seus próprios ativos do WhatsApp Business, conforme o processo e as permissões aprovados pela Meta. Em regra, a integração deve manter o vínculo individual entre empresa, WABA e número empresarial.

O ClientFlow não deve tratar um único token genérico como credencial de todas as empresas.

### 4.2 Embedded Signup

Avaliar o Embedded Signup para permitir que a empresa conecte seus ativos durante o onboarding do ClientFlow.

Antes de produção, validar:

- Requisitos de cadastro e verificação empresarial.
- Permissões necessárias e revisão do aplicativo.
- Modelo aplicável de Tech Provider/Solution Partner.
- Fluxo de autorização e consentimento.
- Gestão de ativos e propriedade das contas.
- Tokens, expiração, renovação e revogação.
- Requisitos de coexistência, se o produto oferecer esse recurso.
- Políticas e limitações atuais da Meta.

A existência do recurso não garante aprovação automática ou acesso irrestrito. O processo deve ser testado em ambiente de desenvolvimento e com contas reais autorizadas.

### 4.3 Registro central de integrações

O serviço de plataforma precisa manter um registro central. Campos conceituais:

| Campo | Uso |
|---|---|
| `integration_id` | Identificador interno da conexão |
| `organization_id` | Empresa proprietária da conexão |
| `waba_id` | Identificador da conta WhatsApp Business |
| `phone_number_id` | Identificador do número conectado |
| `secret_reference` | Referência ao segredo protegido |
| `status` | Estado da conexão |
| `created_at` | Criação |
| `updated_at` | Última atualização |
| `revoked_at` | Revogação, quando houver |

O registro central contém metadados de roteamento e referências seguras. Não deve se transformar em um banco operacional compartilhado com os dados de clientes, agendamentos e finanças de todas as empresas.

### 4.4 Roteamento da mensagem recebida

Fluxo proposto:

1. Receber o POST do webhook.
2. Preservar o corpo original para validar a assinatura.
3. Validar `X-Hub-Signature-256` com o segredo da aplicação Meta.
4. Validar estrutura e tipo do evento.
5. Extrair o `phone_number_id` destinatário e o identificador da mensagem.
6. Consultar o cadastro central de integrações.
7. Resolver `organization_id` e referência segura do segredo.
8. Verificar estado da conexão e permissões.
9. Resolver o banco operacional individual.
10. Processar a mensagem de forma idempotente.
11. Enviar a resposta pela credencial da integração correta.

Não confiar em nome, telefone ou texto informado pelo remetente para escolher a empresa. O identificador do número destinatário deve ser correlacionado com o cadastro central validado.

### 4.5 Credenciais

- Não gravar tokens em texto puro em tabelas comuns.
- Preferir secret manager ou envelope encryption.
- Manter chaves de criptografia fora do banco que armazena os dados cifrados.
- Restringir leitura de segredos ao serviço que realmente precisa deles.
- Rotacionar e revogar credenciais.
- Nunca registrar tokens em logs, rastreamentos, mensagens de erro ou prompts.
- Separar credenciais de desenvolvimento, homologação e produção.

---

## 5. Estratégia de bancos individuais por empresa

### 5.1 Requisito

Cada cliente do ClientFlow — barbearia ou outro prestador — terá seu próprio banco operacional. Os registros de uma empresa não devem residir no banco operacional de outra.

### 5.2 Decisão de topologia ainda pendente

“Banco separado” pode representar topologias diferentes:

**Alternativa A — Um projeto Supabase por empresa**

- Projeto, PostgreSQL, credenciais e recursos separados.
- Maior separação operacional.
- Mais projetos para provisionar, monitorar, atualizar e pagar.
- Verificar limites e condições comerciais do Supabase.

**Alternativa B — Um banco PostgreSQL por empresa na mesma infraestrutura**

- Bancos distintos dentro de um servidor/cluster gerenciado.
- Isolamento de banco, mas infraestrutura subjacente compartilhada.
- Exige gestão cuidadosa de usuários, conexões, backups e permissões.

**Alternativa C — Schemas separados**

- Não equivale a um banco independente.
- Só deve ser considerada se o requisito de isolamento for revisto expressamente.
- Não é a interpretação padrão do requisito atualmente definido.

A decisão final deve ser registrada após estimativa de custo, escala, operação e requisitos de segurança. Não assumir que a opção A já foi escolhida.

### 5.3 Cadastro central e roteador

O cadastro central mantém o vínculo entre `organization_id` e a localização lógica/segredo do banco da empresa.

O roteador deve:

- Aceitar somente identificadores internos originados de contexto validado.
- Buscar a configuração em fonte confiável.
- Nunca aceitar host, URL, senha ou nome de banco arbitrário vindo de usuário ou IA.
- Aplicar privilégio mínimo nas credenciais.
- Evitar vazamento de conexão entre requisições serverless.
- Gerenciar pool/conexões dentro dos limites da infraestrutura.
- Ter timeouts, circuit breaker e tratamento de indisponibilidade.
- Registrar identificadores de correlação sem expor dados sensíveis.

### 5.4 Provisionamento e migrações

Construir um processo automatizado para:

1. Criar o banco/projeto da empresa.
2. Aplicar schema inicial e políticas.
3. Criar credenciais e armazenar referências a segredos.
4. Registrar o banco no cadastro central.
5. Executar verificações de saúde.
6. Aplicar migrações versionadas.
7. Fazer backup e validar restauração.
8. Desativar e excluir dados conforme processo aprovado e obrigações legais.

Toda migração deve ser versionada, testada e observável. Não aplicar mudanças manuais sem registro nos bancos de clientes.

---

## 6. `clientflow-ai`: camada própria de inteligência

### 6.1 Decisão

Criar uma camada de inteligência de domínio própria do ClientFlow, chamada `clientflow-ai`.

Isso **não significa treinar um modelo de linguagem do zero**. A primeira versão utilizará um provedor externo, inicialmente Gemini, por meio de uma interface interna.

A propriedade intelectual do ClientFlow estará principalmente em:

- Fluxos e regras de negócio.
- Contexto e instruções de domínio.
- Catálogo de ferramentas.
- Orquestração.
- Avaliações de qualidade.
- Segurança e limites.
- Integração com os dados e serviços do produto.

### 6.2 Componentes propostos

| Módulo | Responsabilidade |
|---|---|
| `context-builder` | Monta contexto mínimo da empresa e da conversa. |
| `intent-router` | Classifica intenção e direciona o fluxo. |
| `provider-adapter` | Abstrai Gemini e futuros provedores. |
| `tool-registry` | Expõe somente ferramentas permitidas ao contexto. |
| `conversation-policy` | Define limites, tom, escalonamento e confirmações. |
| `response-validator` | Verifica formato, resultado e conteúdo antes do envio. |
| `evaluation` | Mede qualidade, segurança, latência e custo. |

### 6.3 Fluxo de Function Calling

1. O backend autentica e determina empresa, usuário e permissões.
2. O sistema prepara contexto minimizado.
3. O modelo interpreta a solicitação e pode sugerir uma ferramenta.
4. O backend valida ferramenta, parâmetros, empresa e permissão.
5. Se necessário, solicita confirmação explícita.
6. O serviço de domínio executa a operação.
7. O resultado real é devolvido ao modelo para formulação da resposta.
8. O backend valida e envia a resposta.

O modelo nunca deve ser a autoridade final sobre permissões ou estado de uma operação.

### 6.4 Ferramentas iniciais

**Cliente:**

- `list_services()`
- `list_available_slots(date, service_id)`
- `request_booking(service_id, date, time, client_name)`
- `request_cancellation(appointment_id)`
- `request_reschedule(appointment_id, new_date, new_time)`

**Profissional/administrador:**

- `get_daily_schedule(date)`
- `get_financial_goal_status(period)`
- `request_block_schedule_slot(date, time, reason)`
- `get_business_summary(period)`

Os nomes são propostas. Cada ferramenta deverá ter schema estrito, validação, autorização, limites, idempotência e testes. Ferramentas administrativas não devem ser disponibilizadas ao contexto de cliente.

### 6.5 Escolha do modelo e possibilidade de hospedagem própria

**Primeira etapa:** Gemini como provedor inicial.

**Arquitetura:** adaptador independente para permitir comparação e substituição por outro modelo.

**Etapa futura opcional:** avaliar modelos de código aberto hospedados pelo ClientFlow.

A hospedagem própria só deverá avançar se testes demonstrarem benefício claro em custo total, privacidade, latência ou qualidade. Considerar GPU, disponibilidade, atualização, observabilidade, segurança e suporte. Treinar um modelo do zero não faz parte do escopo inicial.

### 6.6 Segurança específica de IA

- Prompt injection: mensagens e documentos são dados não confiáveis.
- Exfiltração: não inserir segredos ou dados de outros clientes no contexto.
- Abuso de ferramentas: validar no backend toda chamada.
- Escalada de privilégio: não inferir papel administrativo a partir do texto.
- Alucinação: não afirmar que uma operação ocorreu sem confirmação do serviço.
- Contexto excessivo: limitar histórico e dados enviados.
- Saída insegura: validar respostas e dados antes de enviar.
- Abuso e custo: aplicar limites de uso, quotas e monitoramento.

---

## 7. Segurança do backend e dos dados

### 7.1 Identidade e autorização

A autorização deve considerar, no mínimo:

- Organização (`organization_id`).
- Usuário ou identidade verificada.
- Papel e permissões.
- Estado da conta.
- Recurso solicitado.
- Operação solicitada.

O telefone pode ajudar na identificação, mas não é prova isolada suficiente para ações administrativas críticas. Implementar processo de associação e revogação de números e usuários.

### 7.2 Supabase e chaves privilegiadas

Se for utilizada `service_role`, lembrar que essa chave possui privilégios elevados e pode ignorar RLS. Portanto:

- Mantê-la somente em backend confiável.
- Nunca disponibilizá-la no app, frontend ou modelo de IA.
- Validar autorização no backend antes de cada operação.
- Preferir credenciais de escopo menor quando viável.
- Testar políticas com usuários e cenários reais.

RLS é uma camada de defesa importante, mas não substitui a autorização da aplicação.

### 7.3 Webhooks e idempotência

- Validar assinatura usando corpo original e segredo da aplicação.
- Validar tipo, tamanho e estrutura do payload.
- Persistir identificador de mensagem/evento processado.
- Usar chave idempotente para operações de negócio.
- Responder à Meta conforme o contrato de webhook e processar tarefas demoradas de forma assíncrona quando necessário.
- Tratar reentrega, ordem variável e falhas transitórias.

### 7.4 Concorrência de agendamento

A consulta de disponibilidade não garante que o horário continue livre no momento da gravação.

A operação de reserva deve ser atômica, com transação, restrição de integridade ou mecanismo equivalente que impeça dois agendamentos incompatíveis. O teste deve simular requisições concorrentes.

### 7.5 Auditoria e observabilidade

Registrar eventos relevantes:

- Empresa e usuário/ator.
- Ferramenta e operação.
- Recurso afetado.
- Resultado.
- Timestamp.
- ID da mensagem e correlação.
- Motivo de recusa ou falha.

Evitar registrar texto integral de conversas, tokens, dados financeiros completos ou dados pessoais quando não forem necessários. Definir acesso, retenção e descarte dos logs.

---

## 8. LGPD e privacidade

O ClientFlow deverá mapear os dados pessoais tratados e documentar:

- Finalidade e base legal de cada tratamento.
- Transparência para clientes e profissionais.
- Papéis de controlador e operador em cada relação.
- Compartilhamentos com Meta, Google e provedores de infraestrutura.
- Transferências internacionais, quando aplicáveis.
- Retenção e eliminação.
- Atendimento aos direitos dos titulares.
- Gestão de incidentes.
- Contratos e instruções a operadores/suboperadores.

A definição de papéis depende da operação concreta e deve ser revisada juridicamente. Avaliar a necessidade de Relatório de Impacto à Proteção de Dados Pessoais conforme riscos e orientação da ANPD.

---

## 9. Mensagens, janela de atendimento e custos

Não utilizar a premissa “100% gratuito” como compromisso de produto.

A Meta pode aplicar regras de cobrança por mensagem/template, categoria, país, janela e demais critérios vigentes. O sistema deve consultar a tabela oficial atualizada para o Brasil e registrar os eventos necessários para estimar custos.

Antes de ativar lembretes:

1. Verificar a janela de atendimento aplicável.
2. Verificar categoria, aprovação e custo do template.
3. Respeitar opt-in, políticas e regras aplicáveis.
4. Registrar envio, entrega e falha.
5. Definir alternativa operacional quando o envio automático não for permitido ou não for econômico.

O deep link para o profissional iniciar uma mensagem manual pode ser uma alternativa de produto, mas não substitui as obrigações da plataforma.

---

## 10. Disponibilidade, filas e limites

Vercel Serverless pode ser adequada para iniciar, mas a arquitetura deve considerar:

- Limites de duração de execução e concorrência do plano.
- Filas ou processamento assíncrono para tarefas demoradas.
- Retry com backoff e limites.
- Dead-letter ou fila de falhas.
- Timeouts por integração.
- Proteção contra tempestade de mensagens.
- Observabilidade de ponta a ponta.
- Custos de chamadas de IA e mensageria.
- Estratégia de indisponibilidade do banco ou provedor.

Os tempos de resposta estimados na documentação inicial não são SLA garantido. Medir p50, p95 e p99 em ambiente real antes de divulgar metas.

---

## 11. Testes e critérios de aceite

### Isolamento

- Mensagem recebida no número A nunca seleciona banco B.
- Credencial A não autentica no banco B.
- Usuário da empresa A não lê dados da empresa B.
- Falha na resolução da integração resulta em recusa segura.

### Autorização

- Cliente não acessa ferramenta administrativa.
- Profissional só acessa operações permitidas.
- Número não vinculado não recebe privilégios.
- A IA não consegue ampliar permissões por instrução no prompt.

### Integridade

- Webhook repetido não duplica operação.
- Reserva concorrente não cria conflito.
- Cancelamento/alteração exige identificação inequívoca do recurso.
- Resposta não declara sucesso antes da confirmação do banco.

### Segurança e privacidade

- Assinatura inválida é rejeitada.
- Segredos não aparecem em logs, prompts ou respostas.
- Dados de outra empresa não entram no contexto do modelo.
- Retenção e exclusão são testadas.
- Backups individuais podem ser restaurados.

### Resiliência

- Indisponibilidade do Gemini não corrompe dados.
- Indisponibilidade da Meta não perde silenciosamente eventos.
- Falha temporária do banco gera resposta segura e possibilidade de recuperação.
- Limites e custo são monitorados.

---

## 12. Implantação por fases

### Fase 1 — Fundamentos

- Definir topologia de banco individual.
- Criar cadastro central de organizações e integrações.
- Projetar autorização e gestão de segredos.
- Definir modelo de ameaças e requisitos LGPD.

### Fase 2 — WhatsApp oficial

- Configurar aplicação Meta central.
- Implementar onboarding oficial/Embedded Signup, se aprovado.
- Validar assinatura do webhook.
- Implementar resolução de integração e idempotência.

### Fase 3 — Backend multiempresa

- Provisionar bancos individuais.
- Criar roteador seguro.
- Implementar migrações.
- Testar isolamento e concorrência.

### Fase 4 — ClientFlow AI

- Implementar adaptador Gemini.
- Implementar contexto e ferramentas.
- Validar autorização no backend.
- Implementar confirmações e avaliação de respostas.

### Fase 5 — Piloto

- Testar com poucas empresas autorizadas.
- Medir latência, falhas, custos e qualidade.
- Executar testes de segurança.
- Corrigir problemas antes de ampliar.

---

## 13. Decisões registradas e pendências

| Decisão | Estado |
|---|---|
| Cada empresa terá banco operacional próprio | Definido |
| Um projeto Supabase por empresa ou outra topologia | Pendente |
| Aplicação Meta central do ClientFlow | Direção escolhida |
| WABA e número próprios por empresa conectada | Direção escolhida |
| Embedded Signup e requisitos de provedor | Validar com Meta |
| `clientflow-ai` como camada de inteligência própria | Direção escolhida |
| Gemini como primeiro provedor | Direção escolhida |
| Modelo próprio hospedado pelo ClientFlow | Fora do escopo inicial |
| Gerenciamento central seguro de tokens | Obrigatório, a implementar |
| LGPD, retenção e contratos | A definir e validar |
| Testes independentes de segurança | Obrigatórios antes da escala |

---

## 14. Referências oficiais para validação

Consultar sempre a versão vigente antes da implementação:

- Meta for Developers — WhatsApp Business Platform: https://developers.facebook.com/docs/whatsapp/
- Meta — Embedded Signup: https://developers.facebook.com/docs/whatsapp/embedded-signup/
- Meta — Webhooks: https://developers.facebook.com/docs/graph-api/webhooks/
- Supabase — Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase — API keys: https://supabase.com/docs/guides/api/api-keys
- Google AI for Developers — Gemini API: https://ai.google.dev/gemini-api/docs
- ANPD — Segurança e proteção de dados: https://www.gov.br/anpd/

As referências são pontos de partida. Requisitos, preços, limites, versões e políticas podem mudar.
