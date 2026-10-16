import Link from 'next/link';
import { Badge } from '@/components/ui/primitives';
import { GOAL_STATUS_LABEL, STATE_TEXT, formatValue, labelBucket, pctText, type Grain, type GoalResult, type MetricValue, type Variation } from '@/lib/bi/engine';
import type { WidgetRow } from '@/lib/bi/data';
import type { WidgetOutcome } from '@/lib/bi/run';
import type { ResultSet, WidgetDisplay } from '@/lib/bi/widgets';
import { cn } from '@/lib/utils';
import { ChartBodyClient } from './charts-loader';
import { DateBR, StatusBadge, TD, TDR, TH, THR } from './bits';

export type WidgetExtras = {
  goal?: { name: string; result: GoalResult; target: string; kind: string; periodLabel: string; format: WidgetDisplay['metrics'][number]['format'] } | null;
  sources?: Array<{ dataset_id: string; name: string; version_number: number | null; published_at: string | null; stale: boolean; status: string }>;
  invalidMetrics?: Array<{ id: string; name: string; reason: string | null }>;
  latestMetricVersion?: Record<string, number>;
};

const fv = (m: MetricValue, f: WidgetDisplay['metrics'][number]) => (m.state === 'ok' ? formatValue(m.value, f.format) + (f.unit && f.format !== 'currency' && f.format !== 'percentage' ? ` ${f.unit}` : '') : '—');
const dimText = (rs: ResultSet, raw: string | null, i: number) => {
  if (raw === null || raw === '') return '(vazio)';
  const d = rs.dims[i];
  if (d?.grain) return labelBucket(raw, d.grain as Grain);
  if (d && (d.type === 'date' || d.type === 'timestamp')) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw); return m ? `${m[3]}/${m[2]}/${m[1]}` : raw; }
  return raw;
};

function Why({ m }: { m: MetricValue }) {
  return m.state === 'ok' ? null : <p className="mt-1 text-xs text-muted" role="note">{STATE_TEXT[m.state]}</p>;
}

function VariationLine({ v, basis, range }: { v: Variation | undefined; basis: string | null; range: { from: string; to: string } | null }) {
  if (!v) return null;
  const arrow = v.direction === 'up' ? '▲' : v.direction === 'down' ? '▼' : '■';
  return (
    <div className="mt-2 text-xs" data-testid="variation">
      {v.state === 'ok' ? <p className="font-medium"><span aria-hidden>{arrow}</span> {v.pct && Number(v.pct) > 0 ? '+' : ''}{pctText(v.pct, 1)} <span className="font-normal text-muted">vs. período de comparação</span></p> : <p className="text-muted">{v.note}</p>}
      {basis && range ? <p className="text-muted">Comparando com {range.from.split('-').reverse().join('/')} a {range.to.split('-').reverse().join('/')} ({basis}).</p> : null}
    </div>
  );
}

