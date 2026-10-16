// Regras de adequação de gráficos: o editor não deixa montar visualizações que enganam (pizza de médias, linha sem tempo, etc.).
import { isTemporal, type DataType } from './types';

export const CHART_TYPES = ['kpi', 'bar', 'line', 'area', 'pie', 'donut', 'table', 'stacked_bar', 'combo'] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export const CHART_LABEL: Record<ChartType, string> = {
  kpi: 'Indicador (KPI)', bar: 'Barras', line: 'Linhas', area: 'Área', pie: 'Pizza', donut: 'Donut', table: 'Tabela', stacked_bar: 'Barras empilhadas', combo: 'Combinado (barras + linha)',
};
export const LIMITS = { pieSlices: 8, barCategories: 30, series: 12, tableRows: 500 } as const;

export type ChartShape = {
  type: ChartType;
  measures: { additive: boolean }[];
  /** Tipos das dimensões na ordem (a primeira é o eixo/categoria). */
  dimensions: { type: DataType; grain?: string }[];
};
export type ChartVerdict = { ok: true; warnings: string[] } | { ok: false; error: string };

const no = (error: string): ChartVerdict => ({ ok: false, error });

export function checkChart(c: ChartShape): ChartVerdict {
  const nm = c.measures.length;
  const nd = c.dimensions.length;
  const warnings: string[] = [];
  if (nm < 1) return no('Escolha ao menos um indicador.');
  switch (c.type) {
    case 'kpi':
      if (nm !== 1 || nd !== 0) return no('O indicador (KPI) usa uma única métrica e nenhuma dimensão.');
      return { ok: true, warnings };
    case 'table':
      return { ok: true, warnings };
    case 'bar':
      if (nd !== 1) return no('Barras precisam de exatamente uma dimensão (o que está sendo comparado).');
      warnings.push(`Mostra no máximo ${LIMITS.barCategories} categorias (as maiores).`);
      return { ok: true, warnings };
    case 'line':
    case 'area':
      if (nd !== 1 || !isTemporal(c.dimensions[0]!.type)) return no('Gráficos de linha e de área precisam de uma dimensão de data (dia, semana, mês…).');
      if (!c.dimensions[0]!.grain) return no('Escolha a granularidade do tempo (dia, mês, ano…).');
      if (c.type === 'area' && c.measures.some((m) => !m.additive)) warnings.push('Área empilha visualmente: prefira soma ou contagem.');
      return { ok: true, warnings };
    case 'pie':
    case 'donut':
      if (nm !== 1) return no('Pizza e donut usam uma única métrica.');
      if (!c.measures[0]!.additive) return no('Pizza só é permitida para soma ou contagem: médias, mínimos, máximos, razões e percentuais não podem ser somados em partes de um todo.');
      if (nd !== 1 || isTemporal(c.dimensions[0]!.type)) return no('Pizza precisa de uma dimensão de categoria (não de data).');
      warnings.push(`Mostra as ${LIMITS.pieSlices - 1} maiores categorias e agrupa o restante em «Outros».`);
      return { ok: true, warnings };
    case 'stacked_bar':
      if (c.measures.some((m) => !m.additive)) return no('Barras empilhadas só fazem sentido com soma ou contagem.');
      if (nd === 1 && nm >= 2) return { ok: true, warnings };
      if (nd === 2 && nm === 1) return { ok: true, warnings };
      return no('Empilhado: use 1 dimensão com 2 ou mais métricas, ou 2 dimensões com 1 métrica.');
    case 'combo':
      if (nm !== 2 || nd !== 1) return no('O gráfico combinado usa 1 dimensão e exatamente 2 métricas (barras e linha).');
      return { ok: true, warnings };
  }
}
