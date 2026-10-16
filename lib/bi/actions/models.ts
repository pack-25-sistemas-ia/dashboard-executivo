'use server';

import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { BiError } from '../engine';
import { bustBi, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { compileBuilder } from '../compile';
import { chartSaveSchema, dimIdSchema, dimensionSchema, idSchema, metricSchema } from '../schemas';

export async function saveMetric(_: ActionState, fd: FormData): Promise<SaveResult> {
  const raw = formObject(fd);
  const p = parse(metricSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'saveMetric', async (ctx, org) => {
    const v = p.data;
    const { data, error } = await ctx.supabase.rpc('bi_save_metric', {
      p_org: org, p_id: v.id, p_dataset: v.dataset_id, p_name: v.name, p_description: v.description, p_type: v.metric_type, p_agg: v.metric_type === 'aggregation' ? v.aggregation ?? null : null,
      p_field: v.metric_type === 'aggregation' && v.field_key ? v.field_key : null, p_ast: v.metric_type === 'formula' ? v.ast : null, p_filters: v.metric_type === 'aggregation' ? v.filters : [], p_format: v.format_type, p_unit: v.unit,
    });
    if (error) return fail(dbMessage(error, 'Já existe um indicador com este nome neste dataset.'), undefined, raw);
    bustBi();
    const r = data as { id: string; version: number };
    return { ...succeed(v.id ? `Indicador atualizado (versão ${r.version}). Dashboards já montados continuam na versão anterior até você atualizá-los.` : 'Indicador criado.'), id: r.id, redirectTo: `/indicadores/${r.id}` };
  });
}

export async function archiveMetric(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'archiveMetric', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_archive_metric', { p_org: org, p_id: p.data.id, p_archive: raw.restore !== 'true' });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed(raw.restore === 'true' ? 'Indicador restaurado.' : 'Indicador arquivado.');
  });
}

export async function saveDimension(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(dimensionSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'saveDimension', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('bi_save_dimension', { p_org: org, p_id: v.id, p_dataset: v.dataset_id, p_name: v.name, p_column: v.column_key, p_type: v.dimension_type });
    if (error) return fail(dbMessage(error, 'Já existe uma dimensão com este nome.'), undefined, raw);
    bustBi();
    return succeed('Dimensão salva.');
  });
}

export async function deleteDimension(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(dimIdSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'deleteDimension', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_delete_dimension', { p_org: org, p_id: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Dimensão removida.');
  });
}

/** Salva um gráfico reutilizável: a configuração é compilada (e validada) pelo motor antes de ir ao banco. */
export async function saveChart(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(chartSaveSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'saveChart', async (ctx, org) => {
    const b = p.data.builder as never as import('../builder').ChartBuilder;
    try {
      const c = await compileBuilder(ctx, b);
      const { error } = await ctx.supabase.rpc('bi_save_chart', { p_org: org, p_id: p.data.id, p_dataset: c.dataset.id, p_name: p.data.name, p_type: b.chart,
        p_config: { metric_ids: b.metric_ids, dimensions: b.dims, filters: b.filters, period_field: b.period_field, title: b.title } });
      if (error) return fail(dbMessage(error), undefined, raw);
    } catch (e) {
      if (e instanceof BiError) return fail(e.message, undefined, raw);
      throw e;
    }
    bustBi();
    return succeed('Gráfico salvo na biblioteca.');
  });
}

export async function archiveChart(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'archiveChart', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_archive_chart', { p_org: org, p_id: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Gráfico arquivado.');
  });
}
