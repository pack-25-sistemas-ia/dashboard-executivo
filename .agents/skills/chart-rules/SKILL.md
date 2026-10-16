---
name: chart-rules
description: Use ao adicionar tipos de gráfico, regras de adequação, formatação de valores ou agrupamento «Outros».
---

# Regras de gráficos

- `lib/bi/engine/chart-rules.ts` (`checkChart`): KPI sem dimensão; linha/área exigem tempo com granularidade; pizza/donut só com uma medida somável e poucas categorias (8); empilhado só com soma/contagem; combinado exige 2+ medidas.
- «Outros» só para medidas aditivas (`othersRow`); média/razão nunca é somada.
- Formatação em `format.ts` (pt-BR, arredondamento correto). Acessibilidade: cor nunca é o único canal; tabela equivalente sempre.
- Testes: `bi-metrics.test.ts` (adequação), `bi-widgets.test.ts`.
