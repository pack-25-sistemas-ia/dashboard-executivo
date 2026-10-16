import 'server-only';
import type { Context } from '@/lib/auth/session';
import { BiError, compileMetric, isTemporal, type Filter } from './engine';
import { loadColumns, loadDataset, loadMetrics, metricDefs, toEngineColumns, type DatasetRow, type MetricRow } from './data';
import { buildWidget, type DimRef, type MetricRef, type WidgetDisplay } from './widgets';
import type { ChartBuilder } from './builder';

export type Compiled = {
  dataset: DatasetRow; query_json: ReturnType<typeof buildWidget>['query_json']; display_json: WidgetDisplay & { builder: ChartBuilder }; metric_id: string | null; metric_version: number | null; warnings: string[];
};

/** Compila a configuração do construtor de gráficos (indicadores + dimensões + filtros) numa consulta declarativa e na expressão de cada indicador. */
export async function compileBuilder(ctx: Context, b: ChartBuilder): Promise<Compiled> {
  const dataset = await loadDataset(ctx, b.dataset_id);
  if (!dataset) throw new BiError('no_dataset', 'Dataset não encontrado ou sem permissão.');
  if (dataset.status !== 'active') throw new BiError('archived', 'O dataset está arquivado.');
  if (!dataset.current_version_id) throw new BiError('no_data', 'O dataset ainda não tem dados publicados.');
  const columns = toEngineColumns(await loadColumns(ctx, dataset.current_version_id));
  const rows = await loadMetrics(ctx, dataset.id);
  const defs = metricDefs(rows);
  const byId = new Map<string, MetricRow>(rows.map((r) => [r.id, r]));
  const metrics: MetricRef[] = b.metric_ids.map((id) => {
    const r = byId.get(id);
    if (!r) throw new BiError('no_metric', 'Indicador não encontrado neste dataset.');
    if (r.status !== 'active') throw new BiError('metric_invalid', `O indicador «${r.name}» está ${r.status === 'invalid' ? 'inválido' : 'arquivado'}.`);
    return { id: r.id, name: r.name, format: r.format_type, unit: r.unit, version: r.current_version, description: r.description, compiled: compileMetric(r.id, defs, columns) };
  });
  const cols = new Map(columns.map((c) => [c.key, c]));
  const dims: DimRef[] = b.dims.map((d) => {
    const c = cols.get(d.field);
    if (!c) throw new BiError('bad_field', 'Dimensão inválida.');
    if (isTemporal(c.type) && !d.grain) throw new BiError('bad_grain', `Escolha a granularidade de «${c.name}» (dia, mês, ano…).`);
    return { field: d.field, name: c.name, type: c.type, ...(d.grain ? { grain: d.grain } : {}) };
  });
  const built = buildWidget({ chart: b.chart, metrics, dims, filters: b.filters as Filter[], periodField: b.period_field, datasetId: dataset.id, datasetName: dataset.name }, columns);
  return { dataset, query_json: built.query_json, display_json: { ...built.display_json, builder: b }, metric_id: metrics[0]?.id ?? null, metric_version: metrics[0]?.version ?? null, warnings: built.warnings };
}
