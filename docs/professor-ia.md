# Professor EducaMoz AI — arquitetura e limites atuais

## Análise e dados existentes

O projeto usa React/Vite e Supabase Auth. A área de estudo já possui `profiles`, `subjects`, `topics`, `materials`, `exams`, `exam_questions`, `exam_answer_keys`, `exam_attempts` e `chat_messages`, com políticas RLS. A API `/api/ai` já é servida por Express localmente e por uma função Node na Vercel. O histórico antigo em `chat_messages` é preservado: `session_id` nulo continua a ser mostrado em «Conversas anteriores» e utilizável pelo cliente anterior.

## Implementação desta etapa

- `tutor_sessions`: aulas por utilizador com classe/nível, disciplina, matéria, objetivo, modo e arquivo. `chat_messages.session_id` associa mensagens a aulas; uma política RLS restritiva exige que a aula pertença ao autor. O utilizador pode restaurar aulas arquivadas.
- O backend valida o token Supabase com `getUser`, consulta a aula e as últimas 12 mensagens com o token do próprio utilizador e RLS, e recusa aulas de outro utilizador. Classe, disciplina, tópico e objetivo são inseridos como conteúdo não confiável, não como instruções de sistema. A conversa antiga continua disponível. O contexto é limitado; mensagens mais antigas não são resumidas automaticamente.
- A identidade pedagógica e os seis modos são instruções para o modelo, não garantias de precisão, adequação curricular ou classificação. Não se consulta um currículo automaticamente e os simulados gerados não são oficiais.
- `reserve_tutor_request()` usa um bloqueio transacional por utilizador e registos persistentes: por defeito, Free tem 20 pedidos/dia e Premium 120/dia, com 5/minuto. São valores operacionais iniciais, não uma oferta comercial nem pagamentos. O dia começa às 00:00 UTC. Um pedido reservado é contado mesmo se o Gemini falhar. A reserva é exigida no servidor, que falha fechado caso esteja indisponível. `tutor_plans` não tem escrita de clientes; Premium ainda não está disponível para compra. As cotas não constituem faturação nem medição de tokens. Configure também limites no fornecedor e monitorização de custos.
- O painel de desempenho acrescenta contagem de aulas, exames e taxa de acerto em exames guardados, sem estimar tempo ou domínio. Um nome de disciplina é contabilizado apenas se foi selecionado numa aula.
- O texto da IA é apresentado como Markdown/GFM e matemática KaTeX com `trust:false`; HTML não é executado e imagens remotas são ignoradas.

## Segurança e privacidade

Todas as novas tabelas usam RLS. Anónimos não podem reservar, e utilizadores não podem alterar diretamente `tutor_plans` ou inserir em `tutor_usage`. Conversas são dados pessoais: a pergunta, o contexto da aula e as mensagens recentes são transmitidos ao Gemini; são guardadas no Supabase. O utilizador deve ser informado e devem existir políticas de retenção, eliminação e consentimento adequadas, em particular para menores. O serviço usa apenas chave pública Supabase e JWT do estudante; nunca a chave de serviço no browser. O histórico existente ainda permite que o próprio utilizador insira mensagens com papel `assistant`: assim, o histórico é informação não confiável e não deve servir para notas oficiais, auditoria ou atribuição automática de competências. Para tornar respostas verificáveis é necessário mover a gravação da resposta para um backend privilegiado, com controlo de acesso e proteção de credenciais.

## O que ainda não está implementado

1. Upload de PDF, imagens e documentos, extração, armazenamento privado, embeddings/pgvector, RAG, citações e fontes verificáveis. O botão de anexo está desativado intencionalmente.
2. Resumos automáticos de conversas longas, memória transversal de dificuldades/competências, classificação de respostas abertas com rubricas, ajuste de dificuldade baseado em resultados e recomendações fundamentadas em dados longitudinais.
3. Plano de estudo estruturado, ajustável e persistido; pedidos conversacionais de plano podem ser feitos ao professor, mas não são um sistema de planos.
4. Tempo real de estudo, métricas de domínio, gráficos de evolução e métricas de exercícios além dos exames existentes.
5. Pagamentos, subscrições e gestão de direitos Premium. A tabela de planos é uma base técnica sem interface de aquisição.
6. Limitação de custo global, retenção automática dos eventos de utilização, observabilidade completa, recuperação de contas, avaliação pedagógica por especialistas e testes de segurança independentes.

## Validação

`npm test` exercita os modos e o contexto, limites e isolamento simulados no handler, e falhas simuladas do Gemini. Os testes unitários não provam que as explicações do modelo estejam corretas. No Supabase, a migração foi aplicada e verificaram-se metadados RLS/permissões, a reserva, bloqueio por minuto, bloqueio diário e isolamento simulado por claims SQL, tudo com transações revertidas. Não foram testados dois utilizadores reais em simultâneo nem a integração Gemini com chave válida, nem um PDF. Os cenários didáticos de frações, equação, erro do estudante, simulado e adaptação à classe precisam de avaliação real de respostas com o modelo e de um especialista; estão cobertos apenas os modos/contextos de pedido em testes automatizados.

## Configuração e implantação

A migração `20261109112552_tutor_sessions.sql` é aditiva e já foi aplicada ao projeto Supabase ligado nesta sessão; aplique-a em qualquer outro ambiente antes do novo backend. Variáveis: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (públicas), `GEMINI_API_KEY` (apenas servidor), `GEMINI_MODEL` opcional (por omissão `gemini-flash-latest`) e `PORT` local opcional. Não colocar chaves em ficheiros versionados nem em mensagens. Atualizações de ambiente na Vercel requerem novo deploy. A chave enviada anteriormente na conversa ficou exposta e deve ser revogada/substituída diretamente no fornecedor e na Vercel.


## Diagnóstico operacional de `/api/ai`

Cada pedido recebe um `X-Request-Id` gerado pelo servidor. Nos logs da função Vercel, o evento JSON `ai_request` inclui esse identificador, etapa, modelo, estado HTTP devolvido ao cliente, duração total e, se houve chamada ao fornecedor, duração do Gemini. Respostas HTTP de erro do Gemini incluem também `geminiHttpStatus` e, quando reconhecido, `geminiStatus`. Não são registados corpos de pedido ou resposta, identidade de utilizador, tokens nem chaves.

O texto de erro do Gemini pode incluir dados de estudantes ou credenciais. Por isso `geminiMessage` mostra a mensagem original apenas se corresponder exatamente a uma lista de mensagens estáticas conhecidas; caso contrário indica que foi suprimida. Não se deve contornar esta proteção registando indiscriminadamente o corpo do erro. O HTTP e o estado do fornecedor continuam a ajudar no diagnóstico, mas podem não revelar a causa exata. Esta mudança ainda não foi validada num pedido Gemini real.

Para diagnosticar: publicar a alteração no ambiente apropriado, iniciar sessão como estudante e enviar uma pergunta; recolher apenas o cabeçalho `X-Request-Id` da resposta `/api/ai` e procurar esse identificador nos logs de runtime da função. Não partilhar o cabeçalho Authorization, conteúdo da conversa ou chaves. A chave configurada só em Production não é herdada por Preview; se necessário, um administrador deve configurar uma chave adequada para Preview diretamente na Vercel e criar novo deploy. A disponibilidade de um modelo, a validade da chave, faturação e quota devem ser confirmadas com o fornecedor; um estado READY da Vercel ou testes unitários não comprovam uma geração bem-sucedida. Não mudar automaticamente para outro modelo sem verificar a disponibilidade e impacto.
