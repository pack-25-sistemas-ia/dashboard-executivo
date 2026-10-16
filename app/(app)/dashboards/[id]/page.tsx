import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Button, Input, PageHeader, Select } from '@/components/ui/primitives';
import { COMPARISON_LABEL, COMPARISONS, PRESETS, PRESET_LABEL } from '@/lib/bi/engine';
import { loadDashboard, loadDashboardVersions } from '@/lib/bi/data';
import { filterValuesFromParams, loadDashView } from '@/lib/bi/dashboard-view';
import { resolvePeriodSel, type SearchParams } from '@/lib/bi/filters';
import { DASH_STATUS_LABELS, VISIBILITY_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { nowIso } from '@/lib/time';
import { DashboardGrid } from '@/components/bi/dashboard-grid';
import { StatusBadge, DateTimeBR } from '@/components/bi/bits';
import { WidgetCard } from '@/components/bi/widget-view';
import { DashboardActions } from '@/components/bi/dashboard-actions';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const p = await pageCtx();
  const data = await loadDashboard(p.ctx, id);
  if (!data) notFound();
  const { dashboard: d, widgets, filters, level } = data;
  const sel = resolvePeriodSel(sp, p.today, { preset: d.default_period as never, comparison: d.comparison as never });
  const fvals = filterValuesFromParams(sp, filters);
  const [view, versions] = await Promise.all([
    loadDashView(p.ctx, p.org, d, widgets, { range: sel.range, preset: sel.preset, comparison: sel.comparison, today: p.today, filters: fvals }),
    p.perms.analyst ? loadDashboardVersions(p.ctx, id) : Promise.resolve([]),
  ]);
  await p.ctx.supabase.rpc('bi_touch_dashboard', { p_org: p.org, p_id: id });
  const { data: fav } = await p.ctx.supabase.from('dashboard_favorites').select('dashboard_id').eq('dashboard_id', id).maybeSingle();
  const canEdit = level !== 'view' && p.perms.analyst;
  const hasPeriodWidgets = widgets.some((w) => (w.query_json as { period?: unknown } | null)?.period);
  // opções de valores para filtros do tipo «igual» e «em lista»
  const optionLists = new Map<string, string[]>();
  await Promise.all(filters.filter((f) => f.operator === 'eq' || f.operator === 'in').map(async (f) => {
    const { data: vals } = await p.ctx.supabase.rpc('bi_dashboard_filter_values', { p_org: p.org, p_dashboard: id, p_filter: f.id });
    if (Array.isArray(vals)) optionLists.set(f.id, vals as string[]);
  }));
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) { const x = Array.isArray(v) ? v.join('|') : v; if (x && /^(p|from|to|cmp|f_.+)$/.test(k)) qs.set(k, x); }
  const printNote = `${PRESET_LABEL[sel.preset]}: ${sel.range.from.split('-').reverse().join('/')} a ${sel.range.to.split('-').reverse().join('/')}`;

  return (
    <>
      <PageHeader title={d.name} description={d.description ?? undefined}>
        <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
          <StatusBadge status={d.status} label={DASH_STATUS_LABELS[d.status] ?? d.status} />
          <Badge>{VISIBILITY_LABELS[d.visibility]?.split(' (')[0]}</Badge>
        </div>
      </PageHeader>
      <DashboardActions dashboardId={id} name={d.name} status={d.status} visibility={d.visibility} canEdit={canEdit} canPublish={p.perms.manager && level !== 'view'} canShare={level === 'admin' && p.perms.analyst} canArchive={level === 'admin' && p.perms.analyst}
        isFavorite={Boolean(fav)} rowVersion={d.row_version} versions={versions.map((v) => ({ number: v.version_number, createdAt: v.created_at }))} canRestore={canEdit} tz={p.tz} exportHref={`/api/export/dashboard/${id}${qs.toString() ? `?${qs.toString()}` : ''}`} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3 print:hidden" aria-label="Período e filtros do dashboard">
        <div>
          <label htmlFor="p" className="mb-1 block text-xs font-medium text-muted">Período</label>
          <Select id="p" name="p" defaultValue={sel.preset} className="w-48">{PRESETS.map((x) => <option key={x} value={x}>{PRESET_LABEL[x]}</option>)}</Select>
        </div>
        <div><label htmlFor="from" className="mb-1 block text-xs font-medium text-muted">De (personalizado)</label><Input id="from" name="from" type="date" defaultValue={sel.preset === 'custom' ? sel.range.from : ''} /></div>
        <div><label htmlFor="to" className="mb-1 block text-xs font-medium text-muted">Até</label><Input id="to" name="to" type="date" defaultValue={sel.preset === 'custom' ? sel.range.to : ''} /></div>
        <div>
          <label htmlFor="cmp" className="mb-1 block text-xs font-medium text-muted">Comparar com</label>
          <Select id="cmp" name="cmp" defaultValue={sel.comparison} className="w-64">{COMPARISONS.map((x) => <option key={x} value={x}>{COMPARISON_LABEL[x]}</option>)}</Select>
        </div>
        {filters.map((f) => {
          const cur = fvals[f.id];
          const opts = optionLists.get(f.id) ?? [];
          if (f.operator === 'between') return (
            <div key={f.id} className="flex items-end gap-2"><div><label htmlFor={`f_${f.id}_a`} className="mb-1 block text-xs font-medium text-muted">{f.label} (de)</label><Input id={`f_${f.id}_a`} name={`f_${f.id}_a`} defaultValue={cur?.value !== undefined ? String(cur.value) : ''} className="w-32" /></div>
              <div><label htmlFor={`f_${f.id}_b`} className="mb-1 block text-xs font-medium text-muted">até</label><Input id={`f_${f.id}_b`} name={`f_${f.id}_b`} defaultValue={cur?.to ?? ''} className="w-32" /></div></div>
          );
          if (f.operator === 'in') return (
            <div key={f.id}><label htmlFor={`f_${f.id}`} className="mb-1 block text-xs font-medium text-muted">{f.label}</label>
              <select id={`f_${f.id}`} name={`f_${f.id}`} multiple size={Math.min(4, Math.max(2, opts.length))} defaultValue={(cur?.values ?? []).map(String)} className="min-w-40 rounded-md border border-border bg-card px-2 py-1 text-sm">{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
          );
          if (f.operator === 'eq' && opts.length) return (
            <div key={f.id}><label htmlFor={`f_${f.id}`} className="mb-1 block text-xs font-medium text-muted">{f.label}</label>
              <Select id={`f_${f.id}`} name={`f_${f.id}`} defaultValue={cur?.value !== undefined ? String(cur.value) : ''} className="w-44"><option value="">Todos</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</Select></div>
          );
          return <div key={f.id}><label htmlFor={`f_${f.id}`} className="mb-1 block text-xs font-medium text-muted">{f.label}</label><Input id={`f_${f.id}`} name={`f_${f.id}`} defaultValue={cur?.value !== undefined ? String(cur.value) : ''} className="w-44" /></div>;
        })}
        <Button type="submit">Aplicar</Button>
        <Link href={`/dashboards/${id}`} className="inline-flex min-h-10 items-center px-2 text-sm text-muted underline underline-offset-2">Limpar</Link>
      </form>

      <p className="mb-3 text-xs text-muted" data-testid="period-note">{hasPeriodWidgets ? `Período aplicado: ${printNote} (datas inclusivas, fuso ${p.tz}).` : 'Os widgets deste dashboard não dependem de período.'}</p>
      {d.status === 'draft' ? <Alert tone="info">Este dashboard é um rascunho: só quem recebeu acesso o vê. {p.perms.manager ? 'Publique para versionar o layout e controlar a visibilidade.' : 'Peça a um gestor para publicar.'}</Alert> : null}
      {widgets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted">Este dashboard ainda não tem widgets.{canEdit ? <> <Link className="underline" href={`/dashboards/${id}/editar`}>Abrir o editor</Link>.</> : null}</div>
      ) : (
        <DashboardGrid items={widgets.map((w) => ({
          id: w.id, layout: w.layout_json,
          node: <WidgetCard w={w} outcome={view.outcomes.get(w.id) ?? null} extras={{ ...view.extras, goal: view.goals.get(w.id) ?? null }} tz={p.tz} dashboardId={id} />,
        }))} />
      )}
      <p className="mt-4 text-xs text-muted print:block">Gerado em <DateTimeBR value={nowIso()} tz={p.tz} /> · Valores calculados no servidor a partir da versão ativa de cada dataset.</p>
    </>
  );
}
