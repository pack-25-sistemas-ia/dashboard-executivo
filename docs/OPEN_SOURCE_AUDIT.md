# OPEN_SOURCE_AUDIT — Dashboard Executivo

Consulta em 2026-10-15 pela API do GitHub (licença declarada, estrelas, último push, commit do `main`). Só **leitura de arquivos de licença e metadados**; nenhum código foi copiado. Estrelas são aproximadas.

| Projeto | Licença | Estrelas | Último push | Commit | Uso |
|---|---|---|---|---|---|
| apache/superset | Apache-2.0 | ~75 mil | 2026-10-15 | 54d2421ded | **Só referência funcional**: dataset → métricas/dimensões → gráfico → dashboard. Não incorporado (Python, plataforma universal). |
| apache/echarts | Apache-2.0 | ~67 mil | 2026-10-13 | — | **Não adotado** (D-B2): Recharts cobre os tipos exigidos; duas bibliotecas de gráfico seriam redundantes. |
| lightdash/lightdash | MIT fora de `packages/backend/src/ee` (arquivo LICENSE misto; API diz NOASSERTION) | ~6 mil | 2026-10-15 | 3fef2be9fe | **Só referência conceitual** da camada semântica (métrica separada do gráfico, filtros do dashboard). Diretório `ee` não lido nem usado. |
| evidence-dev/evidence | MIT | ~7 mil | 2026-10-14 | 6f9596cfbc | Referência de apresentação de relatórios e formatação. Sem código. |
| react-grid-layout | MIT | ~22 mil | 2026-10-14 | 866f646fe9 | **Dependência** (2.2.4; a 2.3.0 saiu há menos de 14 dias e fica fora pela quarentena do Core). Editor de grade. |
| recharts | MIT | ~27 mil | 2026-10-14 | — | **Dependência** (3.10.1), único motor de gráficos. |
| mholt/PapaParse | MIT | ~13 mil | 2026-10-09 | — | **Dependência** (5.7.0): leitura de CSV (aspas, separadores, erros por linha). |
| exceljs/exceljs | MIT | ~15 mil | 2025-01-21 | — | **Descartado** (D-B3): sem manutenção desde 2023 e árvore transitiva com `jszip` (MIT *ou* GPL-3.0), `buffers` (licença não declarada), `big-integer`, `chainsaw`. |
| duckdb/duckdb-wasm | MIT | ~2 mil | 2026-10-12 | — | **Não adotado**: PostgreSQL é a única fonte; prévia usa a mesma validação do servidor. |
| metabase/metabase | AGPL-3.0 + Licença Comercial (`enterprise/`) | ~50 mil | 2026-10-15 | — | **Só referência de experiência**; código AGPL **não** consultado para implementação nem incorporado. |
| shadcn-ui/ui | MIT | ~125 mil | 2026-10-14 | — | **Não adicionado**: o Core do Pack já tem primitivos próprios (D-B1). |
| TanStack/table | MIT | ~28 mil | 2026-10-12 | — | **Dependência** (8.21.3) para o explorador e a prévia. |

Complementares: Zod, React Hook Form, date-fns, Decimal.js (MIT), **fflate 0.8.2** (MIT, sem dependências; descompactação com limite de tamanho — D-B3), Vitest, Playwright (já no Core).

## Skills de agentes (anthropics/skills, vercel-labs/agent-skills, supabase/agent-skills, obra/superpowers, tmolavi/lean-agent-skills)
Consultadas apenas como referência de formato. **Nenhum script externo foi executado nem incorporado**; as skills internas deste sistema (`.agents/skills/*`) são originais.

## Riscos e mitigação
- Lightdash: licença mista → não leitura do `ee`, sem cópia.
- Metabase: AGPL → só experiência de uso, sem código.
- ExcelJS: cadeia antiga e licença dupla/indefinida → leitor XLSX próprio sobre `fflate` (guarda contra *zip bomb* antes de descompactar).

## Situação final
Preenchida na entrega (`pnpm licenses list --prod`).
