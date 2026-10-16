# FEATURES — Dashboard Executivo
Status: VERIFIED (com evidência), FORA DO MVP ou LIMITE DOCUMENTADO. Siglas: **UNIT** = `tests/unit/*` (`pnpm test`); **SQL** = `supabase/tests/NN_*.sql` (`pnpm test:db`); **CONC** = `scripts/test-concurrency.mjs`; **MUT** = `scripts/mutation-check.mjs`; **E2E** = Playwright (`tests/e2e/bi-*.spec.ts`).

| Fluxo | Status | Evidência |
|---|---|---|
| Importação CSV (`;`, `,`, tab, BOM, aspas, Windows-1252) e XLSX (abas, datas, percentuais, fórmulas só como valor em cache) | VERIFIED | UNIT bi-import; E2E bi-flow (CSV, XLSX) |
| Formatos brasileiros: 1.234,56 · R$ · % · DD/MM/AAAA · fuso da empresa para data e hora | VERIFIED | UNIT bi-import; SQL 90 (dia civil); E2E bi-flow |
| Prévia, mapeamento de colunas, tipos sugeridos e confirmados, chave de deduplicação, colunas obrigatórias | VERIFIED | E2E bi-flow (1–2) |
| Erros por linha (linha, coluna, motivo, valor rejeitado), relatório CSV, importação parcial controlada | VERIFIED | UNIT bi-import; SQL 91; E2E bi-flow (1–2) |
| Publicação atômica por versão; falha preserva a versão ativa; envio incompleto não publica | VERIFIED | SQL 90, 91; CONC; MUT; E2E bi-security (11/12/20) |
| Substituição integral com análise de impacto (indicadores/gráficos afetados) e confirmação | VERIFIED | SQL 91; MUT; E2E bi-security |
| Acréscimo com chave de deduplicação (repetidos ignorados e contados; nada duplica) | VERIFIED | SQL 91; CONC; E2E bi-flow (6) |
| Mesmo arquivo não entra duas vezes; uma importação por vez por dataset | VERIFIED | SQL 90, 91; CONC; MUT; E2E bi-flow (7) |
| Versões de dataset e retenção explícita (N versões com linhas; metadados sempre) | VERIFIED | SQL 91; MUT |
| Datasets: criar, editar, arquivar, restaurar, restritos com acesso explícito | VERIFIED | SQL 91, 92; E2E bi-demo, bi-security |
| Explorador: filtros, ordenação e paginação no servidor; visões salvas; qualidade (vazios por coluna) | VERIFIED | SQL 90, 93; E2E bi-demo (explorador) |
| Motor de métricas: soma, contagem, distinta, média, mín., máx., razão, diferença, fórmulas encadeadas | VERIFIED | UNIT bi-metrics, bi-widgets; SQL 90, 92; E2E bi-flow (3–5) |
| Divisão por zero e «sem dados» explícitos (nunca infinito/NaN/0 inventado) | VERIFIED | UNIT bi-metrics; E2E bi-flow (5) |
| Fórmula como árvore validada; ciclo, profundidade, tamanho; sem eval/SQL/JS | VERIFIED | UNIT bi-metrics; SQL 92; MUT; E2E bi-security (3–4) |
| Versionamento de indicador; dashboards ficam na versão usada até atualizar | VERIFIED | SQL 92; CONC; E2E bi-flow |
| Consulta declarativa segura (chaves internas, operadores fechados, valores tipados, limites, timeout) | VERIFIED | SQL 90 (≈50 verificações); MUT; E2E bi-security (3, 10) |
| Dimensões, filtros e períodos (hoje…ano, personalizado; inclusivos; fuso) | VERIFIED | UNIT bi-metrics; SQL 90; E2E bi-demo |
| Comparativos de período (anterior, mês anterior, ano anterior; mês parcial: mesmos dias × mês inteiro, sempre declarado) | VERIFIED | UNIT bi-metrics; E2E bi-demo |
| Gráficos: KPI, barras, linhas, área, pizza/donut (+«Outros»), tabela, empilhado, combinado; regras anti-enganosos | VERIFIED | UNIT bi-metrics, bi-widgets; E2E bi-demo, bi-ui |
| Editor visual (react-grid-layout): arrastar, redimensionar, posição por teclado, bloquear, desfazer, descartar | VERIFIED | E2E bi-flow (8), bi-ui |
| Edição concorrente sem sobrescrever (versão otimista) | VERIFIED | SQL 92; CONC; MUT; E2E bi-flow (8) |
| Publicação versionada, restaurar versão, duplicar, favoritos, recentes, arquivar | VERIFIED | SQL 92; CONC; E2E bi-demo |
| Compartilhamento interno (ver/editar/administrar), revogação imediata, viewer só vê o que o widget mostra | VERIFIED | SQL 92; MUT; E2E bi-flow (9), bi-security |
| Dataset restrito: não aparece, não consulta, não entra em dashboard para a empresa toda | VERIFIED | SQL 91, 92; MUT; E2E bi-demo |
| Cinco modelos (Comercial, Financeiro gerencial, Marketing, Operações, Gestão executiva); incompatível sem os campos | VERIFIED | UNIT bi-widgets; E2E bi-flow (5) |
| Metas (mínima, máxima, crescimento, redução, faixa) respeitando a direção; sem projeção | VERIFIED | UNIT bi-metrics; SQL 93; E2E bi-demo (metas) |
| Exportações: CSV neutralizado (BOM, `;`), dashboard e dataset (gestor), auditadas sem valores | VERIFIED | UNIT bi-import; SQL 90, 92; E2E bi-flow (10), bi-security |
| Impressão/PDF pelo navegador com título, período, data de geração e fonte | VERIFIED | E2E bi-demo (nota de período) · PDF gerado no servidor: FORA DO MVP |
| Avisos (importação, indicador inválido, compartilhamento, revogação, meta, dataset desatualizado) e preferências | VERIFIED | SQL 91, 92, 93; E2E bi-demo |
| Qualidade dos dados: desatualizados, erros, rejeitados, vazios, indicadores inválidos (sem nota única) | VERIFIED | SQL 93; E2E bi-demo |
| Isolamento entre empresas (RLS A×B), MFA do administrador no banco, funções sem acesso de anon | VERIFIED | SQL 10, 30, 90–93; E2E bi-security (1, 13) |
| Perfis: administrador, gestor, analista, visualizador | VERIFIED | SQL 90–93; E2E bi-demo, bi-security (2/14) |
| Configurações (fuso, limites, retenção, nome do portal) e white-label/equipe/LGPD do Core | VERIFIED | SQL 93; Core (SQL 10, 20, 40) |
| Acessibilidade estrutural, celular (uma coluna), tema escuro, teclado | VERIFIED | E2E bi-ui |
| Conectores externos, tempo real, joins entre datasets, PDF no servidor, links públicos | FORA DO MVP | Prompt §21, §22, §23, §25 |
