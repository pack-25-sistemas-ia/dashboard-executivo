import 'server-only';
import { requireContext } from '@/lib/auth/session';
import { civilDateIn } from './engine';
import { nowMs } from '@/lib/time';
import { can } from './labels';

export type BiSettings = {
  timezone: string; date_format: string; currency: string; portal_name: string | null; max_rows: number; max_file_mb: number; stale_days: number; retained_versions: number; default_period: string;
};

/** Contexto comum das páginas: sessão (já com MFA/papel), configurações da empresa, fuso, «hoje» e permissões para mostrar/ocultar botões (o banco decide de verdade). */
export async function pageCtx() {
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from('bi_settings').select('timezone, date_format, currency, portal_name, max_rows, max_file_mb, stale_days, retained_versions, default_period').eq('organization_id', ctx.membership.organization_id).maybeSingle();
  const settings: BiSettings = (data as BiSettings | null) ?? { timezone: 'America/Sao_Paulo', date_format: 'DD/MM/YYYY', currency: 'BRL', portal_name: null, max_rows: 50000, max_file_mb: 20, stale_days: 7, retained_versions: 5, default_period: 'last_30' };
  return { ctx, settings, tz: settings.timezone, today: civilDateIn(new Date(nowMs()), settings.timezone), perms: can(ctx.membership.role), org: ctx.membership.organization_id, role: ctx.membership.role };
}
export type PageCtx = Awaited<ReturnType<typeof pageCtx>>;
