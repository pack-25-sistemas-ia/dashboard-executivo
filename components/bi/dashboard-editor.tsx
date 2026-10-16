'use client';

import 'react-grid-layout/css/styles.css';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { GridLayout, useContainerWidth, type Layout } from 'react-grid-layout';
import { Alert, Badge, Button, Input, Select, Textarea } from '@/components/ui/primitives';
import { CHART_LABEL, CHART_TYPES, COMPARISON_LABEL, COMPARISONS, GRAINS, PRESETS, PRESET_LABEL, checkChart, isTemporal, operatorsFor, OP_LABEL, type ChartType, type DataType, type Filter, type FilterOp, type Grain } from '@/lib/bi/engine';
import { setFilterValue, filterText } from '@/lib/bi/filter-edit';
import { saveDashboard } from '@/lib/bi/actions/dashboards';
import type { ChartBuilder } from '@/lib/bi/builder';
import { pushFlash } from './flash';

export type EdColumn = { key: string; name: string; type: DataType };
export type EdMetric = { id: string; name: string; format: string; additive: boolean; status: string; version: number };
export type EdDataset = { id: string; name: string; columns: EdColumn[]; metrics: EdMetric[] };
export type EdWidget = {
  id: string | null; uid: string; kind: 'chart' | 'text' | 'goal' | 'freshness' | 'alert'; title: string; x: number; y: number; w: number; h: number;
  builder?: ChartBuilder; text?: string; goalId?: string; comparison?: boolean; keep: boolean; summary: string; outdated?: boolean;
};
export type EdFilter = { id: string | null; uid: string; dataset_id: string; field_key: string; label: string; operator: 'eq' | 'in' | 'between' | 'contains' };
export type EdInitial = { id: string; name: string; description: string; rowVersion: number; defaultPeriod: string; comparison: string; partialBasis: string; status: string; widgets: EdWidget[]; filters: EdFilter[] };

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`);
const KIND_LABEL: Record<EdWidget['kind'], string> = { chart: 'Gráfico / indicador', text: 'Texto', goal: 'Meta', freshness: 'Última atualização', alert: 'Avisos' };

function summarize(w: EdWidget, datasets: EdDataset[]): string {
  if (w.kind !== 'chart' || !w.builder) return KIND_LABEL[w.kind];
  const ds = datasets.find((d) => d.id === w.builder!.dataset_id);
  const names = w.builder.metric_ids.map((id) => ds?.metrics.find((m) => m.id === id)?.name ?? '?').join(', ');
  return `${CHART_LABEL[w.builder.chart]} · ${names}${ds ? ` · ${ds.name}` : ''}`;
}

export function DashboardEditor({ initial, datasets, goals, canGoals }: { initial: EdInitial; datasets: EdDataset[]; goals: Array<{ id: string; name: string }>; canGoals: boolean }) {
  const [pending, startTransition] = useTransition();
  const { width, containerRef, mounted } = useContainerWidth();
  const [meta, setMeta] = useState({ name: initial.name, description: initial.description, defaultPeriod: initial.defaultPeriod, comparison: initial.comparison, partialBasis: initial.partialBasis });
  const [widgets, setWidgets] = useState<EdWidget[]>(initial.widgets);
  const [filters, setFilters] = useState<EdFilter[]>(initial.filters);
  const [rowVersion, setRowVersion] = useState(initial.rowVersion);
  const [selected, setSelected] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const history = useRef<Array<{ widgets: EdWidget[]; filters: EdFilter[] }>>([]);
  const saved = useRef({ widgets: initial.widgets, filters: initial.filters, meta });

  const snapshot = useCallback(() => { history.current = [...history.current.slice(-19), { widgets, filters }]; }, [widgets, filters]);
  const change = useCallback((fn: () => void) => { snapshot(); fn(); setDirty(true); setMsg(null); }, [snapshot]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const layout: Layout = useMemo(() => widgets.map((w) => ({ i: w.uid, x: w.x, y: w.y, w: w.w, h: w.h, minW: 2, minH: 2, static: locked })), [widgets, locked]);

  const onLayout = (l: Layout) => {
    const byId = new Map(l.map((it) => [it.i, it]));
    const changed = widgets.some((w) => { const it = byId.get(w.uid); return it && (it.x !== w.x || it.y !== w.y || it.w !== w.w || it.h !== w.h); });
    if (!changed) return;
    change(() => setWidgets((ws) => ws.map((w) => { const it = byId.get(w.uid); return it ? { ...w, x: it.x, y: it.y, w: it.w, h: it.h } : w; })));
  };

  const add = (kind: EdWidget['kind']) => change(() => {
    const y = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    const base: EdWidget = { id: null, uid: uid(), kind, title: KIND_LABEL[kind], x: 0, y, w: kind === 'chart' ? 6 : 4, h: kind === 'chart' ? 4 : 3, keep: false, summary: KIND_LABEL[kind] };
    if (kind === 'text') base.text = 'Escreva aqui uma explicação para quem lê o dashboard.';
    if (kind === 'chart') {
      const ds = datasets[0];
      base.builder = { dataset_id: ds?.id ?? '', chart: 'kpi', metric_ids: ds?.metrics.find((m) => m.status === 'active') ? [ds.metrics.find((m) => m.status === 'active')!.id] : [], dims: [], filters: [], period_field: ds?.columns.find((c) => isTemporal(c.type))?.key ?? null, title: '' };
      base.title = 'Novo indicador';
    }
    setWidgets((ws) => [...ws, base]);
    setSelected(base.uid);
  });
  // título e posição não mudam a consulta: o widget continua «travado» na versão salva do indicador; só conteúdo (gráfico, texto, meta) recompila ao salvar
  const patch = (id: string, p: Partial<EdWidget>) => change(() => setWidgets((ws) => ws.map((w) => {
    if (w.uid !== id) return w;
    const content = 'builder' in p || 'text' in p || 'goalId' in p || 'comparison' in p;
    const next = { ...w, ...p };
    next.x = Math.min(next.x, 12 - next.w);
    return { ...next, keep: content ? false : w.keep, summary: summarize(next, datasets) };
  })));
  const remove = (id: string) => change(() => { setWidgets((ws) => ws.filter((w) => w.uid !== id)); if (selected === id) setSelected(null); });
  const duplicate = (id: string) => change(() => setWidgets((ws) => { const w = ws.find((x) => x.uid === id); if (!w) return ws; return [...ws, { ...w, id: null, uid: uid(), y: w.y + w.h, title: `${w.title} (cópia)`, keep: false }]; }));
  const undo = () => { const h = history.current.pop(); if (!h) return; setWidgets(h.widgets); setFilters(h.filters); setDirty(true); };
  const discard = () => { setWidgets(saved.current.widgets); setFilters(saved.current.filters); setMeta(saved.current.meta); history.current = []; setDirty(false); setMsg(null); setSelected(null); };

  function save() {
    const fd = new FormData();
    fd.set('id', initial.id); fd.set('expected', String(rowVersion)); fd.set('name', meta.name); fd.set('description', meta.description);
    fd.set('default_period', meta.defaultPeriod); fd.set('comparison', meta.comparison); fd.set('partial_basis', meta.partialBasis);
    fd.set('widgets', JSON.stringify(widgets.map((w) => ({
      id: w.id, kind: w.kind, title: w.title, layout: { lg: { x: w.x, y: w.y, w: w.w, h: w.h } }, keep: w.keep && w.id !== null, comparison: w.comparison ?? false,
      ...(w.kind === 'chart' ? { builder: { ...w.builder, title: w.title } } : {}), ...(w.kind === 'text' ? { text: w.text ?? '' } : {}), ...(w.kind === 'goal' ? { goal_id: w.goalId } : {}),
    }))));
    fd.set('filters', JSON.stringify(filters.map((f) => ({ id: f.id, dataset_id: f.dataset_id, field_key: f.field_key, label: f.label, operator: f.operator }))));
    startTransition(async () => {
      const r = await saveDashboard({}, fd);
      if (!r.ok) {
        setMsg({ tone: 'error', text: r.message ?? 'Não foi possível salvar.' });
        setConflict(/Outra pessoa alterou/.test(r.message ?? ''));
        return;
      }
      const ids = r.widgetIds ?? [];
      const next = widgets.map((w, i) => ({ ...w, id: ids[i] ?? w.id, keep: true }));
      setWidgets(next);
      saved.current = { widgets: next, filters, meta };
      setRowVersion(r.rowVersion ?? rowVersion + 1);
      setDirty(false); setConflict(false); history.current = [];
      setMsg({ tone: 'success', text: 'Alterações salvas.' });
      pushFlash('Dashboard salvo.');
    });
  }

  const sel = widgets.find((w) => w.uid === selected) ?? null;

  return (
    <div className="space-y-4" data-testid="dashboard-editor">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3" role="toolbar" aria-label="Ferramentas do editor">
        <Button type="button" onClick={() => add('chart')} disabled={datasets.length === 0}>+ Gráfico / KPI</Button>
        <Button type="button" variant="secondary" onClick={() => add('text')}>+ Texto</Button>
        {canGoals ? <Button type="button" variant="secondary" onClick={() => add('goal')} disabled={goals.length === 0}>+ Meta</Button> : null}
        <Button type="button" variant="secondary" onClick={() => add('freshness')}>+ Atualização</Button>
        <Button type="button" variant="secondary" onClick={() => add('alert')}>+ Avisos</Button>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} className="size-4" /> Bloquear layout</label>
        <Button type="button" variant="secondary" onClick={undo} disabled={!dirty}>Desfazer</Button>
        <Button type="button" variant="secondary" onClick={discard} disabled={!dirty}>Descartar alterações</Button>
        <span className="flex-1" />
        {dirty ? <Badge tone="warning">Alterações não salvas</Badge> : <Badge tone="success">Tudo salvo</Badge>}
        <Button type="button" onClick={save} disabled={pending || !dirty}>{pending ? 'Salvando…' : 'Salvar'}</Button>
        <Link href={`/dashboards/${initial.id}`} className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-medium">Ver dashboard</Link>
      </div>

      {msg ? <Alert tone={msg.tone}>{msg.text}{conflict ? <> <a className="underline" href={`/dashboards/${initial.id}/editar`}>Recarregar a versão mais recente</a></> : null}</Alert> : null}
      {datasets.length === 0 ? <Alert tone="warning">Nenhum dataset com dados publicados está disponível para você. Importe um arquivo para criar gráficos.</Alert> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div ref={containerRef} className="min-w-0 rounded-lg border border-dashed border-border bg-background/50 p-2" aria-label="Área do dashboard" data-testid="editor-canvas">
          {mounted ? (
            <GridLayout width={width} layout={layout} gridConfig={{ cols: 12, rowHeight: 64, margin: [16, 16], containerPadding: [0, 0] }} dragConfig={{ enabled: !locked, handle: '.drag-handle' }} resizeConfig={{ enabled: !locked }} onLayoutChange={onLayout}>
              {widgets.map((w) => (
                <div key={w.uid} data-testid="editor-widget" className={`flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm ${w.uid === selected ? 'border-primary ring-2 ring-primary' : 'border-border'}`}>
                  <div className="drag-handle flex cursor-grab items-center justify-between gap-2 border-b border-border px-3 py-2 active:cursor-grabbing">
                    <span className="truncate text-sm font-semibold" title={w.title}>{w.title || '(sem título)'}</span>
                    <span className="flex shrink-0 gap-1">
                      <button type="button" className="rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5" onMouseDown={(e) => e.stopPropagation()} onClick={() => setSelected(w.uid)}>Configurar</button>
                      <button type="button" className="rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5" onMouseDown={(e) => e.stopPropagation()} onClick={() => duplicate(w.uid)} aria-label={`Duplicar ${w.title}`}>Duplicar</button>
                      <button type="button" className="rounded px-2 py-1 text-xs text-danger hover:bg-black/5 dark:hover:bg-white/5" onMouseDown={(e) => e.stopPropagation()} onClick={() => remove(w.uid)} aria-label={`Remover ${w.title}`}>Remover</button>
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden p-3 text-xs text-muted">
                    <p>{w.summary}</p>
                    {w.outdated ? <p className="mt-1 text-warning">Há versão mais nova de um indicador usado aqui.</p> : null}
                    {w.keep && w.id ? <p className="mt-1">Salvo (consulta e fórmula travadas na versão usada).</p> : <p className="mt-1">Será validado ao salvar.</p>}
                  </div>
                </div>
              ))}
            </GridLayout>
          ) : <div className="h-40 animate-pulse rounded-lg bg-black/10 dark:bg-white/10" role="status"><span className="sr-only">Carregando editor…</span></div>}
          {widgets.length === 0 && mounted ? <p className="py-10 text-center text-sm text-muted">Dashboard vazio. Use «+ Gráfico / KPI» para começar.</p> : null}
        </div>

        <aside className="space-y-4" aria-label="Configuração">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Dashboard</h2>
            <div className="mt-3 space-y-3">
              <div><label htmlFor="ed-name" className="mb-1 block text-xs font-medium text-muted">Nome</label><Input id="ed-name" value={meta.name} maxLength={80} onChange={(e) => change(() => setMeta({ ...meta, name: e.target.value }))} /></div>
              <div><label htmlFor="ed-desc" className="mb-1 block text-xs font-medium text-muted">Descrição</label><Textarea id="ed-desc" rows={2} maxLength={500} value={meta.description} onChange={(e) => change(() => setMeta({ ...meta, description: e.target.value }))} /></div>
              <div><label htmlFor="ed-per" className="mb-1 block text-xs font-medium text-muted">Período padrão</label>
                <Select id="ed-per" value={meta.defaultPeriod} onChange={(e) => change(() => setMeta({ ...meta, defaultPeriod: e.target.value }))}>{PRESETS.filter((p) => p !== 'custom').map((p) => <option key={p} value={p}>{PRESET_LABEL[p]}</option>)}</Select></div>
              <div><label htmlFor="ed-cmp" className="mb-1 block text-xs font-medium text-muted">Comparação padrão</label>
                <Select id="ed-cmp" value={meta.comparison} onChange={(e) => change(() => setMeta({ ...meta, comparison: e.target.value }))}>{COMPARISONS.map((c) => <option key={c} value={c}>{COMPARISON_LABEL[c]}</option>)}</Select></div>
              <div><label htmlFor="ed-pb" className="mb-1 block text-xs font-medium text-muted">Mês em andamento: comparar com…</label>
                <Select id="ed-pb" value={meta.partialBasis} onChange={(e) => change(() => setMeta({ ...meta, partialBasis: e.target.value }))}><option value="same_days">o mesmo número de dias do mês anterior</option><option value="full">o mês anterior completo</option></Select></div>
            </div>
          </section>

          <FiltersPanel filters={filters} datasets={datasets} onChange={(f) => change(() => setFilters(f))} />

          {sel ? <WidgetPanel key={sel.uid} w={sel} datasets={datasets} goals={goals} onPatch={(p) => patch(sel.uid, p)} onClose={() => setSelected(null)} /> : <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">Clique em «Configurar» em um widget para editar o conteúdo, o título e a posição.</p>}
        </aside>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- filtros globais
function FiltersPanel({ filters, datasets, onChange }: { filters: EdFilter[]; datasets: EdDataset[]; onChange: (f: EdFilter[]) => void }) {
  const candidates = datasets.flatMap((d) => d.columns.filter((c) => c.type !== 'boolean').map((c) => ({ dataset: d, col: c })));
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Filtros do dashboard</h2>
      <p className="mt-1 text-xs text-muted">Aparecem acima dos widgets e valem para todos os widgets do mesmo dataset.</p>
      <ul className="mt-3 space-y-2">
        {filters.map((f, i) => (
          <li key={f.uid} className="rounded-md border border-border p-2 text-sm">
            <div className="flex items-center justify-between gap-2"><strong className="truncate">{f.label}</strong><button type="button" className="text-xs text-danger underline" onClick={() => onChange(filters.filter((_, j) => j !== i))}>Remover</button></div>
            <p className="text-xs text-muted">{OP_LABEL[f.operator === 'in' ? 'in' : f.operator]} · {datasets.find((d) => d.id === f.dataset_id)?.name}</p>
          </li>
        ))}
      </ul>
      {filters.length < 8 && candidates.length ? <AddFilter candidates={candidates} onAdd={(f) => onChange([...filters, f])} /> : null}
    </section>
  );
}
function AddFilter({ candidates, onAdd }: { candidates: Array<{ dataset: EdDataset; col: EdColumn }>; onAdd: (f: EdFilter) => void }) {
  const [sel, setSel] = useState(0);
  const [op, setOp] = useState<EdFilter['operator']>('eq');
  const cur = candidates[sel];
  const ops: EdFilter['operator'][] = cur ? (operatorsFor(cur.col.type).filter((o) => o === 'eq' || o === 'in' || o === 'between' || o === 'contains') as EdFilter['operator'][]) : ['eq'];
  const okOp = ops.includes(op) ? op : ops[0]!;
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <label htmlFor="af-col" className="block text-xs font-medium text-muted">Adicionar filtro por…</label>
      <Select id="af-col" value={sel} onChange={(e) => setSel(Number(e.target.value))}>{candidates.map((c, i) => <option key={i} value={i}>{c.col.name} — {c.dataset.name}</option>)}</Select>
      <label htmlFor="af-op" className="block text-xs font-medium text-muted">Tipo de filtro</label>
      <Select id="af-op" value={okOp} onChange={(e) => setOp(e.target.value as EdFilter['operator'])}>{ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</Select>
      <Button type="button" variant="secondary" onClick={() => cur && onAdd({ id: null, uid: uid(), dataset_id: cur.dataset.id, field_key: cur.col.key, label: cur.col.name, operator: okOp })}>Adicionar filtro</Button>
    </div>
  );
}

// ----------------------------------------------------------------------------- painel do widget
function WidgetPanel({ w, datasets, goals, onPatch, onClose }: { w: EdWidget; datasets: EdDataset[]; goals: Array<{ id: string; name: string }>; onPatch: (p: Partial<EdWidget>) => void; onClose: () => void }) {
  const b = w.builder;
  const ds = datasets.find((d) => d.id === b?.dataset_id);
  const setB = (p: Partial<ChartBuilder>) => b && onPatch({ builder: { ...b, ...p } });
  const metricsAvail = (ds?.metrics ?? []).filter((m) => m.status === 'active');
  const verdict = b && ds ? checkChart({
    type: b.chart, measures: b.metric_ids.map((id) => ({ additive: ds.metrics.find((m) => m.id === id)?.additive ?? false })),
    dimensions: b.dims.map((d) => ({ type: ds.columns.find((c) => c.key === d.field)?.type ?? 'string', ...(d.grain ? { grain: d.grain } : {}) })),
  }) : null;
  return (
    <section className="rounded-lg border border-primary bg-card p-4" aria-label={`Configuração de ${w.title}`}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Configurar widget</h2><button type="button" className="text-xs underline" onClick={onClose}>Fechar</button></div>
      <div className="mt-3 space-y-3">
        <div><label htmlFor="wp-title" className="mb-1 block text-xs font-medium text-muted">Título</label><Input id="wp-title" value={w.title} maxLength={120} onChange={(e) => onPatch({ title: e.target.value })} /></div>

        {w.kind === 'text' ? <div><label htmlFor="wp-text" className="mb-1 block text-xs font-medium text-muted">Texto (sem formatação)</label><Textarea id="wp-text" rows={4} maxLength={2000} value={w.text ?? ''} onChange={(e) => onPatch({ text: e.target.value })} /></div> : null}

        {w.kind === 'goal' ? (
          <div><label htmlFor="wp-goal" className="mb-1 block text-xs font-medium text-muted">Meta</label>
            <Select id="wp-goal" value={w.goalId ?? ''} onChange={(e) => onPatch({ goalId: e.target.value })}><option value="">Escolha…</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
            <p className="mt-1 text-xs text-muted">O período e o alvo seguem a definição da meta.</p></div>
        ) : null}

        {w.kind === 'chart' && b ? (
          <>
            <div><label htmlFor="wp-ds" className="mb-1 block text-xs font-medium text-muted">Dataset</label>
              <Select id="wp-ds" value={b.dataset_id} onChange={(e) => { const d = datasets.find((x) => x.id === e.target.value); setB({ dataset_id: e.target.value, metric_ids: [], dims: [], filters: [], period_field: d?.columns.find((c) => isTemporal(c.type))?.key ?? null }); }}>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
            <div><label htmlFor="wp-type" className="mb-1 block text-xs font-medium text-muted">Tipo de gráfico</label>
              <Select id="wp-type" value={b.chart} onChange={(e) => setB({ chart: e.target.value as ChartType })}>{CHART_TYPES.map((t) => <option key={t} value={t}>{CHART_LABEL[t]}</option>)}</Select></div>
            <fieldset><legend className="mb-1 text-xs font-medium text-muted">Indicadores</legend>
              {metricsAvail.length === 0 ? <p className="text-xs text-muted">Este dataset ainda não tem indicadores ativos. <Link className="underline" href="/indicadores/novo">Criar indicador</Link>.</p> : null}
              <ul className="space-y-1">{metricsAvail.map((m) => (
                <li key={m.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={b.metric_ids.includes(m.id)} onChange={(e) => setB({ metric_ids: e.target.checked ? [...b.metric_ids, m.id] : b.metric_ids.filter((x) => x !== m.id) })} /> {m.name}{m.additive ? '' : <span className="text-xs text-muted"> (não somável)</span>}</label></li>
              ))}</ul></fieldset>
            <fieldset><legend className="mb-1 text-xs font-medium text-muted">Agrupar por (dimensões, até 2)</legend>
              {b.dims.map((d, i) => {
                const col = ds?.columns.find((c) => c.key === d.field);
                return (
                  <div key={i} className="mb-2 flex gap-2">
                    <Select aria-label={`Dimensão ${i + 1}`} value={d.field} onChange={(e) => { const c = ds?.columns.find((x) => x.key === e.target.value); setB({ dims: b.dims.map((x, j) => (j === i ? { field: e.target.value, ...(c && isTemporal(c.type) ? { grain: 'month' as Grain } : {}) } : x)) }); }}>{ds?.columns.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select>
                    {col && isTemporal(col.type) ? <Select aria-label={`Granularidade da dimensão ${i + 1}`} value={d.grain ?? 'month'} onChange={(e) => setB({ dims: b.dims.map((x, j) => (j === i ? { ...x, grain: e.target.value as Grain } : x)) })}>{GRAINS.map((g) => <option key={g} value={g}>{{ day: 'Dia', week: 'Semana', month: 'Mês', quarter: 'Trimestre', year: 'Ano' }[g]}</option>)}</Select> : null}
                    <button type="button" className="text-xs text-danger underline" onClick={() => setB({ dims: b.dims.filter((_, j) => j !== i) })}>Tirar</button>
                  </div>
                );
              })}
              {b.dims.length < 2 && ds ? <Button type="button" variant="secondary" onClick={() => { const c = ds.columns[0]; if (c) setB({ dims: [...b.dims, { field: c.key, ...(isTemporal(c.type) ? { grain: 'month' as Grain } : {}) }] }); }}>+ Dimensão</Button> : null}
            </fieldset>
            <div><label htmlFor="wp-per" className="mb-1 block text-xs font-medium text-muted">Coluna de data para o período do dashboard</label>
              <Select id="wp-per" value={b.period_field ?? ''} onChange={(e) => setB({ period_field: e.target.value || null })}><option value="">Sem período (usa todos os dados)</option>{ds?.columns.filter((c) => isTemporal(c.type)).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select></div>
            {b.chart === 'kpi' ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={w.comparison ?? false} onChange={(e) => onPatch({ comparison: e.target.checked })} /> Mostrar variação vs. período de comparação</label> : null}
            <FilterRows ds={ds} filters={b.filters} onChange={(f) => setB({ filters: f })} />
            {verdict && !verdict.ok ? <Alert tone="error">{verdict.error}</Alert> : verdict && verdict.warnings.length ? <Alert tone="info">{verdict.warnings.join(' ')}</Alert> : null}
          </>
        ) : null}

        <PositionFields w={w} onPatch={onPatch} />
      </div>
    </section>
  );
}

function FilterRows({ ds, filters, onChange }: { ds: EdDataset | undefined; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  if (!ds) return null;
  return (
    <fieldset><legend className="mb-1 text-xs font-medium text-muted">Filtros próprios do widget</legend>
      {filters.map((f, i) => {
        const col = ds.columns.find((c) => c.key === f.field);
        const ops = col ? operatorsFor(col.type) : [];
        const needsValue = f.op !== 'empty' && f.op !== 'not_empty';
        return (
          <div key={i} className="mb-2 space-y-1 rounded-md border border-border p-2">
            <Select aria-label={`Coluna do filtro ${i + 1}`} value={f.field} onChange={(e) => { const c = ds.columns.find((x) => x.key === e.target.value)!; onChange(filters.map((x, j) => (j === i ? { field: c.key, op: 'eq', value: '' } : x))); }}>{ds.columns.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select>
            <Select aria-label={`Operador do filtro ${i + 1}`} value={f.op} onChange={(e) => onChange(filters.map((x, j) => (j === i ? { field: x.field, op: e.target.value as FilterOp, value: '' } : x)))}>{ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</Select>
            {needsValue ? (
              <Input aria-label={`Valor do filtro ${i + 1}`} value={filterText(f)} placeholder={col && (col.type === 'date' || col.type === 'timestamp') ? 'AAAA-MM-DD' : col && ['integer', 'decimal', 'currency', 'percentage'].includes(col.type) ? 'Número com ponto decimal' : 'Valor'}
                onChange={(e) => onChange(setFilterValue(filters, i, e.target.value))} />
            ) : null}
            {f.op === 'between' ? <p className="text-[11px] text-muted">Informe «início|fim» (ex.: 2026-01-01|2026-01-31).</p> : null}
            <button type="button" className="text-xs text-danger underline" onClick={() => onChange(filters.filter((_, j) => j !== i))}>Remover filtro</button>
          </div>
        );
      })}
      {filters.length < 10 ? <Button type="button" variant="secondary" onClick={() => { const c = ds.columns[0]; if (c) onChange([...filters, { field: c.key, op: 'eq', value: '' }]); }}>+ Filtro</Button> : null}
    </fieldset>
  );
}

// posição e tamanho por teclado (alternativa acessível ao arrastar)
function PositionFields({ w, onPatch }: { w: EdWidget; onPatch: (p: Partial<EdWidget>) => void }) {
  const f = (label: string, k: 'x' | 'y' | 'w' | 'h', min: number, max: number) => (
    <div><label htmlFor={`pos-${k}`} className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <Input id={`pos-${k}`} type="number" min={min} max={max} value={w[k]} onChange={(e) => { const v = Math.trunc(Number(e.target.value)); if (Number.isFinite(v)) onPatch({ [k]: Math.min(max, Math.max(min, v)) } as Partial<EdWidget>); }} /></div>
  );
  return (
    <fieldset><legend className="mb-1 text-xs font-medium text-muted">Posição e tamanho (alternativa ao arrastar)</legend>
      <div className="grid grid-cols-4 gap-2">{f('Coluna', 'x', 0, 11)}{f('Linha', 'y', 0, 1000)}{f('Largura', 'w', 2, 12)}{f('Altura', 'h', 2, 30)}</div>
      <p className="mt-1 text-[11px] text-muted">Grade de 12 colunas. Largura + coluna não pode passar de 12.</p>
    </fieldset>
  );
}
