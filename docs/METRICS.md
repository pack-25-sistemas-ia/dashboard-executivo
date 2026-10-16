# METRICS — o que o sistema mede sobre si mesmo e como conferir

## Painel «Qualidade dos dados» (cada sinal separado, sem nota única)
| Sinal | Definição | Fonte |
|---|---|---|
| Datasets ativos | `status = active` | `datasets` |
| Desatualizados | versão ativa publicada há mais de `stale_days` dias | `dataset_versions.published_at` |
| Importações com erro (30 dias) | `import_jobs.status = failed` nos últimos 30 dias | `import_jobs` |
| Linhas rejeitadas (última carga) | `stats_json.rejected` da versão ativa | `dataset_versions` |
| Vazios por coluna | `stats_json.nulls` (contagem por coluna na publicação) | `dataset_versions` |
| Indicadores inválidos | `metric_definitions.status = invalid` | `metric_definitions` |

## Início
Dashboards favoritos e recentes (por pessoa), datasets e última atualização, últimas importações, alertas (desatualizado, inválido, importação falha), metas ativas e os cartões (KPI) do dashboard favorito/mais recente — **todos lidos do banco**, nenhum número universal inventado.

## Conferência dos números (dados de demonstração)
`supabase/seed.sql` gera 3.600 vendas, 700 despesas e 1.500 chamados de forma determinística (datas relativas à criação do banco). O E2E `bi-demo` confere o Faturamento, Pedidos e Ticket médio do dashboard Comercial contra a consulta direta ao banco no mesmo período.
