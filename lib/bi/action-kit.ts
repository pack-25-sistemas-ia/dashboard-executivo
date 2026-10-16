import 'server-only';
import { revalidatePath } from 'next/cache';
import type { ZodType } from 'zod';
import { actionContext, type Context } from '@/lib/auth/session';
import { fail, fieldErrorsFrom, messageForDbError, type ActionState } from '@/lib/actions/result';
import { logEvent } from '@/lib/log';
import { rateLimit } from '@/lib/security/rate-limit';
import type { OrgRole } from '@/lib/validation/org';

export const ROLES = {
  read: ['owner', 'admin', 'manager', 'member', 'viewer'],
  operator: ['owner', 'admin', 'manager', 'member'],
  manager: ['owner', 'admin', 'manager'],
  admin: ['owner', 'admin'],
} as const satisfies Record<string, readonly OrgRole[]>;
export type Level = keyof typeof ROLES;

/** Mensagens que escrevemos no banco (funções bi_*) são úteis ao usuário; erros nativos viram mensagem genérica. */
export function dbMessage(error: { code?: string; message?: string }, duplicate?: string): string {
  if (error.code === '23505' && duplicate) return duplicate;
  if (error.code === '23503') return 'Este registro está em uso ou referencia algo inexistente.';
  const msg = error.message ?? '';
  const own = ['23514', '22023', '55000', '42501', '23505'];
  if (own.includes(error.code ?? '') && msg && msg.length <= 300 && !/violat|constraint|relation|column|violação|restrição|permission denied|duplicate key/i.test(msg)) {
    return msg.charAt(0).toUpperCase() + msg.slice(1) + (/[.!?]$/.test(msg) ? '' : '.');
  }
  if (error.code === '42501') return 'Você não tem permissão para esta ação.';
  return messageForDbError(error);
}

export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

export function parse<T>(schema: ZodType<T>, data: unknown, values?: Record<string, string>): { ok: true; data: T } | { ok: false; state: ActionState } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const first = r.error.issues[0]?.message;
  return { ok: false, state: fail(first && r.error.issues.length === 1 && !r.error.issues[0]?.path.length ? first : 'Revise os campos destacados.', fieldErrorsFrom(r.error), values) };
}

/** Executa uma ação com sessão, MFA, papel mínimo e limite de taxa; o banco autoriza de novo pelo auth.uid(). */
export async function guarded(level: Level, name: string, fn: (ctx: Context, org: string) => Promise<ActionState>): Promise<ActionState> {
  const a = await actionContext(ROLES[level]);
  if ('error' in a) return a.error;
  const org = a.ctx.membership.organization_id;
  const rl = rateLimit(`bi:${a.ctx.user.id}`, { limit: 240, windowMs: 60_000 });
  if (!rl.allowed) return fail(`Muitas operações em pouco tempo. Aguarde ${rl.retryAfterSeconds}s e tente de novo.`);
  try {
    return await fn(a.ctx, org);
  } catch (e) {
    logEvent('error', 'bi_action_failed', { action: name, name: e instanceof Error ? e.name : 'unknown' });
    return fail('Não foi possível concluir a operação. Tente novamente.');
  }
}

export const bust = (...paths: string[]) => paths.forEach((p) => revalidatePath(p));

export type SaveResult = ActionState & { id?: string; redirectTo?: string };

export const bustBi = () => ['/inicio', '/datasets', '/importacoes', '/explorador', '/indicadores', '/dashboards', '/metas', '/relatorios', '/compartilhamentos', '/qualidade', '/notificacoes', '/configuracoes']
  .forEach((p) => revalidatePath(p, 'layout'));
