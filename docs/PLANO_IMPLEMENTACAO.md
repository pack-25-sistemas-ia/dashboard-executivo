# PLANO_IMPLEMENTACAO — Dashboard Executivo

Regra do prompt: **começar pela modelagem, pelo tratamento de dados e pelo motor de indicadores, não pelos gráficos**. O prompt chegou truncado na seção 33 (D-B11).

| Fase | Entrega | Prova |
|---|---|---|
| 1 Pesquisa e plano | Auditoria de licenças (inclui descarte do ExcelJS), decisões D-B1… | `docs/OPEN_SOURCE_AUDIT.md`, `docs/DECISIONS.md` |
| 2 Base | Core sincronizado, dependências, portas 586xx | install, lint, tipos |
| 3 **Motor** (TypeScript puro) | leitura CSV/XLSX, tipos BR, ingestão, consulta declarativa, métricas/fórmulas, períodos, metas, regras de gráfico | UNIT bi-import, bi-metrics, bi-widgets |
| 4 Banco | esquema, RLS, guardas, consulta segura, importação em etapas, modelo analítico, dashboards, metas | SQL 90–93, CONC |
| 5 Aplicação | ações do servidor, compilação de widgets, exportações, rotas | lint, tipos, build |
| 6 Interface | 16 telas, assistente de importação, editor visual, modelos | E2E bi-demo, bi-flow, bi-ui |
| 7 Segurança | matriz de ameaças, mutação | E2E bi-security, `pnpm test:mutation` |
| 8 Fechamento | docs, skills, export isolado, CI, repositório público | ver MEMORY.md |
