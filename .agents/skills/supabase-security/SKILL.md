---
name: supabase-security
description: Use ao criar tabelas, funções SECURITY DEFINER, privilégios, políticas RLS, rotas de exportação ou testes de acesso.
---

# Segurança Supabase

- Toda tabela com `organization_id`, RLS e FKs compostas; nenhuma escrita direta: só `bi_*` SECURITY DEFINER com `search_path` fixo e `private.bi_guard` (sessão, MFA, papel).
- `dataset_rows` sem SELECT; revogar de PUBLIC/anon; teste de privilégios em SQL 93.
- Sem `service_role` no app. Exportação autentica, autoriza, limita taxa e audita (sem valores).
- Teste de negação deve provar que a função existe. Rode `pnpm test:db`, `test:concurrency` e `test:mutation`.
