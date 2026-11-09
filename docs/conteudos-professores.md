# Publicação por professores

Na página Disciplinas, uma conta autorizada como professor em Turmas encontra a secção «Publicar conteúdos». Pode publicar diretamente no catálogo comum uma disciplina (título, identificador e descrição) ou uma matéria (título e descrição) ligada a uma disciplina já publicada. Os conteúdos aparecem para os estudantes autenticados nas áreas existentes. Esta funcionalidade não adiciona uploads, materiais de biblioteca ou novos tipos de conteúdo.

O identificador da disciplina deve ser único, com letras minúsculas, números e hífen. Os autores podem consultar as suas disciplinas e matérias, incluindo as que o administrador despublicar. Professores não podem editar, apagar ou despublicar conteúdos através desta funcionalidade; devem contactar o administrador para retirar ou corrigir conteúdos. O administrador mantém a gestão existente. Ao revogar a autorização de professor, a publicação deixa de estar disponível para a conta, mas os conteúdos existentes não são apagados.

As migrações `20261109155525_teacher_catalog.sql` e `20261109155633_teacher_catalog_limits.sql` foram aplicadas ao Supabase deste projeto e devem ser executadas antes da interface noutros ambientes. As funções autorizam a criação no servidor e os testes de RLS cobrem permissões e publicação. Os fluxos completos no navegador com contas reais ainda precisam de validação.
