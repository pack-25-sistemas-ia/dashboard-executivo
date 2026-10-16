import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { dbMessage } from '@/lib/bi/action-kit';
import { IMPORT_MODE_LABELS, IMPORT_STATUS_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { checkFreshness } from '@/lib/bi/actions/misc';
import { DateTimeBR, Kpi, Section, StatusBadge, TD, TDR, TH, THR, TableShell } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Qualidade dos dados' };

type Q = {
  stale_days: number;
  datasets: Array<{ id: string; name: string; status: string; restricted: boolean; version: number | null; rows: number | null; published_at: string | null; stale: boolean; rejected_last: number; skipped_last: number; failed_imports_30d: number; invalid_metrics: number; nulls: Record<string, number> | null; columns: Array<{ key: string; name: string; type: string }> }>;
  recent_imports: Array<{ id: string; dataset: string; file_name: string; file_type: string; mode: string; status: string; total: number; valid: number; invalid: number; skipped: number; created_at: string; error: string | null }>;
};

export default async function QualityPage() {
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  await checkFreshness();
  const { data, error } = await p.ctx.supabase.rpc('bi_quality_overview', { p_org: p.org });
  const q = data as Q | null;
  if (error || !q) return <PageHeader title="Qualidade dos dados" description={error ? dbMessage(error) : 'Sem dados.'} />;
  const active = q.datasets.filter((d) => d.status === 'active');
  const stale = active.filter((d) => d.stale).length;
  const failedTotal = q.datasets.reduce((s, d) => s + d.failed_imports_30d, 0);
  const rejected = q.datasets.reduce((s, d) => s + d.rejected_last, 0);
  const invalidM = q.datasets.reduce((s, d) => s + d.invalid_metrics, 0);
  return (
    <>
      <PageHeader title="Qualidade dos dados" description={`Mostra o que está desatualizado, rejeitado ou incompleto, para que ninguém decida com dado velho sem perceber. «Desatualizado» = sem nova versão há mais de ${q.stale_days} dias (configurável). Não usamos nota única: cada sinal aparece separado.`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Datasets ativos" value={active.length} />
        <Kpi label="Desatualizados" value={stale} tone={stale ? 'warning' : 'success'} />
        <Kpi label="Importações com erro (30 dias)" value={failedTotal} tone={failedTotal ? 'danger' : 'success'} />
        <Kpi label="Linhas rejeitadas (última carga)" value={rejected.toLocaleString('pt-BR')} tone={rejected ? 'warning' : 'success'} />
        <Kpi label="Indicadores inválidos" value={invalidM} tone={invalidM ? 'danger' : 'success'} />
      </div>
      <Section title="Datasets">
        <TableShell caption="Qualidade por dataset" empty={q.datasets.length === 0}>
          <thead><tr><th scope="col" className={TH}>Dataset</th><th scope="col" className={TH}>Atualização</th><th scope="col" className={THR}>Linhas</th><th scope="col" className={THR}>Rejeitadas</th><th scope="col" className={THR}>Ignoradas</th><th scope="col" className={THR}>Indic. inválidos</th><th scope="col" className={TH}>Colunas com vazios</th></tr></thead>
          <tbody>{q.datasets.map((d) => {
            const worst = d.nulls && d.rows ? Object.entries(d.nulls).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
            return (
              <tr key={d.id} className="border-t border-border">
                <td className={TD}><Link className="underline" href={`/datasets/${d.id}`}>{d.name}</Link>{d.restricted ? <> <Badge tone="warning">Restrito</Badge></> : null}</td>
                <td className={TD}>{d.status === 'archived' ? <Badge>Arquivado</Badge> : d.version === null ? <Badge tone="warning">Sem dados</Badge> : <><DateTimeBR value={d.published_at} tz={p.tz} /> {d.stale ? <Badge tone="warning">Desatualizado</Badge> : <Badge tone="success">Em dia</Badge>}</>}</td>
                <td className={TDR}>{d.rows?.toLocaleString('pt-BR') ?? '—'}</td><td className={TDR}>{d.rejected_last}</td><td className={TDR}>{d.skipped_last}</td><td className={TDR}>{d.invalid_metrics}</td>
                <td className={TD}>{worst.length ? worst.map(([k, n]) => `${d.columns.find((c) => c.key === k)?.name ?? k}: ${n.toLocaleString('pt-BR')} (${((n / (d.rows ?? 1)) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)`).join(' · ') : 'Nenhuma'}</td>
              </tr>
            );
          })}</tbody>
        </TableShell>
      </Section>
      <Section title="Histórico recente de importações">
        <TableShell caption="Importações recentes" empty={q.recent_imports.length === 0}>
          <thead><tr><th scope="col" className={TH}>Arquivo</th><th scope="col" className={TH}>Dataset</th><th scope="col" className={TH}>Modo</th><th scope="col" className={TH}>Situação</th><th scope="col" className={THR}>Válidas</th><th scope="col" className={THR}>Erros</th><th scope="col" className={TH}>Em</th></tr></thead>
          <tbody>{q.recent_imports.map((i) => <tr key={i.id} className="border-t border-border"><td className={TD}><Link className="underline" href={`/importacoes/${i.id}`}>{i.file_name}</Link></td><td className={TD}>{i.dataset}</td><td className={TD}>{IMPORT_MODE_LABELS[i.mode]}</td><td className={TD}><StatusBadge status={i.status} label={IMPORT_STATUS_LABELS[i.status] ?? i.status} /></td><td className={TDR}>{i.valid.toLocaleString('pt-BR')}</td><td className={TDR}>{i.invalid.toLocaleString('pt-BR')}</td><td className={TD}><DateTimeBR value={i.created_at} tz={p.tz} /></td></tr>)}</tbody>
        </TableShell>
      </Section>
    </>
  );
}
