import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { loadDatasets, loadImports } from '@/lib/bi/data';
import { IMPORT_MODE_LABELS, IMPORT_STATUS_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { DateTimeBR, StatusBadge, TD, TDR, TH, THR, TableShell } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Importações' };

export default async function ImportsPage() {
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const [jobs, datasets] = await Promise.all([loadImports(p.ctx, undefined, 50), loadDatasets(p.ctx)]);
  const name = new Map(datasets.map((d) => [d.id, d.name]));
  return (
    <>
      <PageHeader title="Importações" description="Histórico de cargas de dados: quem, quando, quantas linhas e o que foi rejeitado. Importações com erro nunca alteram a versão ativa do dataset.">
        <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" href="/importacoes/nova">Nova importação</Link>
      </PageHeader>
      <TableShell caption="Importações" empty={jobs.length === 0} emptyText="Nenhuma importação ainda. Comece enviando um arquivo CSV ou XLSX.">
        <thead><tr><th scope="col" className={TH}>Arquivo</th><th scope="col" className={TH}>Dataset</th><th scope="col" className={TH}>Modo</th><th scope="col" className={TH}>Situação</th><th scope="col" className={THR}>Linhas</th><th scope="col" className={THR}>Válidas</th><th scope="col" className={THR}>Com erro</th><th scope="col" className={TH}>Em</th></tr></thead>
        <tbody>{jobs.map((j) => (
          <tr key={j.id} className="border-t border-border">
            <td className={TD}><Link className="underline" href={`/importacoes/${j.id}`}>{j.file_name}</Link> <span className="text-xs uppercase text-muted">{j.file_type}</span></td>
            <td className={TD}>{name.get(j.dataset_id) ?? '—'}</td><td className={TD}>{IMPORT_MODE_LABELS[j.import_mode]}</td>
            <td className={TD}><StatusBadge status={j.status} label={IMPORT_STATUS_LABELS[j.status] ?? j.status} /></td>
            <td className={TDR}>{j.total_rows.toLocaleString('pt-BR')}</td><td className={TDR}>{j.valid_rows.toLocaleString('pt-BR')}</td><td className={TDR}>{j.invalid_rows.toLocaleString('pt-BR')}</td>
            <td className={TD}><DateTimeBR value={j.created_at} tz={p.tz} /></td>
          </tr>
        ))}</tbody>
      </TableShell>
    </>
  );
}
