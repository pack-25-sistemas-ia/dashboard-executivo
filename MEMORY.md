# MEMORY — DASHBOARD EXECUTIVO (dashboard-executivo)
Atualizado em: 2026-10-16 | Versão: 0.1.0 | Estado: VALIDADO localmente e na cópia exportada (falta a CI do hub e a publicação do repositório público)

## Missão do sistema
Relatórios montados à mão todo mês. Público: gestores que consolidam indicadores de várias planilhas. Valor: importar planilhas (CSV/XLSX), definir indicadores com fórmulas seguras, montar dashboards visuais, acompanhar metas e compartilhar internamente.

## Stack e caminhos-chave
Next.js 16 + TypeScript strict + Tailwind 4 + Supabase (Auth, Postgres/RLS); layout do Core na raiz, sem `src/` e sem shadcn (D-B1). Motor em `lib/bi/engine/*` (TS puro, decimal.js; leitura CSV/XLSX, tipos BR, métricas AST, períodos, metas, regras de gráfico); camada de servidor `lib/bi/*`; ações `lib/bi/actions/*`; migrações `supabase/migrations/20270901*_bi_*.sql`; testes SQL `supabase/tests/90–93`. Portas locais 586xx; E2E na porta 3123.
Comandos: pnpm lint | typecheck | test | build | test:db | test:concurrency | test:mutation | test:e2e; `node scripts/seed-check.mjs`.

## Escopo entregue
Importação CSV e XLSX (prévia, mapeamento, tipos BR, erros por linha, publicação atômica, retenção de versões, substituir/acrescentar com chave, hash repetido recusado); datasets versionados, qualidade, arquivamento e acesso restrito; indicadores (agregações e fórmulas em AST, versões imutáveis, estados `div_zero`/`no_data`); dimensões; gráficos com regras de adequação; períodos e comparações no fuso da empresa; explorador; editor visual com `react-grid-layout`, concorrência otimista, rascunho × publicado e restauração; 5 modelos; metas (5 tipos); compartilhamento interno; favoritos, visões salvas, avisos; exportações CSV auditadas; white-label e LGPD (Core); 20 cenários de ameaça cobertos em SQL/E2E.
Fora do escopo (D-B*): conectores universais, tempo real, SQL/JS do usuário, PDF nativo (impressão do navegador), ExcelJS (descartado, D-B3).

## Verificado (2026-10-16, comandos executados)
- `pnpm lint`, `typecheck`, `build`: limpos. `pnpm test`: 102 testes (importação 27, métricas 27, widgets 12, Core: segurança 27 e validação 9).
- `pnpm test:db`: Core + 90–93 passam. `pnpm test:concurrency`: passa (publicação única, uma importação por dataset, lotes paralelos, leitores sem mistura, salvamento otimista, numeração sem buracos, sem impasse).
- `pnpm test:mutation`: 108 mutações. Rodada completa: 96 mortas, 12 sobreviveram — 5 de motor (corrigidos com testes) e 7 de banco; destas, 3 eram **camadas redundantes** (defesa em profundidade: guarda de papel + visibilidade do dataset; trava `FOR UPDATE` + índice único parcial + unicidade de versão) e passaram a quebrar todas as camadas juntas (`extra` no script); 1 linha redundante de `metrics.ts` foi removida. As 12 foram **reexecutadas individualmente e morrem**; a rodada completa não foi repetida depois.
- E2E (banco recriado e app reiniciado antes de cada arquivo): core-flow 5, email-flows 3, security 5, bi-demo 8, bi-flow 10, bi-security 10, bi-ui 5 — todos passam. Screenshots regenerados de dados limpos (`E2E_SHOTS=1`).
- `node scripts/seed-check.mjs`: SEED OK.
- Cópia exportada (`export-system.mjs`, pasta isolada): install `--frozen-lockfile`, lint, tipos, 102 unit, build, `test:db`, `test:concurrency`, seed-check e os mesmos 46 E2E passam (build com as chaves do Supabase local).
- Licenças de produção: MIT (65), ISC (12), BSD-3-Clause (2), Apache-2.0 (2), MIT AND ISC (1), 0BSD (1), CC-BY-4.0 (1, `caniuse-lite`); sem GPL/AGPL.

## Pendências e riscos
- **O prompt do Sistema 09 chegou truncado na seção 33 (testes de importação)**; faltam o restante dos testes, critérios de aceite, fases e relatório (D-B11). Reconciliar com o Word íntegro.
- CI do hub (jobs `dashboard-executivo-*`) e repositório público ainda não executados.
- Limites conhecidos: linhas em `jsonb` por versão (50.000 linhas por dataset); layouts por ponto de corte aceitos pelo banco, mas a visualização reorganiza automaticamente; sem PDF nativo.
- Risco LGPD: médio (as planilhas do cliente podem trazer dados pessoais; minimização, RLS e dataset restrito aplicados).

## Armadilhas
Heredoc/`node -e` perdem barras e crases; `String.replace` com `$$` corrompe SQL: use Write/Edit. Componentes cliente não recebem render-prop do servidor. CSP sem estilo em linha: `react-grid-layout` só no cliente (`ssr:false`) e visualização com classes literais. `raise` dentro de função desfaz o próprio `bi_begin_import`: teste falha parcial com chamadas separadas. **O limitador de login do Core é em memória: reinicie o app entre arquivos E2E** (e mate a árvore do processo com `taskkill //T`; sem isso o app antigo segue ouvindo a porta). `.env.e2e` precisa ser carregado no shell (`set -a; . ./.env.e2e`). Mutação de camada redundante precisa quebrar todas as camadas (`extra`). Teste de negação deve provar que a função existe. Mutação sem carga paralela.

## Referências
docs/QUERY_SECURITY · IMPORT_ENGINE · METRIC_ENGINE · DASHBOARD_BUILDER · DATABASE · PERMISSIONS · DECISIONS (D-B1..D-B11) · OPEN_SOURCE_AUDIT · PLANO_IMPLEMENTACAO · .agents/skills/*
