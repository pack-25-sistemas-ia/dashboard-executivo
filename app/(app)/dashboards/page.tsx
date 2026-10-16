import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { loadDashboards, loadFavoriteIds } from '@/lib/bi/data';
import { DASH_STATUS_LABELS, VISIBILITY_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { DashboardCreateForm } from '@/components/bi/forms';
import { DateTimeBR, Disclosure, StatusBadge, TD, TH, TableShell } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Dashboards' };

export default async function DashboardsPage() {
  const p = await pageCtx();
  const [list, favs] = await Promise.all([loadDashboards(p.ctx), loadFavoriteIds(p.ctx)]);
  return (
    <>
      <PageHeader title="Dashboards" description="Painéis montados sobre indicadores reais. Rascunhos são privados; publicar cria uma versão do layout e define quem pode ver.">
        {p.perms.analyst ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" href="/dashboards/novo">Novo a partir de modelo</Link> : null}
      </PageHeader>
      {list.length === 0 ? (
        <EmptyState title="Nenhum dashboard disponível" description={p.perms.analyst ? 'Crie um a partir de um modelo ou do zero.' : 'Quando alguém compartilhar um dashboard com você (ou publicá-lo para a empresa), ele aparece aqui.'} />
      ) : (
        <TableShell caption="Dashboards">
          <thead><tr><th scope="col" className={TH}>Nome</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Visibilidade</th><th scope="col" className={TH}>Atualizado em</th></tr></thead>
          <tbody>{list.map((d) => (
            <tr key={d.id} className="border-t border-border"><td className={TD}><Link className="font-medium underline" href={`/dashboards/${d.id}`}>{favs.has(d.id) ? '★ ' : ''}{d.name}</Link>{d.description ? <p className="text-xs text-muted">{d.description}</p> : null}</td>
              <td className={TD}><StatusBadge status={d.status} label={DASH_STATUS_LABELS[d.status]} /></td><td className={TD}>{VISIBILITY_LABELS[d.visibility]?.split(' (')[0]}</td><td className={TD}><DateTimeBR value={d.updated_at} tz={p.tz} /></td></tr>
          ))}</tbody>
        </TableShell>
      )}
      {p.perms.analyst ? (
        <div className="mt-6"><Disclosure summary="Criar dashboard em branco">
          <DashboardCreateForm />
        </Disclosure></div>
      ) : null}
    </>
  );
}
