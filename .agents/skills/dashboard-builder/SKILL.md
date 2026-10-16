---
name: dashboard-builder
description: Use ao alterar o editor de dashboards, widgets, layout, versões, compartilhamento ou modelos.
---

# Editor de dashboards

- `react-grid-layout` só no cliente (`dynamic ssr:false`; CSP sem estilo em linha). Visualização usa classes literais de `grid-classes.ts`.
- Salvar chama `bi_save_dashboard` com `expected row_version`; conflito (`40001`) não sobrescreve nada. Publicar cria instantâneo imutável; restaurar substitui widgets e filtros do rascunho.
- Alternativa de teclado: campos de posição e tamanho. Todo gráfico tem tabela equivalente.
- Modelos em `lib/bi/templates.ts` exigem papéis de coluna; sem eles ficam «incompatíveis».
- Testes: E2E bi-flow e bi-ui, SQL 93, `scripts/test-concurrency.mjs`.
