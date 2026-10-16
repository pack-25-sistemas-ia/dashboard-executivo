'use server';

import { z } from 'zod';
import type { Context } from '@/lib/auth/session';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { BiError, isTemporal, type Filter } from '../engine';
import { bustBi, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import type { ChartBuilder } from '../builder';
import { compileBuilder } from '../compile';
import { loadColumns, loadDataset, loadMetrics, type WidgetRow } from '../data';
import {
  dashCreateSchema, dashSaveSchema, duplicateSchema, favoriteSchema, idSchema, publishDashSchema, restoreSchema, revokeSchema, shareSchema, uuid, widgetInSchema,
} from '../schemas';
import { planTemplate, templateByKey, type Extras, type Mapping } from '../templates';

type WidgetIn = z.infer<typeof widgetInSchema>;
type DbWidget = { id?: string; widget_type: string; title: string; dataset_id?: string | null; chart_id?: string | null; metric_id?: string | null; query_json?: unknown; display_json: unknown; layout_json: unknown; metric_version?: number | null };

const layoutOf = (w: WidgetIn) => ({ lg: w.layout.lg, ...(w.layout.md ? { md: w.layout.md } : {}), ...(w.layout.sm ? { sm: w.layout.sm } : {}) });

async function firstTimeColumn(ctx: Context, datasetId: string): Promise<string | null> {
  const d = await loadDataset(ctx, datasetId);
  if (!d?.current_version_id) return null;
  const cols = await loadColumns(ctx, d.current_version_id);
  return (cols.find((c) => isTemporal(c.data_type) && c.semantic_type === 'time') ?? cols.find((c) => isTemporal(c.data_type)))?.column_key ?? null;
}

/** Converte o que o editor envia (configuração, nunca SQL) no widget que o banco guarda e valida. */
async function toDbWidget(ctx: Context, w: WidgetIn, existing: Map<string, WidgetRow>): Promise<DbWidget> {
  const base = { ...(w.id ? { id: w.id } : {}), title: w.title, layout_json: layoutOf(w) };
  if (w.keep && w.id && existing.has(w.id)) {
    const e = existing.get(w.id)!;
    return { ...base, widget_type: e.widget_type, dataset_id: e.dataset_id, chart_id: e.chart_id, metric_id: e.metric_id, query_json: e.query_json, display_json: e.display_json, metric_version: e.metric_version };
  }
  if (w.kind === 'text') return { ...base, widget_type: 'text', display_json: { kind: 'text', text: w.text ?? '' } };
  if (w.kind === 'freshness' || w.kind === 'alert') return { ...base, widget_type: w.kind, display_json: { kind: w.kind } };
  let b: ChartBuilder;
  let type: string;
  let extra: Record<string, unknown> = {};
  if (w.kind === 'goal') {
    if (!w.goal_id) throw new BiError('no_goal', 'Escolha a meta do widget.');
    const { data: g } = await ctx.supabase.from('goal_definitions').select('id, metric_id, name, scope_json').eq('id', w.goal_id).maybeSingle();
    if (!g) throw new BiError('no_goal', 'Meta não encontrada ou sem permissão.');
    const { data: m } = await ctx.supabase.from('metric_definitions').select('dataset_id').eq('id', (g as { metric_id: string }).metric_id).maybeSingle();
    const dsId = (m as { dataset_id: string } | null)?.dataset_id;
    if (!dsId) throw new BiError('no_metric', 'Indicador da meta não encontrado.');
    const pf = await firstTimeColumn(ctx, dsId);
    if (!pf) throw new BiError('no_period', 'O dataset da meta não tem coluna de data para o período.');
    b = { dataset_id: dsId, chart: 'kpi', metric_ids: [(g as { metric_id: string }).metric_id], dims: [], filters: ((g as { scope_json: Filter[] }).scope_json ?? []) as Filter[], period_field: pf, title: w.title };
    type = 'goal';
    extra = { goalId: w.goal_id };
  } else {
    if (!w.builder) throw new BiError('no_builder', 'Configure o gráfico antes de salvar.');
    b = { dataset_id: w.builder.dataset_id, chart: w.builder.chart, metric_ids: w.builder.metric_ids, dims: w.builder.dims, filters: w.builder.filters as Filter[], period_field: w.builder.period_field, title: w.title };
    type = w.builder.chart === 'kpi' ? (w.comparison ? 'comparison' : 'kpi') : w.builder.chart === 'table' ? 'table' : 'chart';
  }
  const c = await compileBuilder(ctx, b);
  return { ...base, widget_type: type, dataset_id: c.dataset.id, chart_id: w.chart_id ?? null, metric_id: c.metric_id, metric_version: c.metric_version, query_json: c.query_json, display_json: { ...c.display_json, ...extra, ...(w.comparison ? { comparison: true } : {}) } };
}

export async function createDashboard(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(dashCreateSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'createDashboard', async (ctx, org) => {
    const { data, error } = await ctx.supabase.rpc('bi_create_dashboard', { p_org: org, p_name: p.data.name, p_description: p.data.description, p_template: p.data.template ?? null });
    if (error) return fail(dbMessage(error, 'Já existe um dashboard com este nome.'), undefined, raw);
    bustBi();
    return { ...succeed('Dashboard criado. Adicione widgets no editor.'), id: data as string, redirectTo: `/dashboards/${data as string}/editar` };
  });
}

export type SaveDashResult = ActionState & { rowVersion?: number; widgetIds?: string[] };
export async function saveDashboard(_: ActionState, fd: FormData): Promise<SaveDashResult> {
  const raw = formObject(fd);
  const p = parse(dashSaveSchema, raw, undefined);
  if (!p.ok) return p.state;
  return guarded('operator', 'saveDashboard', async (ctx, org) => {
    const v = p.data;
    const { data: ex } = await ctx.supabase.from('dashboard_widgets').select('id, dashboard_id, dataset_id, chart_id, metric_id, widget_type, title, query_json, display_json, layout_json, metric_version').eq('dashboard_id', v.id);
    const existing = new Map(((ex ?? []) as WidgetRow[]).map((w) => [w.id, w]));
    let widgets: DbWidget[];
    try {
      widgets = [];
      for (const w of v.widgets as WidgetIn[]) widgets.push(await toDbWidget(ctx, w, existing));
    } catch (e) {
      if (e instanceof BiError) return fail(e.message);
      throw e;
    }
    const { data, error } = await ctx.supabase.rpc('bi_save_dashboard', {
      p_org: org, p_id: v.id, p_expected: v.expected, p_name: v.name, p_description: v.description, p_default_period: v.default_period, p_comparison: v.comparison, p_partial_basis: v.partial_basis,
      p_widgets: widgets, p_filters: v.filters,
    });
    if (error) {
      if (error.code === '40001') return { ...fail('Outra pessoa alterou este dashboard enquanto você editava. Suas mudanças NÃO foram salvas — recarregue a página para ver a versão mais recente e refazer.'), values: undefined };
      return fail(dbMessage(error, 'Já existe um dashboard com este nome.'));
    }
    bustBi();
    const r = data as { row_version: number; widget_ids: string[] };
    return { ...succeed('Alterações salvas.'), rowVersion: r.row_version, widgetIds: r.widget_ids };
  });
}

export async function publishDashboard(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(publishDashSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'publishDashboard', async (ctx, org) => {
    const { data, error } = await ctx.supabase.rpc('bi_publish_dashboard', { p_org: org, p_id: p.data.id, p_visibility: p.data.visibility });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed(`Dashboard publicado (versão ${(data as { version: number }).version}) — ${p.data.visibility === 'organization' ? 'visível a toda a empresa' : 'visível só a quem recebeu acesso'}.`);
  });
}

export async function unpublishDashboard(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'unpublishDashboard', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_unpublish_dashboard', { p_org: org, p_id: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Dashboard voltou a rascunho privado.');
  });
}

