import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { loadColumns, loadDatasets, loadMetrics } from '@/lib/bi/data';
import { pageCtx } from '@/lib/bi/page';
import { TemplateForm, type TfDataset } from '@/components/bi/template-form';

export const metadata: Metadata = { title: 'Novo dashboard' };

export default async function NewDashboardPage() {
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/dashboards');
  const dsRows = (await loadDatasets(p.ctx)).filter((d) => d.status === 'active' && d.current_version_id);
  const metrics = await loadMetrics(p.ctx);
  const datasets: TfDataset[] = await Promise.all(dsRows.map(async (d) => ({
    id: d.id, name: d.name, columns: (await loadColumns(p.ctx, d.current_version_id)).map((c) => ({ key: c.column_key, name: c.display_name, type: c.data_type })),
    metrics: metrics.filter((m) => m.dataset_id === d.id && m.status === 'active').map((m) => ({ id: m.id, name: m.name })),
  })));
  return (
    <>
      <PageHeader title="Novo dashboard a partir de um modelo" description="Os modelos são pontos de partida editáveis. Cada um diz de quais campos precisa; se o dataset não tem esses campos, o modelo é incompatível — não adivinhamos colunas." />
      {datasets.length === 0 ? <Alert tone="info">Importe dados em um dataset antes. Você também pode criar um dashboard em branco na lista de dashboards.</Alert> : <TemplateForm datasets={datasets} />}
    </>
  );
}
