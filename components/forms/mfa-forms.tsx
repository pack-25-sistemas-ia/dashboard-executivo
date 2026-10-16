'use client';

import { useActionState } from 'react';
import { confirmEnroll, startEnroll, verifyMfa } from '@/app/(auth)/mfa/actions';
import { Field, Input } from '@/components/ui/primitives';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import type { ActionState } from '@/lib/actions/result';

const initial: ActionState = {};

const CODE_PROPS = { inputMode: 'numeric', autoComplete: 'one-time-code', pattern: '[0-9]{6}', maxLength: 6, required: true } as const;

export function MfaEnrollForm() {
  const [start, startAction] = useActionState(startEnroll, initial);
  const [confirm, confirmAction] = useActionState(confirmEnroll, start);

  if (!start.enroll) {
    return (
      <form action={startAction} className="space-y-4">
        <FormMessage state={start} />
        <SubmitButton pendingText="Gerando…">Gerar QR Code</SubmitButton>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Abra um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</li>
        <li>Escaneie o QR Code ou digite a chave manualmente.</li>
        <li>Informe o código de 6 dígitos exibido no aplicativo.</li>
      </ol>
      {/* Data URL SVG gerada pelo Supabase; next/image não se aplica. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={start.enroll.qr} alt="QR Code para cadastrar o autenticador" width={192} height={192} className="rounded-md border border-border bg-white p-2" />
      <p className="text-sm">
        Chave manual: <code className="break-all rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">{start.enroll.secret}</code>
      </p>
      <form action={confirmAction} className="space-y-4" noValidate>
        <input type="hidden" name="factorId" value={start.enroll.factorId} />
        <Field label="Código de 6 dígitos" name="code" errors={confirm.fieldErrors?.code}>
          <Input id="code" name="code" {...CODE_PROPS} aria-invalid={Boolean(confirm.fieldErrors?.code)} />
        </Field>
        <FormMessage state={confirm} />
        <SubmitButton pendingText="Verificando…">Ativar verificação em duas etapas</SubmitButton>
      </form>
    </div>
  );
}

export function MfaVerifyForm() {
  const [state, action] = useActionState(verifyMfa, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Código de 6 dígitos" name="code" errors={state.fieldErrors?.code}>
        <Input id="code" name="code" {...CODE_PROPS} autoFocus aria-invalid={Boolean(state.fieldErrors?.code)} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Verificando…">Verificar</SubmitButton>
    </form>
  );
}
