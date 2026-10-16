---
name: metric-engine
description: Use ao criar ou alterar indicadores, fórmulas (AST), agregações, períodos, comparações ou metas.
---

# Motor de indicadores

- `lib/bi/engine/metrics.ts`: `compileMetric` deduplica medidas-base; `evaluate` combina com `decimal.js`. Fórmula é AST (`ref|num|add|sub|mul|div`), sem texto livre.
- Estados: `div_zero`, `no_data` (soma de nada), contagem 0; nunca `NaN` nem 0 inventado. Razões não são aditivas.
- Versões imutáveis; widget fixa a versão e a atualização é explícita.
- Períodos inclusivos no fuso da empresa; mês parcial declara a base (`same_days` × `full`). Metas: min, max, range (extremos incluídos), growth, reduction.
- Testes: `tests/unit/bi-metrics.test.ts`; mutação em `scripts/mutation-check.mjs`.
