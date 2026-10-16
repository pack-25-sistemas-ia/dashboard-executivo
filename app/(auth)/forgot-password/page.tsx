import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/forms/auth-forms';

export const metadata: Metadata = { title: 'Recuperar senha' };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Recuperar senha</h1>
      <p className="mb-5 text-sm text-muted">Informe o e-mail da conta para receber as instruções.</p>
      <ForgotPasswordForm />
    </>
  );
}
