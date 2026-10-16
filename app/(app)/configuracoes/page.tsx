import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { pageCtx } from '@/lib/bi/page';
import { SettingsForm } from '@/components/bi/forms';
import { Section } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Configurações do BI' };

export default async function BiSettingsPage() {
  const p = await pageCtx();
  if (!p.perms.admin) redirect('/inicio');
  const s = p.settings;
  return (
    <>
      <PageHeader title="Configurações do BI" description="Limites de importação, fuso horário, retenção de versões e preferências de exibição. Mudar a aparência (nome do portal, logotipo, cor) não altera cálculos nem dados. A cor e o nome da empresa ficam em «Configurações» (menu lateral)." />
      <Section title="Importação, retenção e exibição">
        <SettingsForm s={s} />
      </Section>
    </>
  );
}
