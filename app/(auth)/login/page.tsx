import type { Metadata } from 'next';
import { LoginForm } from '@/components/forms/auth-forms';
import { Alert } from '@/components/ui/primitives';
import { safeNext } from '@/lib/security/redirect';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Entrar</h1>
      <p className="mb-5 text-sm text-muted">Acesse sua conta para continuar.</p>
      {error === 'link_invalido' ? (
        <div className="mb-4">
          <Alert tone="error">O link é inválido ou expirou. Solicite um novo.</Alert>
        </div>
      ) : null}
      <LoginForm next={next ? safeNext(next) : undefined} />
    </>
  );
}
