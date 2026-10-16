import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { loadColumns, loadDatasets, loadMetrics } from '@/lib/bi/data';
import { isUuid, one, type SearchParams } from '@/lib/bi/filters';
import { pageCtx } from '@/lib/bi/page';
import { MetricForm, type MfDataset } from '@/components/bi/metric-form';

export const metadata: Metadata = { title: 'Novo indicador' };

export default async function NewMetricPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const dsRows = (await loadDatasets(p.ctx)).filter((d) => d.status === 'active' && d.current_version_id);
  if (!dsRows.length) return (<><PageHeader title="Novo indicador" /><Alert tone="info">Importe dados em um dataset antes de criar indicadores.</Alert></>);
  const metrics = await loadMetrics(p.ctx);
  const datasets: MfDataset[] = await Promise.all(dsRows.map(async (d) => ({
    id: d.id, name: d.name, columns: (await loadColumns(p.ctx, d.current_version_id)).map((c) => ({ key: c.column_key, name: c.display_name, type: c.data_type })),
    metrics: metrics.filter((m) => m.dataset_id === d.id && m.status === 'active').map((m) => ({ id: m.id, name: m.name })),
  })));
  const wanted = one(sp.dataset);
  const ds = datasets.find((d) => d.id === wanted && isUuid(wanted)) ?? datasets[0]!;
  return (
    <>
      <PageHeader title="Novo indicador" description="Escolha o dataset, a conta e o formato. Você não precisa escrever SQL: o sistema monta a consulta de forma segura." />
      <MetricForm datasets={datasets} initial={{ id: null, datasetId: ds.id, name: '', description: '', type: 'aggregation', aggregation: 'sum', field: '', format: 'currency', unit: '', filters: [], terms: [{ kind: 'metric', value: '' }, { kind: 'metric', value: '' }], ops: ['div'] }} />
    </>
  );
}
