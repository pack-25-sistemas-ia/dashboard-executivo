import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'E-mail muito longo.')
  .pipe(z.email('Informe um e-mail válido.'));

// NIST SP 800-63B: priorizar tamanho; bloquear senhas triviais. Sem regras de composição arbitrárias.
const COMMON = new Set([
  '123456789012', 'password1234', 'senha1234567', 'qwertyuiop12', 'abcdefghijkl', '111111111111', 'administrador',
]);

export const newPasswordSchema = z
  .string()
  .min(12, 'A senha deve ter no mínimo 12 caracteres.')
  .max(128, 'A senha deve ter no máximo 128 caracteres.')
  .refine((p) => !COMMON.has(p.toLowerCase()), 'Esta senha é muito comum. Escolha outra.')
  .refine((p) => new Set(p).size >= 5, 'Use uma senha com mais variedade de caracteres.');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha.').max(128),
});

export const signUpSchema = z
  .object({
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal('on', 'É necessário aceitar os termos e a política de privacidade.'),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'As senhas não conferem.' });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'As senhas não conferem.' });

export const totpCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'O código tem 6 dígitos.'),
});
