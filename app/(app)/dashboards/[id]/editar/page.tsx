import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { DashboardEditorClient } from '@/components/bi/editor-loader';
import type { EdDataset, EdFilter, EdInitial, EdWidget } from '@/components/bi/dashboard-editor';
import { compileMetric } from '@/lib/bi/engine';
import { loadColumns, loadDashboard, loadDatasets, loadGoals, loadMetrics, metricDefs, toEngineColumns } from '@/lib/bi/data';
import type { ChartBuilder } from '@/lib/bi/builder';
import { pageCtx } from '@/lib/bi/page';
import type { WidgetDisplay } from '@/lib/bi/widgets';

export const metadata: Metadata = { title: 'Editar dashboard' };

export default async function EditDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await pageCtx();
  if (!p.perms.analyst) redirect(`/dashboards/${id}`);
  const data = await loadDashboard(p.ctx, id);
  if (!data) notFound();
  if (data.level === 'view' || data.dashboard.status === 'archived') redirect(`/dashboards/${id}`);
  const { dashboard: d, widgets, filters } = data;

  const datasetRows = (await loadDatasets(p.ctx)).filter((x) => x.status === 'active' && x.current_version_id);
  const allMetrics = await loadMetrics(p.ctx);
  const latest = new Map(allMetrics.map((m) => [m.id, m.current_version]));
  const datasets: EdDataset[] = await Promise.all(datasetRows.map(async (ds) => {
    const colRows = await loadColumns(p.ctx, ds.current_version_id);
    const cols = toEngineColumns(colRows);
    const ms = allMetrics.filter((m) => m.dataset_id === ds.id && m.status !== 'archived');
    const defs = metricDefs(ms);
    return {
      id: ds.id, name: ds.name, columns: cols.map((c) => ({ key: c.key, name: c.name, type: c.type })),
      metrics: ms.map((m) => { let additive = false; try { additive = compileMetric(m.id, defs, cols).additive; } catch { additive = false; } return { id: m.id, name: m.name, format: m.format_type, additive, status: m.status, version: m.current_version }; }),
    };
  }));

  const ed: EdWidget[] = widgets.map((w) => {
    const disp = w.display_json as unknown as WidgetDisplay & { builder?: ChartBuilder; text?: string; goalId?: string; comparison?: boolean };
    const lg = w.layout_json.lg ?? { x: 0, y: 0, w: 6, h: 3 };
    const kind: EdWidget['kind'] = w.widget_type === 'text' ? 'text' : w.widget_type === 'goal' ? 'goal' : w.widget_type === 'freshness' ? 'freshness' : w.widget_type === 'alert' ? 'alert' : 'chart';
    const outdated = (disp.metrics ?? []).some((m) => (latest.get(m.id) ?? m.version) > m.version);
    const names = (disp.metrics ?? []).map((m) => m.name).join(', ');
    return {
      id: w.id, uid: w.id, kind, title: w.title, x: lg.x, y: lg.y, w: lg.w, h: lg.h, keep: true, outdated,
      ...(kind === 'chart' && disp.builder ? { builder: disp.builder } : {}), ...(kind === 'text' ? { text: disp.text ?? '' } : {}), ...(kind === 'goal' ? { goalId: disp.goalId } : {}), ...(disp.comparison ? { comparison: true } : {}),
      summary: kind === 'chart' ? `${disp.chart ?? 'gráfico'} · ${names} · ${disp.datasetName ?? ''}` : kind === 'goal' ? 'Meta' : kind === 'text' ? 'Texto' : kind === 'freshness' ? 'Última atualização' : 'Avisos',
    };
  });
  const edFilters: EdFilter[] = filters.map((f) => ({ id: f.id, uid: f.id, dataset_id: f.dataset_id, field_key: f.field_key, label: f.label, operator: f.operator }));
  const goals = p.perms.manager ? (await loadGoals(p.ctx)).goals.filter((g) => g.status === 'active').map((g) => ({ id: g.id, name: g.name })) : [];
  const initial: EdInitial = { id: d.id, name: d.name, description: d.description ?? '', rowVersion: d.row_version, defaultPeriod: d.default_period, comparison: d.comparison, partialBasis: d.partial_basis, status: d.status, widgets: ed, filters: edFilters };

  return (
    <>
      <PageHeader title={`Editar: ${d.name}`} description="Arraste e redimensione os widgets. Nada vira definitivo até você salvar; se outra pessoa salvar antes, o seu salvamento é recusado em vez de sobrescrever o trabalho dela." />
      <DashboardEditorClient initial={initial} datasets={datasets} goals={goals} canGoals={p.perms.manager} />
    </>
  );
}
