import type { Metadata } from 'next';
import { MfaVerifyForm } from '@/components/forms/mfa-forms';
import { requireUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Confirmar acesso' };

export default async function MfaVerifyPage() {
  await requireUser();
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Confirmar acesso</h1>
      <p className="mb-5 text-sm text-muted">Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
      <MfaVerifyForm />
    </>
  );
}
