import type { Metadata } from 'next';
import { SettingsForm } from '@/components/forms/org-forms';
import { Card, PageHeader } from '@/components/ui/primitives';
import { requireContext } from '@/lib/auth/session';
import { safePrimary } from '@/lib/utils';

export const metadata: Metadata = { title: 'Configurações' };

export default async function SettingsPage() {
  const ctx = await requireContext(['owner', 'admin']);
  const { data } = await ctx.supabase
    .from('organization_settings')
    .select('display_name, theme, locale, currency')
    .eq('organization_id', ctx.membership.organization_id)
    .maybeSingle();

  return (
    <>
      <PageHeader title="Configurações" description="Identidade visual da organização. Não altera a lógica do sistema." />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="Identidade">
          <SettingsForm
            displayName={(data?.display_name as string | undefined) ?? ctx.membership.name}
            primaryColor={safePrimary((data?.theme as { primary?: unknown } | null)?.primary)}
          />
        </Card>
        <Card title="Regionalização">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Idioma</dt><dd>{(data?.locale as string | undefined) ?? 'pt-BR'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Moeda</dt><dd>{(data?.currency as string | undefined) ?? 'BRL'}</dd></div>
          </dl>
        </Card>
      </div>
    </>
  );
}
