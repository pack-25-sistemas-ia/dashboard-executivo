import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { GOAL_LABEL, GOAL_STATUS_LABEL, comparisonRange, compileMetric, evaluate, evaluateGoal, formatValue, isTemporal, normalizeCount, pctText, type ComparisonMode, type GoalKind } from '@/lib/bi/engine';
import { loadColumns, loadDataset, loadGoals, loadMembers, loadMetrics, metricDefs, toEngineColumns, type GoalRow, type MetricRow } from '@/lib/bi/data';
import { goalRange } from '@/lib/bi/dashboard-view';
import { pageCtx, type PageCtx } from '@/lib/bi/page';
import { archiveGoal, notifyGoal } from '@/lib/bi/actions/misc';
import { ActionButton } from '@/components/bi/fields';
import { GoalForm, GoalPeriodForm } from '@/components/bi/forms';
import { Disclosure, Section, StatusBadge, TD, TH, TableShell } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Metas' };

async function actualFor(p: PageCtx, m: MetricRow, g: GoalRow, range: { from: string; to: string }, cache: Map<string, Awaited<ReturnType<typeof loadDataset>>>) {
  const ds = cache.get(m.dataset_id) ?? (await loadDataset(p.ctx, m.dataset_id));
  cache.set(m.dataset_id, ds);
  if (!ds?.current_version_id) return null;
  const cols = toEngineColumns(await loadColumns(p.ctx, ds.current_version_id));
  const pf = cols.find((c) => isTemporal(c.type) && c.semantic === 'time') ?? cols.find((c) => isTemporal(c.type));
  const defs = metricDefs(await loadMetrics(p.ctx, m.dataset_id));
  const c = compileMetric(m.id, defs, cols);
  const run = async (r: { from: string; to: string }) => {
    const { data } = await p.ctx.supabase.rpc('bi_run_query', { p_org: p.org, p_spec: { dataset_id: m.dataset_id, measures: c.measures, filters: g.scope_json ?? [], ...(pf ? { period: { field: pf.key, ...r } } : {}) } });
    const row = (data as { rows: Array<Record<string, string | null>> } | null)?.rows?.[0];
    if (!row) return null;
    const v = evaluate(c.expr, normalizeCount(Object.fromEntries(c.measures.map((x) => [x.alias, row[x.alias] ?? null])), c.measures));
    return v.state === 'ok' ? v.value : null;
  };
  const actual = await run(range);
  const previous = g.goal_kind === 'growth' || g.goal_kind === 'reduction' ? await run(comparisonRange(range, g.comparison_operator as Exclude<ComparisonMode, 'none'>)) : null;
  return { actual, previous };
}

export default async function GoalsPage() {
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const [{ goals, periods }, metrics, members] = await Promise.all([loadGoals(p.ctx), loadMetrics(p.ctx), loadMembers(p.ctx)]);
  const mById = new Map(metrics.map((m) => [m.id, m]));
  const cache = new Map<string, Awaited<ReturnType<typeof loadDataset>>>();
  const active = goals.filter((g) => g.status === 'active');
  const rows = await Promise.all(active.map(async (g) => {
    const m = mById.get(g.metric_id);
    const gr = goalRange(g, periods, p.today);
    if (!m || m.status !== 'active') return { g, m, gr, result: null as ReturnType<typeof evaluateGoal> | null, actual: null as string | null };
    try {
      const { actual, previous } = (await actualFor(p, m, g, gr.range, cache)) ?? { actual: null, previous: null };
      const result = evaluateGoal({ kind: g.goal_kind as GoalKind, target: gr.target, ...(g.target_high_decimal !== null ? { targetHigh: String(g.target_high_decimal) } : {}), actual, previous, warnPct: Number(g.warn_pct), periodOpen: gr.open });
      return { g, m, gr, result, actual };
    } catch { return { g, m, gr, result: null, actual: null }; }
  }));
  if (p.perms.manager) for (const r of rows) if (r.result && (r.result.status === 'achieved' || r.result.status === 'missed' || r.result.status === 'attention')) await notifyGoal(r.g.id, r.result.status, r.gr.label === 'mês atual' ? p.today.slice(0, 7) : r.gr.label.slice(0, 30));

  return (
    <>
      <PageHeader title="Metas" description="Meta vs. realizado, respeitando a direção (quanto menor, melhor não usa a mesma lógica de quanto maior, melhor). Não há projeção de atingimento futuro." />
      <Section title="Acompanhamento">
        <TableShell caption="Metas ativas" empty={rows.length === 0} emptyText={p.perms.manager ? 'Nenhuma meta ainda. Crie a primeira abaixo.' : 'Nenhuma meta ativa.'}>
          <thead><tr><th scope="col" className={TH}>Meta</th><th scope="col" className={TH}>Indicador</th><th scope="col" className={TH}>Período</th><th scope="col" className={TH}>Alvo</th><th scope="col" className={TH}>Realizado</th><th scope="col" className={TH}>Atingimento</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{rows.map(({ g, m, gr, result, actual }) => {
            const fmt = m?.format_type ?? 'decimal';
            const pct = g.goal_kind === 'growth' || g.goal_kind === 'reduction';
            return (
              <tr key={g.id} className="border-t border-border" data-testid="goal-row">
                <td className={TD}><strong>{g.name}</strong><p className="text-xs text-muted">{GOAL_LABEL[g.goal_kind]}</p></td>
                <td className={TD}>{m?.name ?? '—'}{m?.status === 'invalid' ? <p className="text-xs text-danger">indicador inválido</p> : null}</td>
                <td className={TD}>{gr.label}</td>
                <td className={`${TD} tabular-nums`}>{pct ? `${gr.target}%` : g.goal_kind === 'range' ? `${formatValue(gr.target, fmt)} a ${formatValue(String(g.target_high_decimal), fmt)}` : formatValue(gr.target, fmt)}</td>
                <td className={`${TD} tabular-nums`}>{actual !== null ? formatValue(actual, fmt) : '—'}</td>
                <td className={`${TD} tabular-nums`}>{result?.attainmentPct ? pctText(result.attainmentPct, 1) : result?.gap && pct ? `${pctText(result.gap, 1)} pp` : '—'}</td>
                <td className={TD}>{result ? <><StatusBadge status={result.status} label={GOAL_STATUS_LABEL[result.status]} /><p className="mt-1 text-xs text-muted">{result.note}</p></> : <StatusBadge status="unavailable" label="Sem dados" />}</td>
                <td className={TD}>{p.perms.manager ? <ActionButton action={archiveGoal} fields={{ id: g.id }} label="Arquivar" variant="danger" confirm="Arquivar a meta?" /> : null}</td>
              </tr>
            );
          })}</tbody>
        </TableShell>
      </Section>
      {p.perms.manager ? (
        <>
          <Section title="Nova meta" description="Mínima: realizado ≥ alvo. Máxima: realizado ≤ alvo. Crescimento/redução: variação percentual vs. o período de comparação. Faixa: manter entre dois valores.">
            <GoalForm metrics={metrics.filter((m) => m.status === 'active').map((m) => ({ value: m.id, label: m.name }))} members={members.map((m) => ({ value: m.user_id, label: m.name }))} />
          </Section>
          {active.length ? (
            <Disclosure summary="Alvo específico de um período (substitui o alvo padrão naquele intervalo)">
              <GoalPeriodForm goals={active.map((g) => ({ value: g.id, label: g.name }))} />
            </Disclosure>
          ) : null}
        </>
      ) : <p className="text-sm text-muted">Metas são criadas por gestores e administradores.</p>}
    </>
  );
}
