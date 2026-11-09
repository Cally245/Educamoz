# EducaMoz AI

Aplicação educativa em português para estudantes moçambicanos. A área de estudo exige uma conta Supabase; perfis, disciplinas, matérias, materiais, conversas e resultados são armazenados no Supabase. Os conteúdos são reais e devem ser criados e publicados por um administrador: a base inicial não contém exames nem materiais.

## Executar

Requisitos: Node.js 22 e npm.

```sh
npm install
cp .env.example .env
# preencher URL e chave pública do Supabase em .env
npm run server  # API no terminal 1
npm run dev     # interface no terminal 2
npm test
```

O Vite encaminha `/api` para o servidor. Para produção: `npm run build` e `npm start`. O `vercel.json` configura o Vite, as rotas e a função `/api/ai` na Vercel.

## Integrações e segurança

- **Supabase:** define `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (chave publicável, não a chave de serviço). Aplica as migrações em `supabase/migrations` e configura os redirecionamentos de autenticação. A RLS protege os dados de cada utilizador e restringe o catálogo ao conteúdo publicado. As respostas corretas são visíveis apenas aos administradores; a função `submit_exam` corrige e guarda resultados no servidor.
- **Administração:** uma conta tem de ser adicionada por um operador de confiança à tabela `admin_users` através do painel SQL do Supabase. Nunca atribuas privilégios a partir do navegador. O painel permite criar e publicar disciplinas, matérias, materiais e exames, e adicionar perguntas a exames em rascunho.
- **Emails:** a confirmação de registo está ativa. O serviço padrão do Supabase é limitado; configura SMTP personalizado antes de abrir registos ao público.
- **Gemini:** define `GEMINI_API_KEY` exclusivamente no ambiente do servidor e, opcionalmente, `GEMINI_MODEL` (por omissão, `gemini-flash-latest`). A chave é enviada ao Gemini num cabeçalho, nunca no URL ou no navegador. A conversa é guardada na conta; cada pedido ao modelo contém apenas a pergunta atual. Sem chave, aparece uma mensagem de indisponibilidade. Antes de ativar a IA publicamente, implementa limitação de pedidos persistente e partilhada, proteção contra abuso, controlo de custos e políticas de privacidade, incluindo para menores.
- **Premium:** ainda não há pagamentos ou funcionalidades premium ativas.

Antes de uma disponibilização pública, revê acessibilidade, privacidade, consentimento, monitorização, recuperação de conta, validação de conteúdos, tratamento de erros e testes de segurança. As tabelas antigas de demonstração não são usadas pela interface atual.

## Professor IA avançado

Esta versão acrescenta aulas individuais, seis modos, contexto recente e cotas persistentes verificadas no servidor. Os detalhes da arquitetura, da migração, dos testes, das limitações de privacidade e das funcionalidades ainda não implementadas estão em [docs/professor-ia.md](docs/professor-ia.md). Anexos e RAG ainda não estão disponíveis.
