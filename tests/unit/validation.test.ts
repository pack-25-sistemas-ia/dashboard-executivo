import { describe, expect, it } from 'vitest';
import { forgotPasswordSchema, loginSchema, newPasswordSchema, signUpSchema, totpCodeSchema } from '@/lib/validation/auth';
import { changeRoleSchema, createOrganizationSchema, isAdminRole, isPrivacyRole, updateSettingsSchema } from '@/lib/validation/org';
import { createPrivacyRequestSchema, updatePrivacyStatusSchema } from '@/lib/validation/privacy';
import { fieldErrorsFrom, messageForDbError } from '@/lib/actions/result';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('senha', () => {
  it('exige 12+ caracteres, variedade e rejeita comuns', () => {
    expect(newPasswordSchema.safeParse('curta').success).toBe(false);
    expect(newPasswordSchema.safeParse('aaaaaaaaaaaaaaaa').success).toBe(false);
    expect(newPasswordSchema.safeParse('PASSWORD1234').success).toBe(false);
    expect(newPasswordSchema.safeParse('x'.repeat(129)).success).toBe(false);
    expect(newPasswordSchema.safeParse('uma frase longa e segura').success).toBe(true);
  });
});

describe('autenticação', () => {
  it('normaliza e-mail e valida formato', () => {
    const r = loginSchema.parse({ email: '  USER@Example.COM ', password: 'x' });
    expect(r.email).toBe('user@example.com');
    expect(loginSchema.safeParse({ email: 'nao-e-email', password: 'x' }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: 'a'.repeat(250) + '@b.co' }).success).toBe(false);
  });
  it('cadastro exige senhas iguais e aceite dos termos', () => {
    const base = { email: 'a@b.co', password: 'uma frase longa e segura', confirmPassword: 'uma frase longa e segura', acceptTerms: 'on' };
    expect(signUpSchema.safeParse(base).success).toBe(true);
    expect(signUpSchema.safeParse({ ...base, confirmPassword: 'outra' }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, acceptTerms: undefined }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, acceptTerms: 'off' }).success).toBe(false);
  });
  it('código TOTP tem exatamente 6 dígitos', () => {
    expect(totpCodeSchema.safeParse({ code: '123456' }).success).toBe(true);
    for (const code of ['12345', '1234567', 'abcdef', '12 456', '']) expect(totpCodeSchema.safeParse({ code }).success).toBe(false);
  });
});

describe('organização e papéis', () => {
  it('valida nome, cor e papel', () => {
    expect(createOrganizationSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: 'Minha Empresa' }).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ display_name: 'Ok', primary_color: '#0B1220' }).success).toBe(true);
    for (const c of ['red', '#12345', '#GGGGGG', 'url(javascript:x)', '#0B1220;}body{', '']) {
      expect(updateSettingsSchema.safeParse({ display_name: 'Ok', primary_color: c }).success).toBe(false);
    }
    expect(changeRoleSchema.safeParse({ user_id: UUID, role: 'admin' }).success).toBe(true);
    expect(changeRoleSchema.safeParse({ user_id: UUID, role: 'root' }).success).toBe(false);
    expect(changeRoleSchema.safeParse({ user_id: 'x', role: 'admin' }).success).toBe(false);
  });
  it('papéis privilegiados', () => {
    expect(isAdminRole('owner') && isAdminRole('admin')).toBe(true);
    expect(isAdminRole('manager') || isAdminRole('viewer')).toBe(false);
    expect(isPrivacyRole('manager')).toBe(true);
    expect(isPrivacyRole('member')).toBe(false);
  });
});

describe('solicitações de titulares', () => {
  it('valida tipo, referência e anotações', () => {
    expect(createPrivacyRequestSchema.safeParse({ request_type: 'access', subject_reference: 'titular-1' }).success).toBe(true);
    expect(createPrivacyRequestSchema.safeParse({ request_type: 'hack', subject_reference: 'x' }).success).toBe(false);
    expect(createPrivacyRequestSchema.safeParse({ request_type: 'access', subject_reference: '' }).success).toBe(false);
    expect(createPrivacyRequestSchema.safeParse({ request_type: 'access', subject_reference: 'x', notes: 'n'.repeat(2001) }).success).toBe(false);
    expect(updatePrivacyStatusSchema.safeParse({ id: UUID, status: 'answered' }).success).toBe(true);
    expect(updatePrivacyStatusSchema.safeParse({ id: UUID, status: 'deleted' }).success).toBe(false);
  });
});

describe('mensagens de erro', () => {
  it('traduz códigos do Postgres sem vazar detalhes técnicos', () => {
    expect(messageForDbError({ code: '42501' })).toMatch(/permissão/);
    expect(messageForDbError({ code: '23514', message: 'a organização precisa manter ao menos um owner' })).toMatch(/proprietário/);
    const generic = messageForDbError({ code: 'XX000', message: 'relation "public.secret" does not exist' });
    expect(generic).not.toContain('secret');
    expect(messageForDbError(null)).toBeTruthy();
  });
  it('agrupa erros por campo', () => {
    const r = signUpSchema.safeParse({ email: 'x', password: 'c', confirmPassword: 'c', acceptTerms: 'on' });
    if (r.success) throw new Error('deveria falhar');
    const fe = fieldErrorsFrom(r.error);
    expect(fe.email?.length).toBeGreaterThan(0);
    expect(fe.password?.length).toBeGreaterThan(0);
  });
});
