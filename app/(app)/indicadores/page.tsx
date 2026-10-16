import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { AGG_LABEL, FORMAT_LABEL, type Aggregation } from '@/lib/bi/engine';
import { loadDatasets, loadMetrics } from '@/lib/bi/data';
import { METRIC_STATUS_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { StatusBadge, TD, TH, TableShell } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Indicadores' };

export default async function MetricsPage() {
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const [metrics, datasets] = await Promise.all([loadMetrics(p.ctx), loadDatasets(p.ctx)]);
  const name = new Map(datasets.map((d) => [d.id, d.name]));
  const list = metrics.filter((m) => m.status !== 'archived');
  return (
    <>
      <PageHeader title="Indicadores" description="Definições reutilizáveis (soma, contagem, média, razão, variação…) separadas dos gráficos. Cada alteração cria uma versão; dashboards já montados só mudam quando você os atualiza.">
        <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" href="/indicadores/novo">Novo indicador</Link>
      </PageHeader>
      <TableShell caption="Indicadores" empty={list.length === 0} emptyText="Nenhum indicador ainda. Importe dados e crie o primeiro.">
        <thead><tr><th scope="col" className={TH}>Nome</th><th scope="col" className={TH}>Dataset</th><th scope="col" className={TH}>Cálculo</th><th scope="col" className={TH}>Formato</th><th scope="col" className={TH}>Versão</th><th scope="col" className={TH}>Situação</th></tr></thead>
        <tbody>{list.map((m) => (
          <tr key={m.id} className="border-t border-border">
            <td className={TD}><Link className="font-medium underline" href={`/indicadores/${m.id}`}>{m.name}</Link></td><td className={TD}>{name.get(m.dataset_id) ?? '—'}</td>
            <td className={TD}>{m.metric_type === 'formula' ? 'Fórmula' : AGG_LABEL[m.aggregation as Aggregation]}</td><td className={TD}>{FORMAT_LABEL[m.format_type]}</td><td className={TD}>v{m.current_version}</td>
            <td className={TD}><StatusBadge status={m.status} label={METRIC_STATUS_LABELS[m.status]} />{m.invalid_reason ? <p className="mt-1 text-xs text-danger">{m.invalid_reason}</p> : null}</td>
          </tr>
        ))}</tbody>
      </TableShell>
    </>
  );
}
