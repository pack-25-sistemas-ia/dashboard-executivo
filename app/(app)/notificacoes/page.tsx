import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { loadNotifications, loadPrefs } from '@/lib/bi/data';
import { NOTIFICATION_TYPES } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { markNotificationsRead, setNotificationPref } from '@/lib/bi/actions/misc';
import { ActionButton } from '@/components/bi/fields';
import { DateTimeBR, Section } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Avisos' };

const HREF: Record<string, (id: string | null) => string | null> = {
  datasets: (id) => (id ? `/datasets/${id}` : null), dashboards: (id) => (id ? `/dashboards/${id}` : null), import_jobs: (id) => (id ? `/importacoes/${id}` : null), goal_definitions: () => '/metas',
};

export default async function NotificationsPage() {
  const p = await pageCtx();
  const [list, prefs] = await Promise.all([loadNotifications(p.ctx), loadPrefs(p.ctx)]);
  const unread = list.filter((n) => !n.read_at).length;
  return (
    <>
      <PageHeader title="Avisos" description="Importações, indicadores inválidos, metas, compartilhamentos e dados desatualizados. Os avisos nunca trazem valores de negócio: só o nome do item e o motivo.">
        {unread ? <ActionButton action={markNotificationsRead} fields={{}} label="Marcar todos como lidos" /> : null}
      </PageHeader>
      <Section title={`Caixa de entrada (${unread} não lido${unread === 1 ? '' : 's'})`}>
        {list.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhum aviso por enquanto.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="notifications">
            {list.map((n) => {
              const href = n.resource_type ? HREF[n.resource_type]?.(n.resource_id) : null;
              return (
                <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium">{!n.read_at ? <Badge tone="warning">Novo</Badge> : null} {n.title} <span className="text-xs font-normal text-muted">· {NOTIFICATION_TYPES[n.type] ?? n.type}</span></p>
                    {n.body ? <p className="text-sm text-muted">{n.body}</p> : null}
                    <p className="text-xs text-muted"><DateTimeBR value={n.created_at} tz={p.tz} /> {href ? <>· <Link className="underline" href={href}>Abrir</Link></> : null}</p>
                  </div>
                  {!n.read_at ? <ActionButton action={markNotificationsRead} fields={{ id: n.id }} label="Marcar como lido" /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Preferências" description="Escolha quais tipos de aviso você quer receber.">
        <ul className="space-y-2 text-sm">{Object.entries(NOTIFICATION_TYPES).map(([t, label]) => {
          const on = prefs.get(t) ?? true;
          return <li key={t} className="flex items-center justify-between gap-3"><span>{label}</span><ActionButton action={setNotificationPref} fields={{ type: t, enabled: on ? 'false' : 'true' }} label={on ? 'Ativado — desativar' : 'Desativado — ativar'} /></li>;
        })}</ul>
      </Section>
    </>
  );
}
