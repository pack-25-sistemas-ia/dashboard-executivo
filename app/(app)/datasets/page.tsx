import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { loadCurrentVersions, loadDatasets } from '@/lib/bi/data';
import { DATASET_STATUS_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { DateTimeBR, Disclosure, Section, TD, TH, TDR, THR, TableShell } from '@/components/bi/bits';
import { DatasetCreateForm } from '@/components/bi/forms';
import { redirect } from 'next/navigation';
import { nowMs } from '@/lib/time';

export const metadata: Metadata = { title: 'Datasets' };

export default async function DatasetsPage() {
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const datasets = await loadDatasets(p.ctx);
  const versions = await loadCurrentVersions(p.ctx, datasets.map((d) => d.current_version_id).filter((x): x is string => Boolean(x)));
  const staleMs = p.settings.stale_days * 86_400_000;
  return (
    <>
      <PageHeader title="Datasets" description="Cada dataset é um conjunto estruturado de dados importados (vendas, despesas, atendimentos…) com versões e histórico. Os indicadores e dashboards consultam a versão ativa.">
        <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" href="/importacoes/nova">Importar arquivo</Link>
      </PageHeader>
      <Section title="Seus datasets">
        {datasets.length === 0 ? (
          <EmptyState title="Nenhum dataset ainda" description="Importe um CSV ou XLSX: o dataset é criado junto com a primeira carga." />
        ) : (
          <TableShell caption="Datasets">
            <thead><tr><th scope="col" className={TH}>Nome</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Versão ativa</th><th scope="col" className={THR}>Linhas</th><th scope="col" className={TH}>Atualizado em</th></tr></thead>
            <tbody>
              {datasets.map((d) => {
                const v = versions.get(d.id);
                const stale = v?.published_at ? nowMs() - new Date(v.published_at).getTime() > staleMs : false;
                return (
                  <tr key={d.id} className="border-t border-border">
                    <td className={TD}><Link className="font-medium underline" href={`/datasets/${d.id}`}>{d.name}</Link>{d.restricted ? <> <Badge tone="warning">Restrito</Badge></> : null}{d.source_type === 'demo' ? <> <Badge>Demonstração</Badge></> : null}</td>
                    <td className={TD}>{d.status === 'archived' ? <Badge>{DATASET_STATUS_LABELS.archived}</Badge> : !v ? <Badge tone="warning">Sem dados</Badge> : stale ? <Badge tone="warning">Desatualizado</Badge> : <Badge tone="success">Em dia</Badge>}</td>
                    <td className={TD}>{v ? `v${v.version_number}` : '—'}</td>
                    <td className={TDR}>{v ? v.row_count.toLocaleString('pt-BR') : '—'}</td>
                    <td className={TD}><DateTimeBR value={v?.published_at} tz={p.tz} /></td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
      </Section>
      <Disclosure summary="Criar dataset vazio (sem importar agora)">
        <DatasetCreateForm canRestrict={p.perms.admin} />
      </Disclosure>
    </>
  );
}
