---
name: dataset-import
description: Use ao criar ou alterar importação CSV/XLSX, mapeamento de colunas, tipagem, versões de dataset ou exportação segura.
---

# Importação de datasets

- Fluxo: `previewFile` (lê e tipa no servidor, nada gravado) → `runImport` (lotes para staging via `bi_*`) → `publishImport` (atômico) ou `cancelImport`. Mesmo hash não entra de novo; uma `processing` por dataset.
- Motor em `lib/bi/engine/{parse,infer,ingest,files,xlsx}.ts`: formatos BR (1.234,56; DD/MM/AAAA; R$; %), erro por linha com coluna e código, nunca descarte silencioso, chave de deduplicação vazia rejeita a linha.
- XLSX: só valor em cache (fórmulas não executam), macros recusadas, limites do zip conferidos antes de inflar.
- Limites: 20 MB, 50.000 linhas, 100 colunas. Colunas ganham chave interna `c1..cn`.
- Testes: `tests/unit/bi-import.test.ts`, SQL 90–91, E2E bi-flow.
