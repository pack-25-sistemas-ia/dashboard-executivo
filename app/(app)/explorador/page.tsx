import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, Button, Input, PageHeader, Select } from '@/components/ui/primitives';
import { OP_LABEL, formatValue, operatorsFor, typeLabel } from '@/lib/bi/engine';
import { loadColumns, loadDataset, loadDatasets, loadViews, type ColumnRow } from '@/lib/bi/data';
import { dbMessage } from '@/lib/bi/action-kit';
import { buildFilters, FILTER_SLOTS as SLOTS } from '@/lib/bi/explorer';
import { isUuid, one, pageFrom, withParams, type SearchParams } from '@/lib/bi/filters';
import { pageCtx } from '@/lib/bi/page';
import { deleteView } from '@/lib/bi/actions/misc';
import { ActionButton } from '@/components/bi/fields';
import { SaveViewForm } from '@/components/bi/forms';
import { Disclosure, Pagination, Section, TD, TH, TableShell } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Explorador de dados' };
const SIZE = 25;


export default async function ExplorerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const datasets = (await loadDatasets(p.ctx)).filter((d) => d.status === 'active' && d.current_version_id);
  const wanted = one(sp.dataset);
  const ds = wanted && isUuid(wanted) ? await loadDataset(p.ctx, wanted) : null;
  const header = (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3" aria-label="Escolher dataset">
      <div><label htmlFor="dataset" className="mb-1 block text-xs font-medium text-muted">Dataset</label><Select id="dataset" name="dataset" defaultValue={ds?.id ?? ''} className="w-64"><option value="">Escolha…</option>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <Button type="submit">Abrir</Button>
    </form>
  );
  if (!ds || !ds.current_version_id) return (<><PageHeader title="Explorador de dados" description="Veja as linhas de um dataset com filtros, ordenação e paginação feitos no servidor (nunca enviamos o dataset inteiro ao navegador)." />{header}<p className="text-sm text-muted">Escolha um dataset com dados publicados.</p></>);

  const cols = await loadColumns(p.ctx, ds.current_version_id);
  const filters = buildFilters(sp, cols);
  const page = pageFrom(one(sp.page));
  const sortRaw = one(sp.sort); const sort = cols.some((c) => c.column_key === sortRaw) ? sortRaw : null; const dir = one(sp.dir) === 'desc' ? 'desc' : 'asc';
  const views = await loadViews(p.ctx, ds.id);
  const { data, error } = await p.ctx.supabase.rpc('bi_dataset_rows', { p_org: p.org, p_dataset: ds.id, p_filters: filters, p_period: null, p_sort: sort, p_dir: dir, p_page: page, p_size: SIZE, p_for_export: false });
  const res = data as { rows: Array<{ n: number; v: Record<string, string | boolean | null> }>; total: number; version_number: number } | null;
  const shown = cols.slice(0, 12);
  const fmt = (c: ColumnRow, v: string | boolean | null | undefined) => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
    if (c.data_type === 'currency') return formatValue(v, 'currency');
    if (c.data_type === 'percentage') return formatValue(v, 'percentage');
    if (c.data_type === 'integer') return formatValue(v, 'integer');
    if (c.data_type === 'decimal') return formatValue(v, 'decimal', { decimals: 4 }).replace(/,?0+$/, '');
    if (c.data_type === 'date') return v.split('-').reverse().join('/');
    if (c.data_type === 'timestamp') return new Intl.DateTimeFormat('pt-BR', { timeZone: p.tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(v));
    return v;
  };
  const sortLink = (k: string) => withParams('/explorador', sp, { sort: k, dir: sort === k && dir === 'asc' ? 'desc' : 'asc', page: null });
  const qs = new URLSearchParams(); for (const [k, v] of Object.entries(sp)) { const x = one(v); if (x && /^(dataset|f\d|o\d|v\d|sort|dir)$/.test(k)) qs.set(k, x); }

  return (
    <>
      <PageHeader title="Explorador de dados" description={`${ds.name} · versão ${res?.version_number ?? '—'} · ${(res?.total ?? 0).toLocaleString('pt-BR')} linha(s) com os filtros atuais.`}>
        <Link className="text-sm underline" href={`/datasets/${ds.id}`}>Ver dataset</Link>
      </PageHeader>
      {header}
      <form method="get" className="mb-4 space-y-2 rounded-lg border border-border bg-card p-3" aria-label="Filtros">
        <input type="hidden" name="dataset" value={ds.id} />
        {SLOTS.map((n) => (
          <div key={n} className="flex flex-wrap items-end gap-2">
            <div><label htmlFor={`f${n}`} className="mb-1 block text-xs font-medium text-muted">Filtro {n}: coluna</label><Select id={`f${n}`} name={`f${n}`} defaultValue={one(sp[`f${n}`]) ?? ''} className="w-48"><option value="">—</option>{cols.map((c) => <option key={c.column_key} value={c.column_key}>{c.display_name}</option>)}</Select></div>
            <div><label htmlFor={`o${n}`} className="mb-1 block text-xs font-medium text-muted">Operador</label><Select id={`o${n}`} name={`o${n}`} defaultValue={one(sp[`o${n}`]) ?? 'eq'} className="w-44">{(['eq', 'neq', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'] as const).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</Select></div>
            <div><label htmlFor={`v${n}`} className="mb-1 block text-xs font-medium text-muted">Valor</label><Input id={`v${n}`} name={`v${n}`} defaultValue={one(sp[`v${n}`]) ?? ''} className="w-56" placeholder="«a|b» para lista ou intervalo" /></div>
          </div>
        ))}
        <p className="text-xs text-muted">Datas no formato AAAA-MM-DD. Em lista (A|B|C) e entre (início|fim) separe os valores com «|». Tipos aceitos por operador: {cols.slice(0, 1).map((c) => `${typeLabel(c.data_type)}: ${operatorsFor(c.data_type).length} operadores`).join('')}…</p>
        <div className="flex gap-2"><Button type="submit">Filtrar</Button><Link className="inline-flex min-h-10 items-center px-2 text-sm text-muted underline" href={`/explorador?dataset=${ds.id}`}>Limpar</Link></div>
      </form>
      {error ? <Alert tone="error">{dbMessage(error)}</Alert> : null}
      {res ? (
        <>
          <TableShell caption={`Linhas de ${ds.name}`} empty={res.rows.length === 0} emptyText="Nenhuma linha com estes filtros.">
            <thead><tr><th scope="col" className={TH}>Linha</th>{shown.map((c) => <th key={c.column_key} scope="col" className={TH} aria-sort={sort === c.column_key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}><Link href={sortLink(c.column_key)} className="underline-offset-2 hover:underline">{c.display_name}{sort === c.column_key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</Link></th>)}</tr></thead>
            <tbody>{res.rows.map((r) => <tr key={r.n} className="border-t border-border"><td className={`${TD} tabular-nums text-muted`}>{r.n}</td>{shown.map((c) => <td key={c.column_key} className={`${TD} whitespace-nowrap`}>{fmt(c, r.v[c.column_key])}</td>)}</tr>)}</tbody>
          </TableShell>
          {cols.length > shown.length ? <p className="mt-1 text-xs text-muted">Mostrando as primeiras {shown.length} de {cols.length} colunas.</p> : null}
          <Pagination base="/explorador" sp={sp} page={page} total={res.total} size={SIZE} />
        </>
      ) : null}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Section title="Visões salvas" description="Guardam filtros, colunas e ordenação para reabrir depois.">
          <ul className="mb-3 space-y-1 text-sm">{views.map((v) => {
            const q = new URLSearchParams({ dataset: ds.id }); v.filters_json.forEach((f, i) => { if (i < 3) { q.set(`f${i + 1}`, f.field); q.set(`o${i + 1}`, f.op); q.set(`v${i + 1}`, f.op === 'in' ? (f.values ?? []).join('|') : f.op === 'between' ? `${f.value}|${f.to}` : String(f.value ?? '')); } }); if (v.sorting_json[0]) { q.set('sort', v.sorting_json[0].field); q.set('dir', v.sorting_json[0].dir); }
            return <li key={v.id} className="flex items-center justify-between gap-2"><Link className="underline" href={`/explorador?${q.toString()}`}>{v.name}</Link><ActionButton action={deleteView} fields={{ id: v.id }} label="Remover" variant="danger" confirm="Remover a visão?" /></li>;
          })}{views.length === 0 ? <li className="text-muted">Nenhuma visão salva.</li> : null}</ul>
          <Disclosure summary="Salvar visão atual">
            <SaveViewForm datasetId={ds.id} filters={JSON.stringify(filters)} columns={JSON.stringify(shown.map((c) => c.column_key))} sorting={JSON.stringify(sort ? [{ field: sort, dir }] : [])} />
          </Disclosure>
        </Section>
        {p.perms.manager ? (
          <Section title="Exportar" description="Exporta as linhas com os filtros atuais em CSV (neutralizado contra fórmulas). A exportação é registrada na auditoria.">
            <a className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-medium" href={`/api/export/dataset/${ds.id}?${qs.toString()}`} download>Exportar CSV</a>
          </Section>
        ) : null}
      </div>
    </>
  );
}
