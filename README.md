# EducaMoz AI

Plataforma educativa em português, com uma página pública e uma área de estudo responsiva. O modo local permite explorar disciplinas, realizar um exercício de demonstração, rever resultados e guardar um nome no navegador. O exercício é identificado como demonstração, não como exame oficial. A biblioteca não contém materiais até existir uma fonte de dados real.

## Executar localmente

Requisitos: Node.js 22 e npm.

```sh
npm install
cp .env.example .env
# Terminal 1: API
npm run server
# Terminal 2: interface
npm run dev
```

O Vite encaminha `/api` para o servidor local. Para uma execução de produção: `npm run build` e `npm start`; o servidor entrega a interface compilada e a API na porta `PORT` (3001 por omissão).

## Integrações

- **Supabase Auth:** define `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em `.env` e configura as URLs de redirecionamento e confirmação de email no projeto Supabase. O registo e a entrada usam Supabase Auth. O perfil e os resultados continuam locais mesmo com sessão iniciada; não são sincronizados nem associados à conta.
- **Gemini:** define `GEMINI_API_KEY` no ambiente do servidor (e, opcionalmente, `GEMINI_MODEL`). A chave nunca é enviada ao navegador. A API valida a sessão Supabase e aplica um limite básico de pedidos por utilizador. Sem chave, a API devolve uma mensagem clara de indisponibilidade. A conversa é mantida na interface apenas durante a sessão; cada pedido ao modelo contém apenas a pergunta atual.
- **Administração e Premium:** são pontos de extensão, não funcionalidades ativas. Não existem pagamentos, dados administrativos ou permissões fictícias.

## Antes de publicar

Esta é uma base funcional, não uma implantação de produção concluída. Antes de disponibilizar publicamente, reforçar a autorização e adicionar limitação de pedidos persistente e partilhada para a API de IA, proteção contra abuso e controlo de custos; configurar políticas RLS e modelo de dados no Supabase para sincronização; implementar gestão segura de conteúdos e permissões administrativas; e rever privacidade, consentimento (incluindo menores), acessibilidade, monitorização e testes. O armazenamento local pode ser apagado pelo navegador e não é adequado para dados sensíveis. O servidor não deve ser exposto com uma chave Gemini até estas proteções estarem implementadas.

## Publicar na Vercel

O projeto inclui `vercel.json`: a Vercel compila o Vite para `dist`, encaminha as rotas da área de estudo para a aplicação e disponibiliza `/api/ai` como função Node. Liga o projeto ao repositório, define as variáveis de ambiente necessárias na Vercel e cria uma implantação a partir da versão pretendida. Alterações numa pull request não aparecem automaticamente no domínio de produção enquanto não forem integradas na branch de produção e implantadas. O limitador de pedidos em memória não é partilhado entre instâncias serverless; usa um limitador persistente antes de ativar a chave Gemini em produção.

## Esquema inicial do Supabase

As migrações em `supabase/migrations` criam perfis, disciplinas, tópicos, materiais e resultados de prática, sem inserir conteúdos fictícios. As tabelas usam RLS: utilizadores autenticados só acedem aos seus próprios perfis e resultados, e só leem conteúdos publicados. A gestão de conteúdos é reservada ao servidor; ainda não há painel administrativo funcional. Os resultados de prática são fornecidos pelo cliente e **não são notas verificadas**. A interface atual ainda guarda perfil e histórico localmente: criar estas tabelas não ativa a sincronização automaticamente.

### Confirmação de email

O registo envia um link de confirmação; a origem usada no acesso deve estar na lista de redirecionamentos permitidos do Supabase. Sem SMTP personalizado, o serviço de email padrão do Supabase é limitado e não é adequado para registos públicos: configura um fornecedor SMTP e domínio remetente antes de abrir o registo a todos os estudantes. Não desatives a confirmação apenas para contornar essa limitação. As variáveis públicas do Supabase na Vercel entram em vigor apenas num novo build.