export function WidgetBody({ w, outcome, extras, tz }: { w: WidgetRow; outcome: WidgetOutcome | null; extras?: WidgetExtras; tz: string }) {
  const display = w.display_json as unknown as WidgetDisplay & { text?: string; kind: string };
  if (w.widget_type === 'text') return <p className="whitespace-pre-wrap text-sm">{(display as { text?: string }).text}</p>;
  if (w.widget_type === 'freshness') {
    const src = extras?.sources ?? [];
    return src.length ? (
      <ul className="space-y-2 text-sm">
        {src.map((s) => (
          <li key={s.dataset_id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{s.name}</span>
            <span className="flex items-center gap-2 text-muted">{s.version_number ? `v${s.version_number} · ` : ''}<DateBR value={s.published_at} /> {s.stale ? <Badge tone="warning">Desatualizado</Badge> : <Badge tone="success">Em dia</Badge>}</span>
          </li>
        ))}
      </ul>
    ) : <p className="text-sm text-muted">Nenhum dataset usado neste dashboard.</p>;
  }
  if (w.widget_type === 'alert') {
    const stale = (extras?.sources ?? []).filter((s) => s.stale || s.status === 'archived');
    const inv = extras?.invalidMetrics ?? [];
    if (!stale.length && !inv.length) return <p className="text-sm text-success" role="status">✓ Nenhum aviso: dados em dia e indicadores válidos.</p>;
    return (
      <ul className="space-y-1 text-sm" role="list">
        {stale.map((s) => <li key={s.dataset_id}>⚠ {s.status === 'archived' ? `O dataset «${s.name}» está arquivado.` : `O dataset «${s.name}» está desatualizado.`}</li>)}
        {inv.map((m) => <li key={m.id}>⚠ O indicador «{m.name}» está inválido{m.reason ? `: ${m.reason}` : ''}.</li>)}
      </ul>
    );
  }
  if (!outcome) return <p className="text-sm text-muted">Sem consulta.</p>;
  if (!outcome.ok) return <p className="rounded-md border border-danger px-3 py-2 text-sm text-danger" role="alert">{outcome.error}</p>;
  const { result: rs, previous, variation, previousRange } = outcome;
  const m0 = display.metrics[0];

  if (w.widget_type === 'goal' && extras?.goal && m0) {
    const g = extras.goal;
    const a = rs.rows[0]?.values[0];
    return (
      <div>
        <p className="text-sm text-muted">{g.name} · {g.periodLabel}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums" data-testid="goal-actual">{a ? fv(a, m0) : '—'}</p>
        <p className="mt-1 text-sm"><StatusBadge status={g.result.status} label={GOAL_STATUS_LABEL[g.result.status]} /> <span className="text-muted">Meta: {g.kind === 'growth' || g.kind === 'reduction' ? `${g.target}%` : formatValue(g.target, g.format)}{g.result.attainmentPct ? ` · ${pctText(g.result.attainmentPct, 0)} do alvo` : ''}</span></p>
        <p className="mt-1 text-xs text-muted">{g.result.note}</p>
        {g.result.attainmentPct ? <progress className="mt-2 h-2 w-full" max={100} value={Math.min(100, Number(g.result.attainmentPct))} aria-label="Atingimento da meta" /> : null}
      </div>
    );
  }

  if ((display.chart === 'kpi' || w.widget_type === 'kpi' || w.widget_type === 'comparison') && m0) {
    const v = rs.rows[0]?.values[0];
    return (
      <div>
        <p className="text-3xl font-semibold tabular-nums" data-testid="kpi-value">{v ? fv(v, m0) : '—'}</p>
        {v ? <Why m={v} /> : null}
        {previous && variation ? <VariationLine v={variation[0]} basis={previousRange?.basis ?? null} range={previousRange} /> : null}
        {w.widget_type === 'comparison' && previous?.rows[0]?.values[0] ? <p className="mt-1 text-xs text-muted">Período anterior: {fv(previous.rows[0].values[0], m0)}</p> : null}
      </div>
    );
  }

  if (display.chart === 'table') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm"><caption className="sr-only">{w.title}</caption>
          <thead><tr>{rs.dims.map((d) => <th key={d.field} scope="col" className={TH}>{d.name}</th>)}{rs.metrics.map((m) => <th key={m.id} scope="col" className={THR}>{m.name}</th>)}</tr></thead>
          <tbody>{rs.rows.map((r, i) => <tr key={i} className="border-t border-border">{r.dims.map((d, j) => <td key={j} className={TD}>{dimText(rs, d, j)}</td>)}{r.values.map((v, j) => <td key={j} className={TDR}>{fv(v, rs.metrics[j]!)}</td>)}</tr>)}</tbody>
        </table>
        {rs.truncated ? <p className="mt-2 text-xs text-muted">Mostrando as primeiras {rs.rows.length} linhas.</p> : null}
      </div>
    );
  }

  return (
    <div>
      <ChartBodyClient chart={display.chart} rs={rs} />
      {rs.truncated ? <p className="mt-1 text-xs text-muted">Mostrando os {rs.rows.length} maiores valores.</p> : null}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted">Ver dados em tabela</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs"><caption className="sr-only">Dados de {w.title}</caption>
            <thead><tr>{rs.dims.map((d) => <th key={d.field} scope="col" className={cn(TH, 'normal-case')}>{d.name}</th>)}{rs.metrics.map((m) => <th key={m.id} scope="col" className={cn(THR, 'normal-case')}>{m.name}</th>)}</tr></thead>
            <tbody>
              {rs.rows.map((r, i) => <tr key={i} className="border-t border-border">{r.dims.map((d, j) => <td key={j} className={TD}>{dimText(rs, d, j)}</td>)}{r.values.map((v, j) => <td key={j} className={TDR}>{fv(v, rs.metrics[j]!)}</td>)}</tr>)}
              {rs.others ? <tr className="border-t border-border"><td className={TD}>Outros</td>{rs.others.values.map((v, j) => <td key={j} className={TDR}>{fv(v, rs.metrics[j]!)}</td>)}</tr> : null}
            </tbody>
          </table>
        </div>
      </details>
      {/* tz mantido para futuras legendas de horário */}
      <span className="sr-only">{tz}</span>
    </div>
  );
}

export function WidgetCard({ w, outcome, extras, tz, dashboardId }: { w: WidgetRow; outcome: WidgetOutcome | null; extras?: WidgetExtras; tz: string; dashboardId: string }) {
  const display = w.display_json as unknown as WidgetDisplay;
  const result = outcome && outcome.ok ? outcome.result : null;
  const outdated = (display.metrics ?? []).filter((m) => (extras?.latestMetricVersion?.[m.id] ?? m.version) > m.version);
  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-4 shadow-sm" aria-label={w.title || 'Widget'} data-widget-type={w.widget_type}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug">{w.title || ' '}</h3>
        {display.metrics?.[0] ? <Link href={`/indicadores/${display.metrics[0].id}?dashboard=${dashboardId}`} className="shrink-0 text-xs text-muted underline underline-offset-2" aria-label={`Origem do indicador ${display.metrics[0].name}`}>Origem</Link> : null}
      </div>
      <div className="min-h-0 flex-1">
        <WidgetBody w={w} outcome={outcome} extras={extras} tz={tz} />
      </div>
      {display.datasetName ? (
        <p className="mt-3 text-[11px] leading-snug text-muted">
          Fonte: {display.datasetName}{result?.versionNumber ? ` · versão ${result.versionNumber}` : ''}{result?.publishedAt ? ` · atualizado em ${new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(result.publishedAt))}` : ''}
          {display.filtersText?.length ? ` · filtros: ${display.filtersText.join('; ')}` : ''}
        </p>
      ) : null}
      {outdated.length ? <p className="mt-1 text-[11px] text-warning" role="note">Há versão mais nova de «{outdated.map((m) => m.name).join('», «')}». Este widget usa a versão anterior até ser atualizado no editor.</p> : null}
    </section>
  );
}