export async function restoreDashboardVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(restoreSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'restoreDashboardVersion', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_restore_dashboard_version', { p_org: org, p_id: p.data.id, p_version: p.data.version, p_expected: p.data.expected });
    if (error) return fail(error.code === '40001' ? 'O dashboard mudou enquanto você olhava. Recarregue e tente de novo.' : dbMessage(error), undefined, raw);
    bustBi();
    return succeed(`Layout da versão ${p.data.version} restaurado (como rascunho).`);
  });
}

export async function duplicateDashboard(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(duplicateSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'duplicateDashboard', async (ctx, org) => {
    const { data, error } = await ctx.supabase.rpc('bi_duplicate_dashboard', { p_org: org, p_id: p.data.id, p_name: p.data.name });
    if (error) return fail(dbMessage(error, 'Já existe um dashboard com este nome.'), undefined, raw);
    bustBi();
    return { ...succeed('Cópia criada como rascunho privado.'), id: data as string, redirectTo: `/dashboards/${data as string}/editar` };
  });
}

export async function archiveDashboard(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'archiveDashboard', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_archive_dashboard', { p_org: org, p_id: p.data.id, p_archive: true });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return { ...succeed('Dashboard arquivado.'), redirectTo: '/dashboards' };
  });
}

export async function setFavorite(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(favoriteSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('read', 'setFavorite', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_set_favorite', { p_org: org, p_id: p.data.id, p_on: p.data.on });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed(p.data.on ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
  });
}

