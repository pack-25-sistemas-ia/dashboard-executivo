// Montagem e avaliação de widgets (puro, sem acesso a banco): junta as métricas de um gráfico em UMA consulta declarativa e
// guarda no widget a expressão de cada métrica (a fórmula já «congelada» na versão usada). Nada é calculado no navegador.
import {
  BiError, D, LIMITS, toDec, checkChart, evaluate, isTemporal, normalizeCount, type ChartType, type ColumnDef, type Compiled, type Expr, type Filter, type FormatType, type Grain, type Measure, type MetricValue, type QuerySpec,
} from './engine';

export type MetricRef = { id: string; name: string; format: FormatType; unit: string | null; version: number; description?: string | null; compiled: Compiled };
export type DimRef = { field: string; name: string; type: ColumnDef['type']; grain?: Grain };

export type WidgetBuild = {
  chart: ChartType;
  metrics: MetricRef[];
  dims: DimRef[];
  filters?: Filter[];
  periodField?: string | null;
  datasetId: string;
  datasetName: string;
  limit?: number;
};

export type MetricDisplay = { id: string; name: string; format: FormatType; unit: string | null; version: number; description: string | null; additive: boolean; expr: Expr };
export type WidgetDisplay = { kind: 'chart'; chart: ChartType; dims: DimRef[]; metrics: MetricDisplay[]; datasetName: string; limit: number; periodField: string | null; filtersText: string[] };

const sig = (m: Measure) => JSON.stringify([m.agg, m.field ?? null, m.filters ?? []]);
const remap = (e: Expr, map: Map<string, string>): Expr => (e.op === 'num' ? e : e.op === 'm' ? { op: 'm', alias: map.get(e.alias)! } : { op: e.op, l: remap(e.l, map), r: remap(e.r, map) });

/** Junta as medidas-base de várias métricas (sem repetir) e reescreve as expressões para os novos apelidos. */
export function mergeMetrics(metrics: MetricRef[]): { measures: Measure[]; exprs: Expr[] } {
  const bySig = new Map<string, string>();
  const measures: Measure[] = [];
  const exprs: Expr[] = [];
  for (const m of metrics) {
    const local = new Map<string, string>();
    for (const ms of m.compiled.measures) {
      const k = sig(ms);
      let alias = bySig.get(k);
      if (!alias) { alias = `m${measures.length}`; bySig.set(k, alias); const { alias: _a, ...rest } = ms; void _a; measures.push({ alias, ...rest }); }
      local.set(ms.alias, alias);
    }
    exprs.push(remap(m.compiled.expr, local));
  }
  if (measures.length > 12) throw new BiError('too_complex', 'O gráfico usa medidas-base demais (máximo de 12). Reduza os indicadores.');
  return { measures, exprs };
}

const LIMIT_FOR: Record<ChartType, number> = { kpi: 1, bar: LIMITS.barCategories, line: 400, area: 400, pie: LIMITS.pieSlices - 1, donut: LIMITS.pieSlices - 1, table: 100, stacked_bar: LIMITS.barCategories, combo: 120 };

export function buildWidget(b: WidgetBuild, columns: ColumnDef[]): { query_json: QuerySpec & { period?: { field: string } }; display_json: WidgetDisplay; warnings: string[] } {
  if (!b.metrics.length) throw new BiError('no_metric', 'Escolha ao menos um indicador.');
  const verdict = checkChart({ type: b.chart, measures: b.metrics.map((m) => ({ additive: m.compiled.additive })), dimensions: b.dims.map((d) => ({ type: d.type, ...(d.grain ? { grain: d.grain } : {}) })) });
  if (!verdict.ok) throw new BiError('bad_chart', verdict.error);
  const cols = new Map(columns.map((c) => [c.key, c]));
  for (const d of b.dims) if (!cols.has(d.field)) throw new BiError('bad_field', 'Dimensão inválida.');
  if (b.periodField && !isTemporal(cols.get(b.periodField)?.type ?? 'string')) throw new BiError('bad_period', 'A coluna de período precisa ser uma data.');
  const { measures, exprs } = mergeMetrics(b.metrics);
  const limit = Math.min(b.limit ?? LIMIT_FOR[b.chart], LIMIT_FOR[b.chart] === 1 ? 1 : 1000);
  const temporal = b.dims.length > 0 && isTemporal(b.dims[0]!.type);
  const order: QuerySpec['order'] = b.dims.length === 0 ? [] : temporal ? [{ by: 'd0', dir: 'asc' }] : [{ by: measures[0]!.alias, dir: 'desc' }];
  const query_json = {
    dataset_id: b.datasetId, measures,
    ...(b.dims.length ? { dimensions: b.dims.map((d) => ({ field: d.field, ...(d.grain ? { grain: d.grain } : {}) })) } : {}),
    ...((b.filters?.length) ? { filters: b.filters } : {}),
    ...(b.periodField ? { period: { field: b.periodField } } : {}),
    ...(order.length ? { order } : {}), limit,
  } as QuerySpec & { period?: { field: string } };
  const filtersText = (b.filters ?? []).map((f) => `${cols.get(f.field)?.name ?? f.field} ${f.op}${f.value !== undefined ? ` ${String(f.value)}` : ''}${f.values ? ` ${f.values.join(', ')}` : ''}${f.to ? ` e ${f.to}` : ''}`);
  const display_json: WidgetDisplay = {
    kind: 'chart', chart: b.chart, dims: b.dims, datasetName: b.datasetName, limit, periodField: b.periodField ?? null, filtersText,
    metrics: b.metrics.map((m, i) => ({ id: m.id, name: m.name, format: m.format, unit: m.unit, version: m.version, description: m.description ?? null, additive: m.compiled.additive, expr: exprs[i]! })),
  };
  return { query_json, display_json, warnings: verdict.warnings };
}

// ---------------------------------------------------------------------------- avaliação das linhas devolvidas pelo banco
export type ResultRow = { dims: (string | null)[]; values: MetricValue[] };
export type ResultSet = { dims: DimRef[]; metrics: MetricDisplay[]; rows: ResultRow[]; truncated: boolean; versionNumber: number | null; publishedAt: string | null; others?: ResultRow | null };

export function evalRows(display: WidgetDisplay, rows: Array<Record<string, string | null>>, measures: Measure[]): ResultRow[] {
  return rows.map((r) => {
    const raw: Record<string, string | null> = {};
    for (const m of measures) raw[m.alias] = r[m.alias] ?? null;
    const vals = normalizeCount(raw, measures);
    return { dims: display.dims.map((_, i) => r[`d${i}`] ?? null), values: display.metrics.map((m) => evaluate(m.expr, vals)) };
  });
}

/** «Outros» da pizza: total (consulta sem dimensão) menos a soma dos maiores; só quando a métrica é aditiva e sobra um resto positivo. */
export function othersRow(display: WidgetDisplay, top: ResultRow[], total: ResultRow | undefined): ResultRow | null {
  if (!total || display.metrics.length !== 1 || !display.metrics[0]!.additive) return null;
  const t = toDec(total.values[0]?.state === 'ok' ? total.values[0].value : null);
  if (!t) return null;
  let sum = new D(0);
  for (const r of top) { const v = toDec(r.values[0]?.value); if (v) sum = sum.plus(v); }
  const rest = t.minus(sum);
  return rest.gt(0) ? { dims: ['Outros'], values: [{ value: rest.toFixed(), state: 'ok' }] } : null;
}
