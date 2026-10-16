import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { loadColumns, loadDataset, loadImport } from '@/lib/bi/data';
import { IMPORT_MODE_LABELS, IMPORT_STATUS_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { cancelImport } from '@/lib/bi/actions/imports';
import { ActionButton } from '@/components/bi/fields';
import { DateTimeBR, Section, StatusBadge, TD, TH, TableShell } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Importação' };

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const data = await loadImport(p.ctx, id);
  if (!data) notFound();
  const { job, errors } = data;
  const ds = await loadDataset(p.ctx, job.dataset_id);
  const cols = await loadColumns(p.ctx, job.dataset_version_id);
  const colName = new Map(cols.map((c) => [c.column_key, c.display_name]));
  return (
    <>
      <PageHeader title={job.file_name} description={`${IMPORT_MODE_LABELS[job.import_mode]} · ${job.file_type.toUpperCase()} · dataset ${ds?.name ?? '—'}`}>
        <StatusBadge status={job.status} label={IMPORT_STATUS_LABELS[job.status] ?? job.status} />
      </PageHeader>
      {job.error_message ? <Alert tone="error">{job.error_message}</Alert> : null}
      {job.status === 'ready' ? <Alert tone="warning">Esta importação foi validada, mas não publicada. Para concluir, refaça-a em <Link className="underline" href={`/importacoes/nova?dataset=${job.dataset_id}`}>Nova importação</Link> ou cancele aqui.</Alert> : null}
      <dl className="mb-6 grid gap-3 sm:grid-cols-5">
        <div><dt className="text-xs text-muted">Linhas no arquivo</dt><dd className="text-xl font-semibold tabular-nums">{job.total_rows.toLocaleString('pt-BR')}</dd></div>
        <div><dt className="text-xs text-muted">Válidas</dt><dd className="text-xl font-semibold tabular-nums">{job.valid_rows.toLocaleString('pt-BR')}</dd></div>
        <div><dt className="text-xs text-muted">Com erro</dt><dd className="text-xl font-semibold tabular-nums">{job.invalid_rows.toLocaleString('pt-BR')}</dd></div>
        <div><dt className="text-xs text-muted">Ignoradas (já existiam)</dt><dd className="text-xl font-semibold tabular-nums">{job.skipped_existing.toLocaleString('pt-BR')}</dd></div>
        <div><dt className="text-xs text-muted">Iniciada em</dt><dd className="text-sm font-semibold"><DateTimeBR value={job.created_at} tz={p.tz} /></dd></div>
      </dl>
      {job.notes?.length ? <ul className="mb-4 space-y-1 text-sm text-muted">{job.notes.map((n, i) => <li key={i}>ℹ {n}</li>)}</ul> : null}
      <Section title="Erros por linha" description="Linha do arquivo, coluna, motivo e o valor rejeitado (limitado a 80 caracteres). Linhas com erro nunca são descartadas em silêncio.">
        {errors.length ? (
          <>
            <TableShell caption="Erros por linha">
              <thead><tr><th scope="col" className={TH}>Linha</th><th scope="col" className={TH}>Coluna</th><th scope="col" className={TH}>Motivo</th><th scope="col" className={TH}>Valor rejeitado</th></tr></thead>
              <tbody>{errors.slice(0, 200).map((e, i) => <tr key={i} className="border-t border-border"><td className={`${TD} tabular-nums`}>{e.row_number}</td><td className={TD}>{e.column_key ? colName.get(e.column_key) ?? e.column_key : '—'}</td><td className={TD}>{e.error_message}</td><td className={TD}>{e.rejected_value ?? '—'}</td></tr>)}</tbody>
            </TableShell>
            <p className="mt-2 text-sm"><a className="underline" href={`/api/importacoes/${id}/erros`}>Baixar o relatório completo (CSV)</a>{errors.length >= 1000 ? ' · registramos até 1.000 erros; o total real está em «Com erro».' : ''}</p>
          </>
        ) : <p className="text-sm text-muted">Nenhum erro registrado.</p>}
      </Section>
      {job.status === 'ready' || job.status === 'processing' ? <ActionButton action={cancelImport} fields={{ id }} label="Cancelar importação" variant="danger" confirm="Cancelar e descartar as linhas preparadas?" /> : null}
    </>
  );
}
