# DATABASE — modelo de dados

Migrações `supabase/migrations/20270901*_bi_*.sql` (depois das do Core). **Toda escrita passa por funções `SECURITY DEFINER` `bi_*`**; o usuário só tem `SELECT` com RLS (e nem isso em `dataset_rows`).

| Tabela | Papel |
|---|---|
| `bi_settings` | fuso, limites (linhas, MB), desatualização, retenção, período padrão, nome do portal |
| `datasets`, `dataset_versions`, `dataset_columns`, `dataset_rows`, `dataset_access` | dados por **versão** (staging → published → superseded/failed); colunas com chave interna `cN`; linhas em `values_json` (texto canônico por tipo); acesso a datasets restritos |
| `import_jobs`, `import_row_errors`, `data_refresh_events` | ciclo da importação, erros por linha (≤ 1.000), eventos de atualização |
| `dimension_definitions`, `metric_definitions`, `metric_versions`, `chart_definitions` | camada semântica (métrica ≠ gráfico) com versões imutáveis |
| `dashboards`, `dashboard_versions`, `dashboard_widgets`, `dashboard_filters`, `dashboard_permissions`, `dashboard_favorites`, `dashboard_views` | dashboards editáveis, instantâneos publicados, compartilhamento, favoritos e recentes |
| `goal_definitions`, `goal_periods` | metas e alvos por período |
| `saved_views`, `report_exports`, `bi_notifications`, `bi_notification_prefs` | visões salvas, registro de exportações (sem valores), avisos |

## Integridade
Chaves compostas `(id, organization_id)` impedem referência entre empresas; `check`s de tipos/limites; índices únicos parciais (uma importação `processing` por dataset; nome único de dataset ativo, de dashboard e de indicador); `dataset_rows` único por `(versão, row_key)`; gatilhos de imutabilidade (`metric_versions`, `dashboard_versions`, `import_row_errors`, versões publicadas de dataset; linhas só são apagadas pela rotina de retenção); organização do registro não muda; `no_delete` (arquivar em vez de apagar). Tabelas que referenciam `organization_members` não referenciam `organizations` (evita PGRST201).

## Concorrência
`FOR UPDATE` no dataset/job (publicação), no dashboard (salvar/publicar/restaurar), na métrica e no job (lotes). Provas em `scripts/test-concurrency.mjs` (sessões reais).

## Limites e retenção
50.000 linhas/dataset, 100 colunas, 20 MB, 1.000 linhas por consulta, 5 versões com linhas por padrão (2–20). Estratégia de linhas em `jsonb` por versão é adequada ao MVP; para volumes maiores, o caminho é particionar por `dataset_version_id` ou materializar agregados (evolução futura, fora do MVP).
