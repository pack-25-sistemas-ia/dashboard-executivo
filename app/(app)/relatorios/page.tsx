import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { loadDashboards, loadDatasets, loadExports } from '@/lib/bi/data';
import { pageCtx } from '@/lib/bi/page';
import { DateTimeBR, Section, TD, TDR, TH, THR, TableShell } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Relatórios' };
const TYPE: Record<string, string> = { dashboard_csv: 'Dashboard (CSV)', dataset_csv: 'Linhas do dataset (CSV)', metric_detail_csv: 'Detalhe de indicador (CSV)' };

export default async function ReportsPage() {
  const p = await pageCtx();
  const [dashboards, exports, datasets] = await Promise.all([loadDashboards(p.ctx), loadExports(p.ctx), p.perms.analyst ? loadDatasets(p.ctx) : Promise.resolve([])]);
  const dName = new Map(dashboards.map((d) => [d.id, d.name]));
  const sName = new Map(datasets.map((d) => [d.id, d.name]));
  return (
    <>
      <PageHeader title="Central de relatórios" description="Exporte o que você já pode ver. A exportação nunca traz mais dados do que a tela, respeita o período e os filtros escolhidos, é neutralizada contra fórmulas de planilha e fica registrada." />
      <Section title="Dashboards publicados e seus" description="Abra o dashboard, escolha período e filtros e use «Exportar CSV» ou «Imprimir / salvar em PDF» (o PDF é gerado pelo navegador, com título, período, data de geração e fonte dos dados).">
        <TableShell caption="Dashboards" empty={dashboards.length === 0} emptyText="Nenhum dashboard disponível.">
          <thead><tr><th scope="col" className={TH}>Dashboard</th><th scope="col" className={TH}>Exportar (período padrão)</th></tr></thead>
          <tbody>{dashboards.map((d) => <tr key={d.id} className="border-t border-border"><td className={TD}><Link className="underline" href={`/dashboards/${d.id}`}>{d.name}</Link></td><td className={TD}><a className="underline" href={`/api/export/dashboard/${d.id}`} download>CSV</a></td></tr>)}</tbody>
        </TableShell>
      </Section>
      {p.perms.manager ? (
        <Section title="Linhas de dataset" description="Exportação bruta (gestores e administradores). Use o explorador para aplicar filtros antes.">
          <ul className="space-y-1 text-sm">{datasets.filter((d) => d.current_version_id).map((d) => <li key={d.id}><Link className="underline" href={`/explorador?dataset=${d.id}`}>{d.name}</Link></li>)}</ul>
        </Section>
      ) : null}
      <Section title="Histórico de exportações" description={p.perms.admin ? 'Todas as exportações da empresa.' : 'Suas exportações.'}>
        <TableShell caption="Exportações" empty={exports.length === 0} emptyText="Nenhuma exportação ainda.">
          <thead><tr><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Origem</th><th scope="col" className={THR}>Linhas</th><th scope="col" className={TH}>Em</th></tr></thead>
          <tbody>{exports.map((e) => <tr key={e.id} className="border-t border-border"><td className={TD}>{TYPE[e.report_type] ?? e.report_type}</td><td className={TD}>{(e.dashboard_id && dName.get(e.dashboard_id)) || (e.dataset_id && sName.get(e.dataset_id)) || '—'}</td><td className={TDR}>{e.row_count.toLocaleString('pt-BR')}</td><td className={TD}><DateTimeBR value={e.created_at} tz={p.tz} /></td></tr>)}</tbody>
        </TableShell>
        <p className="mt-2 text-xs text-muted">Os arquivos são gerados na hora e não ficam guardados nem têm link público: não há o que vazar depois. O registro guarda só tipo, origem e número de linhas.</p>
      </Section>
    </>
  );
}
