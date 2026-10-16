import type { Metadata } from 'next';
import { MfaEnrollForm } from '@/components/forms/mfa-forms';
import { Alert } from '@/components/ui/primitives';
import { requireUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Verificação em duas etapas' };

export default async function MfaEnrollPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  await requireUser();
  const { required } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Verificação em duas etapas</h1>
      <p className="mb-5 text-sm text-muted">Proteja a conta com um código gerado pelo seu celular.</p>
      {required ? (
        <div className="mb-4">
          <Alert tone="warning">Contas de proprietário e administrador exigem verificação em duas etapas.</Alert>
        </div>
      ) : null}
      <MfaEnrollForm />
    </>
  );
}
