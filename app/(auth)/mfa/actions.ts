'use server';

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { fail, fieldErrorsFrom, textField, type ActionState } from '@/lib/actions/result';
import { AUTH_LIMITS, rateLimit } from '@/lib/security/rate-limit';
import { logEvent } from '@/lib/log';
import { totpCodeSchema } from '@/lib/validation/auth';
import { uuidSchema } from '@/lib/validation/org';

/** Gera um novo fator TOTP. Fatores não verificados anteriores são descartados. */
export async function startEnroll(): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createSupabaseServer();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `app-${randomBytes(4).toString('hex')}`,
  });
  if (error || !data) {
    logEvent('warn', 'mfa.enroll_failed', { code: error?.code, userId: user.id });
    return fail('Não foi possível iniciar o cadastro do autenticador. Tente novamente.');
  }
  return { ok: true, enroll: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

export async function confirmEnroll(prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = totpCodeSchema.safeParse({ code: textField(formData, 'code') });
  const factorId = uuidSchema.safeParse(textField(formData, 'factorId'));
  if (!parsed.success) return { ...prev, ok: false, message: 'Verifique o código.', fieldErrors: fieldErrorsFrom(parsed.error) };
  if (!factorId.success) return fail('Fator inválido. Gere um novo QR Code.');

  if (!rateLimit(`mfa:${user.id}`, AUTH_LIMITS.mfa).allowed) {
    return { ...prev, ok: false, message: 'Muitas tentativas. Aguarde alguns minutos.' };
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.data, code: parsed.data.code });
  if (error) {
    logEvent('warn', 'mfa.confirm_failed', { code: error.code, userId: user.id });
    return { ...prev, ok: false, message: 'Código inválido ou expirado. Confira o relógio do celular e tente novamente.' };
  }
  logEvent('info', 'mfa.enrolled', { userId: user.id });
  redirect('/dashboard');
}

export async function verifyMfa(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = totpCodeSchema.safeParse({ code: textField(formData, 'code') });
  if (!parsed.success) return fail('Verifique o código.', fieldErrorsFrom(parsed.error));

  if (!rateLimit(`mfa:${user.id}`, AUTH_LIMITS.mfa).allowed) return fail('Muitas tentativas. Aguarde alguns minutos.');

  const supabase = await createSupabaseServer();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === 'verified');
  if (!factor) redirect('/mfa/enroll');

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data.code });
  if (error) {
    logEvent('warn', 'mfa.verify_failed', { code: error.code, userId: user.id });
    return fail('Código inválido ou expirado.');
  }
  redirect('/dashboard');
}
