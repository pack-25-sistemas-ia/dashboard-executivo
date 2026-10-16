import 'server-only';
import type { Context } from '@/lib/auth/session';
import { comparisonRange, isPartialPeriod, variation, type ComparisonMode, type MetricValue, type Measure, type PartialBasis, type Preset, type Range, type Variation } from './engine';
import { dbMessage } from './action-kit';
import { evalRows, othersRow, type ResultRow, type ResultSet, type WidgetDisplay } from './widgets';
import type { WidgetRow } from './data';

export type FilterValues = Record<string, { value?: string | boolean; values?: (string | boolean)[]; to?: string }>;
export type WidgetOutcome =
  | { ok: true; result: ResultSet; previous: ResultSet | null; previousRange: (Range & { basis: string }) | null; variation: Variation[] | null }
  | { ok: false; error: string };

type RpcRes = { rows: Array<Record<string, string | null>>; truncated: boolean; version_number: number; published_at: string | null };

async function call(ctx: Context, org: string, dash: string, widget: string, overrides: object, total = false): Promise<{ data: RpcRes | null; error: string | null }> {
  const { data, error } = await ctx.supabase.rpc('bi_widget_query', { p_org: org, p_dashboard: dash, p_widget: widget, p_overrides: overrides, p_total: total });
  if (error) return { data: null, error: dbMessage(error) };
  return { data: data as RpcRes, error: null };
}

function toResultSet(display: WidgetDisplay, query: { measures: Measure[] }, r: RpcRes): ResultSet {
  return { dims: display.dims, metrics: display.metrics, rows: evalRows(display, r.rows, query.measures), truncated: r.truncated, versionNumber: r.version_number, publishedAt: r.published_at };
}

/** Executa um widget de dados: período e filtros vêm do chamador; a consulta vem do banco. KPI e comparativo também consultam o período de comparação. */
export async function runWidget(ctx: Context, org: string, dashId: string, w: WidgetRow, o: { range?: Range; filters?: FilterValues; comparison?: ComparisonMode; preset?: Preset; today?: string; partialBasis?: PartialBasis }): Promise<WidgetOutcome> {
  const display = w.display_json as unknown as WidgetDisplay;
  const query = w.query_json as unknown as { measures: Measure[] } | null;
  if (!query || !display || display.kind !== 'chart') return { ok: false, error: 'Este widget não consulta dados.' };
  const base = { ...(o.range && display.periodField ? { period: o.range } : {}), ...(o.filters && Object.keys(o.filters).length ? { filters: o.filters } : {}) };
  const cur = await call(ctx, org, dashId, w.id, base);
  if (cur.error || !cur.data) return { ok: false, error: cur.error ?? 'Não foi possível consultar.' };
  const result = toResultSet(display, query, cur.data);
  if ((display.chart === 'pie' || display.chart === 'donut') && result.rows.length) {
    const tot = await call(ctx, org, dashId, w.id, base, true);
    if (tot.data) result.others = othersRow(display, result.rows, toResultSet(display, query, tot.data).rows[0]);
  }
  let previous: ResultSet | null = null;
  let previousRange: (Range & { basis: string }) | null = null;
  let varia: Variation[] | null = null;
  const wantsCompare = (display.chart === 'kpi' || w.widget_type === 'comparison') && o.comparison && o.comparison !== 'none' && o.range && display.periodField;
  if (wantsCompare && o.range && o.comparison && o.comparison !== 'none') {
    const partial = o.preset && o.today ? isPartialPeriod(o.preset, o.today) : false;
    previousRange = comparisonRange(o.range, o.comparison, { partial, partialBasis: o.partialBasis ?? 'same_days' });
    const prev = await call(ctx, org, dashId, w.id, { ...base, period: previousRange });
    if (prev.data) {
      previous = toResultSet(display, query, prev.data);
      const a: ResultRow | undefined = result.rows[0];
      const b: ResultRow | undefined = previous.rows[0];
      varia = display.metrics.map((_, i) => variation((a?.values[i] as MetricValue | undefined)?.value ?? null, (b?.values[i] as MetricValue | undefined)?.value ?? null));
    }
  }
  return { ok: true, result, previous, previousRange, variation: varia };
}
