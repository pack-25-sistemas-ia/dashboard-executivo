---
name: safe-query-layer
description: Use ao mexer na consulta declarativa (QuerySpec), em private.bi_exec_query, filtros ou limites.
---

# Consulta segura

- O navegador envia só uma spec JSON; validada em `lib/bi/engine/query.ts` e de novo em `private.bi_exec_query` (chaves por `bi_key`, operadores/agregações/granularidades de lista fechada, literais tipados por `bi_lit`, limites 12/2/20/1000, `statement_timeout`).
- Widget usa a spec guardada; só período e filtros do dashboard podem sobrescrever. Dataset restrito exige `dataset_access`; visualizador só via dashboards.
- Mudou a spec: atualize TS e SQL juntos. Teste de injeção em SQL 92 e E2E bi-security.
- Doc: `docs/QUERY_SECURITY.md`.
