import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/forms/auth-forms';
import { requireUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Redefinir senha' };

export default async function ResetPasswordPage() {
  await requireUser();
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Redefinir senha</h1>
      <p className="mb-5 text-sm text-muted">Escolha uma nova senha. As outras sessões serão encerradas.</p>
      <ResetPasswordForm />
    </>
  );
}
