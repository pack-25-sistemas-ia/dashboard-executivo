import type { Metadata } from 'next';
import { SignUpForm } from '@/components/forms/auth-forms';

export const metadata: Metadata = { title: 'Criar conta' };

export default function SignUpPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Criar conta</h1>
      <p className="mb-5 text-sm text-muted">Você receberá um e-mail para confirmar o endereço.</p>
      <SignUpForm />
    </>
  );
}
