'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { forgotPassword, resetPassword, signIn, signUp } from '@/app/(auth)/actions';
import { Field, Input } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import type { ActionState } from '@/lib/actions/result';

const initial: ActionState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="E-mail" name="email" errors={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.values?.email} aria-invalid={Boolean(state.fieldErrors?.email)} />
      </Field>
      <Field label="Senha" name="password" errors={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(state.fieldErrors?.password)} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Entrando…">Entrar</SubmitButton>
      <p className="flex justify-between text-sm">
        <Link className="underline" href="/forgot-password">Esqueci minha senha</Link>
        <Link className="underline" href="/signup">Criar conta</Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUp, initial);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="E-mail" name="email" errors={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} aria-invalid={Boolean(state.fieldErrors?.email)} />
      </Field>
      <Field label="Senha" name="password" hint="Mínimo de 12 caracteres. Uma frase longa é uma boa senha." errors={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} aria-invalid={Boolean(state.fieldErrors?.password)} />
      </Field>
      <Field label="Confirmar senha" name="confirmPassword" errors={state.fieldErrors?.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={Boolean(state.fieldErrors?.confirmPassword)} />
      </Field>
      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acceptTerms" className="mt-1 size-4" required defaultChecked={state.values?.acceptTerms === 'on'} />
          <span>Li e aceito os termos de uso e a política de privacidade.</span>
        </label>
        {state.fieldErrors?.acceptTerms ? <p role="alert" className="text-xs text-danger">{state.fieldErrors.acceptTerms[0]}</p> : null}
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Criando…">Criar conta</SubmitButton>
      <p className="text-sm">
        Já tem conta? <Link className="underline" href="/login">Entrar</Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPassword, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="E-mail" name="email" errors={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(state.fieldErrors?.email)} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Enviando…">Enviar instruções</SubmitButton>
      <p className="text-sm">
        <Link className="underline" href="/login">Voltar para o login</Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPassword, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Nova senha" name="password" hint="Mínimo de 12 caracteres." errors={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} aria-invalid={Boolean(state.fieldErrors?.password)} />
      </Field>
      <Field label="Confirmar nova senha" name="confirmPassword" errors={state.fieldErrors?.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={Boolean(state.fieldErrors?.confirmPassword)} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Salvando…">Redefinir senha</SubmitButton>
    </form>
  );
}
