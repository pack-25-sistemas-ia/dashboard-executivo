import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { loadDatasets } from '@/lib/bi/data';
import { isUuid, one, type SearchParams } from '@/lib/bi/filters';
import { pageCtx } from '@/lib/bi/page';
import { ImportWizard } from '@/components/bi/import-wizard';

export const metadata: Metadata = { title: 'Nova importação' };

export default async function NewImportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const datasets = (await loadDatasets(p.ctx)).filter((d) => d.status === 'active');
  const wanted = one(sp.dataset);
  const initial = wanted && isUuid(wanted) && datasets.some((d) => d.id === wanted) ? wanted : null;
  return (
    <>
      <PageHeader title="Nova importação" description={`Importar → validar → organizar. Aceitamos CSV (vírgula, ponto e vírgula, tabulação) e XLSX, com até ${p.settings.max_rows.toLocaleString('pt-BR')} linhas, 100 colunas e ${p.settings.max_file_mb} MB. Números e datas no padrão brasileiro (1.234,56 e DD/MM/AAAA) são reconhecidos.`} />
      <ImportWizard datasets={datasets.map((d) => ({ id: d.id, name: d.name, hasData: Boolean(d.current_version_id) }))} initialDataset={initial} maxMb={p.settings.max_file_mb} />
    </>
  );
}
