import 'server-only';
import type { Context } from '@/lib/auth/session';
import { addDays, endOfMonth, evaluateGoal, startOfMonth, startOfQuarter, startOfYear, addMonths, type ComparisonMode, type GoalKind, type Preset, type Range } from './engine';
import { loadMetrics, type DashFilterRow, type DashboardRow, type GoalPeriodRow, type GoalRow, type MetricRow, type WidgetRow } from './data';
import { runWidget, type FilterValues, type WidgetOutcome } from './run';
import type { WidgetExtras } from '@/components/bi/widget-view';
import type { WidgetDisplay } from './widgets';
import { isUuid, one, type SearchParams } from './filters';

export type GoalEval = NonNullable<WidgetExtras['goal']>;

/** Intervalo da meta «até hoje»: mês/trimestre/ano em andamento (a meta de período específico em goal_periods, quando cobre hoje, define o alvo e o fim). */
export function goalRange(g: GoalRow, periods: GoalPeriodRow[], today: string): { range: Range; target: string; label: string; open: boolean } {
  const covering = periods.find((p) => p.goal_id === g.id && p.period_start <= today && today <= p.period_end);
  if (covering) return { range: { from: covering.period_start, to: today < covering.period_end ? today : covering.period_end }, target: String(covering.target_value_decimal), label: `${covering.period_start.split('-').reverse().join('/')} a ${covering.period_end.split('-').reverse().join('/')}`, open: today < covering.period_end };
  const from = g.period_type === 'quarter' ? startOfQuarter(today) : g.period_type === 'year' ? startOfYear(today) : startOfMonth(today);
  const end = g.period_type === 'quarter' ? addDays(addMonths(startOfQuarter(today), 3), -1) : g.period_type === 'year' ? `${today.slice(0, 4)}-12-31` : endOfMonth(today);
  const label = g.period_type === 'quarter' ? 'trimestre atual' : g.period_type === 'year' ? 'ano atual' : 'mês atual';
  return { range: { from, to: today }, target: String(g.target_value_decimal), label, open: today < end };
}

/** Executa um widget de meta: período da meta + comparação (quando crescimento/redução) e avalia respeitando a direção. */
export async function evaluateGoalWidget(ctx: Context, org: string, dashId: string, w: WidgetRow, today: string): Promise<{ outcome: WidgetOutcome; goal: GoalEval | null }> {
  const display = w.display_json as unknown as WidgetDisplay & { goalId?: string };
  const { data: gd } = await ctx.supabase.rpc('bi_widget_goal', { p_org: org, p_dashboard: dashId, p_widget: w.id });
  const pack = gd as { goal: GoalRow; periods: GoalPeriodRow[] } | null;
  const g = pack?.goal;
  if (!g || !pack) return { outcome: { ok: false, error: 'A meta deste widget não existe mais ou você não tem acesso a ela.' }, goal: null };
  const gr = goalRange(g, pack.periods, today);
  const outcome = await runWidget(ctx, org, dashId, w, { range: gr.range, comparison: g.goal_kind === 'growth' || g.goal_kind === 'reduction' ? (g.comparison_operator as ComparisonMode) : 'none', preset: undefined as Preset | undefined, today });
  if (!outcome.ok) return { outcome, goal: null };
  const actual = outcome.result.rows[0]?.values[0]?.value ?? null;
  const prev = outcome.previous?.rows[0]?.values[0]?.value ?? null;
  const result = evaluateGoal({ kind: g.goal_kind as GoalKind, target: gr.target, ...(g.target_high_decimal !== null ? { targetHigh: String(g.target_high_decimal) } : {}), actual, previous: prev, warnPct: Number(g.warn_pct), periodOpen: gr.open });
  return { outcome, goal: { name: g.name, result, target: gr.target, kind: g.goal_kind, periodLabel: gr.label, format: display.metrics[0]?.format ?? 'decimal' } };
}

export function filterValuesFromParams(sp: SearchParams, filters: DashFilterRow[]): FilterValues {
  const out: FilterValues = {};
  for (const f of filters) {
    const raw = sp[`f_${f.id}`];
    if (f.operator === 'in') {
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((x) => x.split('|')).map((x) => x.trim()).filter(Boolean).slice(0, 50);
      if (list.length) out[f.id] = { values: list };
    } else if (f.operator === 'between') {
      const lo = one(sp[`f_${f.id}_a`]); const hi = one(sp[`f_${f.id}_b`]);
      if (lo && hi) out[f.id] = { value: lo, to: hi };
    } else {
      const v = one(raw);
      if (v) out[f.id] = { value: v.slice(0, 200) };
    }
  }
  return out;
}

export type DashView = {
  outcomes: Map<string, WidgetOutcome>;
  goals: Map<string, GoalEval | null>;
  extras: WidgetExtras;
};

/** Consulta todos os widgets do dashboard em paralelo (cada um passa pelas funções autorizadas do banco). */
export async function loadDashView(ctx: Context, org: string, d: DashboardRow, widgets: WidgetRow[], o: { range: Range; preset: Preset; comparison: ComparisonMode; today: string; filters: FilterValues }): Promise<DashView> {
  const [metrics, sources] = await Promise.all([
    loadMetricsSafe(ctx, widgets),
    ctx.supabase.rpc('bi_dashboard_sources', { p_org: org, p_dashboard: d.id }),
  ]);
  const outcomes = new Map<string, WidgetOutcome>();
  const goals = new Map<string, GoalEval | null>();
  await Promise.all(widgets.map(async (w) => {
    if (w.widget_type === 'text' || w.widget_type === 'freshness' || w.widget_type === 'alert') return;
    if (w.widget_type === 'goal') { const r = await evaluateGoalWidget(ctx, org, d.id, w, o.today); outcomes.set(w.id, r.outcome); goals.set(w.id, r.goal); return; }
    outcomes.set(w.id, await runWidget(ctx, org, d.id, w, { range: o.range, filters: o.filters, comparison: o.comparison, preset: o.preset, today: o.today, partialBasis: d.partial_basis }));
  }));
  const latest: Record<string, number> = {};
  const invalid: Array<{ id: string; name: string; reason: string | null }> = [];
  for (const m of metrics) { latest[m.id] = m.current_version; if (m.status === 'invalid') invalid.push({ id: m.id, name: m.name, reason: m.invalid_reason }); }
  return { outcomes, goals, extras: { sources: (sources.data ?? []) as WidgetExtras['sources'], invalidMetrics: invalid, latestMetricVersion: latest } };
}

async function loadMetricsSafe(ctx: Context, widgets: WidgetRow[]): Promise<MetricRow[]> {
  // Visualizadores não leem definições (RLS); para eles o resultado é vazio e os avisos de versão/invalidez não aparecem — sem erro.
  const ids = new Set(widgets.flatMap((w) => ((w.display_json as unknown as WidgetDisplay).metrics ?? []).map((m) => m.id)));
  if (!ids.size) return [];
  const all = await loadMetrics(ctx);
  return all.filter((m) => ids.has(m.id));
}

export { isUuid };
