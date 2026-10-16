import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingForm } from '@/components/forms/org-forms';
import { getMemberships, requireUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Criar organização' };

export default async function OnboardingPage() {
  const user = await requireUser();
  if ((await getMemberships(user.id)).length > 0) redirect('/dashboard');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="mb-1 text-xl font-semibold">Crie sua organização</h1>
        <p className="mb-5 text-sm text-muted">
          Você será o proprietário e deverá ativar a verificação em duas etapas em seguida. Os dados ficam isolados por organização.
        </p>
        <OnboardingForm />
      </div>
    </main>
  );
}