export async function shareDashboard(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(shareSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'shareDashboard', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_share_dashboard', { p_org: org, p_id: p.data.dashboard_id, p_user: p.data.user_id, p_level: p.data.level });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Acesso concedido.');
  });
}

export async function revokeDashboard(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(revokeSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'revokeDashboard', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_revoke_dashboard', { p_org: org, p_id: p.data.dashboard_id, p_user: p.data.user_id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Acesso revogado (vale na próxima consulta).');
  });
}

// ----------------------------------------------------------------------------- modelos
const applySchema = z.object({
  template: z.string().max(40), dataset_id: uuid, name: z.string().trim().min(1).max(80),
  mapping: z.string().transform((s, c) => { try { return JSON.parse(s) as Mapping; } catch { c.addIssue({ code: 'custom', message: 'Mapeamento inválido.' }); return z.NEVER; } }),
  extras: z.string().optional().transform((s) => { try { return (s ? JSON.parse(s) : {}) as Extras; } catch { return {} as Extras; } }),
  metric_ids: z.string().optional().transform((s) => { try { return (s ? JSON.parse(s) : []) as string[]; } catch { return [] as string[]; } }),
});

export async function applyTemplate(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(applySchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'applyTemplate', async (ctx, org) => {
    const spec = templateByKey(p.data.template);
    if (!spec) return fail('Modelo não encontrado.');
    const map = p.data.mapping;
    const ds = await loadDataset(ctx, p.data.dataset_id);
    if (!ds?.current_version_id) return fail('Escolha um dataset com dados publicados.');
    const cols = await loadColumns(ctx, ds.current_version_id);
    const colByKey = new Map(cols.map((c) => [c.column_key, c]));
    for (const r of spec.roles) {
      const k = map[r.key];
      if (!k) continue;
      const c = colByKey.get(k);
      if (!c || !r.types.includes(c.data_type)) return fail(`A coluna escolhida para «${r.label}» não é de um tipo compatível.`);
    }
    try {
      const { data: dId, error: de } = await ctx.supabase.rpc('bi_create_dashboard', { p_org: org, p_name: p.data.name, p_description: spec.description, p_template: spec.key });
      if (de) return fail(dbMessage(de, 'Já existe um dashboard com este nome.'), undefined, raw);
      const dashId = dId as string;
      const dateKey = map.date as string;
      const widgets: Array<Record<string, unknown>> = [];
      let y = 0; let x = 0;
      const place = (w: number, h: number) => { if (x + w > 12) { x = 0; y += 6; } const pos = { x, y, w, h }; x += w; return { lg: pos }; };

      if (spec.key === 'executivo') {
        const metricIds = p.data.metric_ids.slice(0, 8);
        if (!metricIds.length) { await ctx.supabase.rpc('bi_archive_dashboard', { p_org: org, p_id: dashId, p_archive: true }); return fail('Escolha ao menos um indicador para o painel executivo.'); }
        const all = await loadMetrics(ctx, ds.id);
        for (const mid of metricIds) {
          const m = all.find((a) => a.id === mid);
          if (!m) continue;
          widgets.push({ kind: 'chart', title: m.name, layout: place(3, 3), comparison: true, builder: { dataset_id: ds.id, chart: 'kpi', metric_ids: [mid], dims: [], filters: [], period_field: dateKey, title: m.name } });
        }
        widgets.push({ kind: 'freshness', title: 'Atualização dos dados', layout: place(6, 3) });
        widgets.push({ kind: 'alert', title: 'Avisos', layout: place(6, 3) });
      } else {
        const plan = planTemplate(spec, map, p.data.extras);
        if (plan.missingRequired.length) { await ctx.supabase.rpc('bi_archive_dashboard', { p_org: org, p_id: dashId, p_archive: true }); return fail(`Este modelo precisa de: ${plan.missingRequired.join(', ')}. Sem esses campos ele é incompatível com o dataset.`); }
        if (plan.needExtras.length) { await ctx.supabase.rpc('bi_archive_dashboard', { p_org: org, p_id: dashId, p_archive: true }); return fail(`Informe: ${plan.needExtras.join('; ')}.`); }
        const ids: Record<string, string> = {};
        const existingMetrics = await loadMetrics(ctx, ds.id);
        for (const m of plan.metrics) {
          const found = existingMetrics.find((e) => e.name.toLowerCase() === m.name.toLowerCase() && e.status === 'active');
          if (found) { ids[m.key] = found.id; continue; }
          const step = m.step;
          const field = step.kind === 'agg' && step.role ? map[step.role] ?? null : null;
          const filters = step.kind === 'agg' && step.filters ? step.filters(map, p.data.extras) : [];
          const ast = step.kind === 'formula' ? step.ast((k) => ids[k]!) : null;
          const { data, error } = await ctx.supabase.rpc('bi_save_metric', {
            p_org: org, p_id: null, p_dataset: ds.id, p_name: m.name, p_description: m.description ?? null, p_type: step.kind === 'agg' ? 'aggregation' : 'formula', p_agg: step.kind === 'agg' ? step.agg : null,
            p_field: field, p_ast: ast, p_filters: filters, p_format: m.format, p_unit: null,
          });
          if (error) throw new Error(dbMessage(error));
          ids[m.key] = (data as { id: string }).id;
        }
        for (const w of plan.widgets) {
          const dim = w.dim ? { field: map[w.dim.role] as string, ...(w.dim.grain ? { grain: w.dim.grain } : {}) } : null;
          widgets.push({ kind: 'chart', title: w.title, layout: place(w.w, w.h), comparison: w.comparison ?? false,
            builder: { dataset_id: ds.id, chart: w.chart, metric_ids: w.metrics.map((k) => ids[k]), dims: dim ? [dim] : [], filters: [], period_field: w.period ? (map[w.period] as string) : null, title: w.title } });
        }
        if (plan.skipped.length) widgets.push({ kind: 'text', title: 'Itens não montados', layout: place(12, 2), text: `Faltam campos para: ${plan.skipped.join(', ')}. Edite o dashboard para adicioná-los depois.` });
      }
      if (spec.disclaimer) widgets.push({ kind: 'text', title: 'Observação', layout: place(12, 2), text: spec.disclaimer });
      const parsed = z.array(widgetInSchema).safeParse(widgets);
      if (!parsed.success) throw new Error('Modelo gerou uma configuração inválida.');
      const db: DbWidget[] = [];
      for (const w of parsed.data) db.push(await toDbWidget(ctx, w, new Map()));
      const { error } = await ctx.supabase.rpc('bi_save_dashboard', { p_org: org, p_id: dashId, p_expected: 1, p_name: p.data.name, p_description: spec.description, p_default_period: 'last_30', p_comparison: 'previous_period', p_partial_basis: 'same_days', p_widgets: db, p_filters: [] });
      if (error) throw new Error(dbMessage(error));
      bustBi();
      return { ...succeed('Dashboard criado a partir do modelo. Ele é seu: edite, mova e remova widgets à vontade.'), id: dashId, redirectTo: `/dashboards/${dashId}/editar` };
    } catch (e) {
      if (e instanceof BiError) return fail(e.message, undefined, raw);
      if (e instanceof Error && e.message) return fail(e.message, undefined, raw);
      throw e;
    }
  });
}

