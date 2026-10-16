# DATA_MODEL — Dashboard Executivo

O modelo completo (tabelas, integridade, concorrência e limites) está em [DATABASE.md](DATABASE.md). Resumo das regras:

- `organization_id` em toda entidade de negócio, RLS ativa, FKs compostas `(id, organization_id)`.
- Histórico imutável: `metric_versions`, `dashboard_versions`, `import_row_errors` e versões publicadas de dataset (gatilhos).
- Dados dos datasets em `dataset_rows.values_json`, por versão, com chaves internas `c1..cn` e texto canônico por tipo; sem `SELECT` para usuários.
- Dados pessoais: dependem do conteúdo importado; ver tratamento em [PERMISSIONS.md](PERMISSIONS.md) (LGPD).
