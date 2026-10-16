'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustBi, dbMessage, formObject, guarded, parse } from '../action-kit';
import { goalPeriodSchema, goalSchema, idSchema, prefSchema, settingsSchema, uuid, viewSchema } from '../schemas';

// ----------------------------------------------------------------------------- metas
export async function saveGoal(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(goalSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'saveGoal', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('bi_save_goal', {
      p_org: org, p_id: v.id, p_metric: v.metric_id, p_name: v.name, p_kind: v.kind, p_period_type: v.period_type, p_target: v.target, p_target_high: v.kind === 'range' ? v.target_high : null,
      p_warn: v.warn_pct, p_comparison: v.comparison, p_scope: [], p_owner: v.owner_id,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed(v.id ? 'Meta atualizada.' : 'Meta criada.');
  });
}

export async function archiveGoal(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'archiveGoal', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_archive_goal', { p_org: org, p_id: p.data.id, p_archive: raw.restore !== 'true' });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed(raw.restore === 'true' ? 'Meta reativada.' : 'Meta arquivada (o histórico continua).');
  });
}

export async function setGoalPeriod(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(goalPeriodSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('manager', 'setGoalPeriod', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_set_goal_period', { p_org: org, p_goal: p.data.goal_id, p_start: p.data.start, p_end: p.data.end, p_target: p.data.target });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Alvo do período salvo.');
  });
}

export async function notifyGoal(goalId: string, status: string, period: string): Promise<void> {
  const ok = uuid.safeParse(goalId).success && /^(achieved|missed|attention)$/.test(status) && period.length <= 30;
  if (!ok) return;
  await guarded('manager', 'notifyGoal', async (ctx, org) => {
    await ctx.supabase.rpc('bi_goal_notify', { p_org: org, p_goal: goalId, p_status: status, p_period: period });
    return succeed();
  });
}

// ----------------------------------------------------------------------------- visões salvas
export async function saveView(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(viewSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'saveView', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('bi_save_view', { p_org: org, p_id: v.id, p_dataset: v.dataset_id, p_name: v.name, p_filters: v.filters, p_columns: v.columns, p_sorting: v.sorting });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Visão salva.');
  });
}

export async function deleteView(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(idSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('operator', 'deleteView', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_delete_view', { p_org: org, p_id: p.data.id });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Visão removida.');
  });
}

// ----------------------------------------------------------------------------- avisos e configurações
export async function markNotificationsRead(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const id = raw.id ? z.object({ id: uuid }).safeParse(raw) : null;
  if (id && !id.success) return fail('Aviso inválido.');
  return guarded('read', 'markNotificationsRead', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_mark_notifications_read', { p_org: org, p_ids: id?.success ? [id.data.id] : null });
    if (error) return fail(dbMessage(error));
    bustBi();
    return succeed(id ? 'Aviso marcado como lido.' : 'Todos os avisos foram marcados como lidos.');
  });
}

export async function setNotificationPref(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(prefSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('read', 'setNotificationPref', async (ctx, org) => {
    const { error } = await ctx.supabase.rpc('bi_set_notification_pref', { p_org: org, p_type: p.data.type, p_enabled: p.data.enabled });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Preferência salva.');
  });
}

export async function updateSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const p = parse(settingsSchema, raw, raw);
  if (!p.ok) return p.state;
  return guarded('admin', 'updateSettings', async (ctx, org) => {
    const v = p.data;
    const { error } = await ctx.supabase.rpc('bi_update_settings', {
      p_org: org, p_timezone: v.timezone, p_date_format: v.date_format, p_portal_name: v.portal_name, p_max_rows: v.max_rows, p_max_file_mb: v.max_file_mb, p_stale_days: v.stale_days, p_retained: v.retained_versions, p_default_period: v.default_period,
    });
    if (error) return fail(dbMessage(error), undefined, raw);
    bustBi();
    return succeed('Configurações salvas. Os novos limites valem para as próximas importações.');
  });
}

export async function checkFreshness(): Promise<void> {
  await guarded('operator', 'checkFreshness', async (ctx, org) => {
    await ctx.supabase.rpc('bi_check_freshness', { p_org: org });
    return succeed();
  });
}
