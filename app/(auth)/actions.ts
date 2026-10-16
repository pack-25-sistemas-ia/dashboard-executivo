'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getPublicEnv } from '@/lib/env';
import { requireUser, ORG_COOKIE } from '@/lib/auth/session';
import { fail, fieldErrorsFrom, succeed, textField, type ActionState } from '@/lib/actions/result';
import { AUTH_LIMITS, rateLimit } from '@/lib/security/rate-limit';
import { safeNext } from '@/lib/security/redirect';
import { logEvent } from '@/lib/log';
import { forgotPasswordSchema, loginSchema, resetPasswordSchema, signUpSchema } from '@/lib/validation/auth';

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

const TOO_MANY = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: textField(formData, 'email'), password: textField(formData, 'password') });
  const email = textField(formData, 'email').trim().toLowerCase();
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error), { email });

  const ip = await clientIp();
  if (!rateLimit(`login:${ip}:${parsed.data.email}`, AUTH_LIMITS.login).allowed) return fail(TOO_MANY, undefined, { email });

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    logEvent('warn', 'auth.login_failed', { status: error.status, code: error.code });
    // Mensagem única: não revela se o e-mail existe.
    return fail('E-mail ou senha inválidos.', undefined, { email });
  }
  logEvent('info', 'auth.login_ok');
  redirect(safeNext(textField(formData, 'next')));
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = {
    email: textField(formData, 'email'),
    password: textField(formData, 'password'),
    confirmPassword: textField(formData, 'confirmPassword'),
    acceptTerms: formData.get('acceptTerms') ?? undefined,
  };
  const values = { email: raw.email.trim().toLowerCase(), acceptTerms: raw.acceptTerms === 'on' ? 'on' : '' };
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error), values);

  const ip = await clientIp();
  if (!rateLimit(`signup:${ip}`, AUTH_LIMITS.signup).allowed) return fail(TOO_MANY, undefined, values);

  const env = getPublicEnv();
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/dashboard`,
      data: { terms_accepted_at: new Date().toISOString() },
    },
  });
  if (error) {
    logEvent('warn', 'auth.signup_failed', { status: error.status, code: error.code });
    if (error.status === 429) return fail(TOO_MANY, undefined, values);
  }
  // Resposta neutra: não revela se o e-mail já está cadastrado.
  return succeed('Se o cadastro for possível, enviaremos um e-mail para confirmar o seu endereço.');
}

export async function forgotPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: textField(formData, 'email') });
  if (!parsed.success) return fail('Informe um e-mail válido.', fieldErrorsFrom(parsed.error));

  const ip = await clientIp();
  if (!rateLimit(`recovery:${ip}`, AUTH_LIMITS.recovery).allowed) return fail(TOO_MANY);

  const env = getPublicEnv();
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/reset-password`,
  });
  if (error) logEvent('warn', 'auth.recovery_failed', { status: error.status, code: error.code });
  return succeed('Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.');
}

export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = resetPasswordSchema.safeParse({
    password: textField(formData, 'password'),
    confirmPassword: textField(formData, 'confirmPassword'),
  });
  if (!parsed.success) return fail('Verifique os campos.', fieldErrorsFrom(parsed.error));

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    logEvent('warn', 'auth.reset_failed', { status: error.status, code: error.code });
    return fail('Não foi possível redefinir a senha. Solicite um novo link.');
  }
  // Encerra as demais sessões do usuário após a troca de senha.
  await supabase.auth.signOut({ scope: 'others' });
  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  (await cookies()).delete(ORG_COOKIE);
  redirect('/login');
}
