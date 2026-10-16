'use server';

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServer } from '@/lib/supabase/server';
import { actionContext, getMemberships, ORG_COOKIE, requireUser } from '@/lib/auth/session';
import { fail, fieldErrorsFrom, messageForDbError, succeed, textField, type ActionState } from '@/lib/actions/result';
import { logEvent } from '@/lib/log';
import { slugify } from '@/lib/utils';
import {
  changeRoleSchema,
  createOrganizationSchema,
  removeMemberSchema,
  updateSettingsSchema,
  uuidSchema,
} from '@/lib/validation/org';
import { createPrivacyRequestSchema, updatePrivacyStatusSchema } from '@/lib/validation/privacy';

const ADMINS = ['owner', 'admin'] as const;
const PRIVACY_OPERATORS = ['owner', 'admin', 'manager'] as const;

async function setActiveOrg(orgId: string) {
  (await cookies()).set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function createOrganization(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = textField(formData, 'name');
  const parsed = createOrganizationSchema.safeParse({ name });
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error), { name });

  const supabase = await createSupabaseServer();
  let orgId: string | null = null;
  // O slug recebe sufixo aleatório: evita colisões e não permite sondar nomes já usados.
  for (let attempt = 0; attempt < 2 && !orgId; attempt++) {
    const slug = `${slugify(parsed.data.name)}-${randomBytes(3).toString('hex')}`;
    const { data, error } = await supabase.rpc('create_organization', { p_name: parsed.data.name, p_slug: slug });
    if (!error && typeof data === 'string') orgId = data;
    else if (error?.code !== '23505') {
      logEvent('warn', 'org.create_failed', { code: error?.code, userId: user.id });
      return fail(messageForDbError(error), undefined, { name });
    }
  }
  if (!orgId) return fail('Não foi possível criar a organização. Tente novamente.', undefined, { name });

  await setActiveOrg(orgId);
  logEvent('info', 'org.created', { userId: user.id, orgId });
  redirect('/dashboard');
}

export async function switchOrganization(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = uuidSchema.safeParse(textField(formData, 'organization_id'));
  if (!orgId.success) redirect('/dashboard');
  const memberships = await getMemberships(user.id);
  // A troca só vale para organizações das quais o usuário realmente participa.
  if (memberships.some((m) => m.organization_id === orgId.data)) await setActiveOrg(orgId.data);
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await actionContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;

  const values = { display_name: textField(formData, 'display_name'), primary_color: textField(formData, 'primary_color') };
  const parsed = updateSettingsSchema.safeParse(values);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error), values);

  const { data: current } = await ctx.supabase
    .from('organization_settings')
    .select('theme')
    .eq('organization_id', ctx.membership.organization_id)
    .maybeSingle();
  const theme = { ...(current?.theme as Record<string, unknown> | undefined), primary: parsed.data.primary_color.toLowerCase() };

  const { data, error } = await ctx.supabase
    .from('organization_settings')
    .update({ display_name: parsed.data.display_name, theme })
    .eq('organization_id', ctx.membership.organization_id)
    .select('organization_id');
  if (error) return fail(messageForDbError(error), undefined, values);
  if (!data?.length) return fail('Você não tem permissão para esta ação.', undefined, values);

  revalidatePath('/', 'layout');
  return succeed('Configurações salvas.');
}

export async function changeRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await actionContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;

  const parsed = changeRoleSchema.safeParse({ user_id: textField(formData, 'user_id'), role: textField(formData, 'role') });
  if (!parsed.success) return fail('Dados inválidos.', fieldErrorsFrom(parsed.error));

  const { data, error } = await ctx.supabase
    .from('organization_members')
    .update({ role: parsed.data.role })
    .eq('organization_id', ctx.membership.organization_id)
    .eq('user_id', parsed.data.user_id)
    .select('user_id');
  if (error) return fail(messageForDbError(error));
  if (!data?.length) return fail('Sem permissão para alterar este membro.');

  revalidatePath('/members');
  return succeed('Papel atualizado.');
}

export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await actionContext(ADMINS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;

  const parsed = removeMemberSchema.safeParse({ user_id: textField(formData, 'user_id') });
  if (!parsed.success) return fail('Dados inválidos.', fieldErrorsFrom(parsed.error));
  if (parsed.data.user_id === ctx.user.id) return fail('Você não pode remover a si mesmo por aqui.');

  const { data, error } = await ctx.supabase
    .from('organization_members')
    .delete()
    .eq('organization_id', ctx.membership.organization_id)
    .eq('user_id', parsed.data.user_id)
    .select('user_id');
  if (error) return fail(messageForDbError(error));
  if (!data?.length) return fail('Sem permissão para remover este membro.');

  revalidatePath('/members');
  return succeed('Membro removido.');
}

export async function createPrivacyRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await actionContext(PRIVACY_OPERATORS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;

  const values = {
    request_type: textField(formData, 'request_type'),
    subject_reference: textField(formData, 'subject_reference'),
    notes: textField(formData, 'notes'),
  };
  const parsed = createPrivacyRequestSchema.safeParse(values);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error), values);

  const { error } = await ctx.supabase.from('privacy_requests').insert({
    organization_id: ctx.membership.organization_id,
    request_type: parsed.data.request_type,
    subject_reference: parsed.data.subject_reference,
    notes: parsed.data.notes ?? null,
  });
  if (error) return fail(messageForDbError(error), undefined, values);

  revalidatePath('/privacy');
  revalidatePath('/dashboard');
  return succeed('Solicitação registrada. O prazo padrão de resposta é de 15 dias.');
}

export async function updatePrivacyStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await actionContext(PRIVACY_OPERATORS);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;

  const parsed = updatePrivacyStatusSchema.safeParse({ id: textField(formData, 'id'), status: textField(formData, 'status') });
  if (!parsed.success) return fail('Dados inválidos.', fieldErrorsFrom(parsed.error));

  const closed = parsed.data.status === 'answered' || parsed.data.status === 'rejected';
  const { data, error } = await ctx.supabase
    .from('privacy_requests')
    .update({ status: parsed.data.status, answered_at: closed ? new Date().toISOString() : null })
    .eq('id', parsed.data.id)
    .eq('organization_id', ctx.membership.organization_id)
    .select('id');
  if (error) return fail(messageForDbError(error));
  if (!data?.length) return fail('Solicitação não encontrada.');

  revalidatePath('/privacy');
  revalidatePath('/dashboard');
  return succeed('Status atualizado.');
}
