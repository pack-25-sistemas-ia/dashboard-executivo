import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { AGG_LABEL, FORMAT_LABEL, OP_LABEL, compileMetric, evaluate, formatValue, normalizeCount, type Aggregation, type FormulaNode } from '@/lib/bi/engine';
import { loadColumns, loadDataset, loadMetrics, metricDefs, toEngineColumns } from '@/lib/bi/data';
import { isUuid, one, type SearchParams } from '@/lib/bi/filters';
import { METRIC_STATUS_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { archiveMetric } from '@/lib/bi/actions/models';
import { ActionButton } from '@/components/bi/fields';
import { DateTimeBR, Section, StatusBadge, TD, TH, TableShell } from '@/components/bi/bits';
import { MetricForm, type MfDataset, type MfInitial } from '@/components/bi/metric-form';

export const metadata: Metadata = { title: 'Indicador' };

function astText(n: FormulaNode, names: Map<string, string>): string {
  if (n.op === 'num') return n.value;
  if (n.op === 'ref') return `«${names.get(n.metric) ?? '?'}»`;
  return `(${astText(n.l, names)} ${{ add: '+', sub: '−', mul: '×', div: '÷' }[n.op]} ${astText(n.r, names)})`;
}
function flatten(n: FormulaNode, terms: MfInitial['terms'] = [], ops: MfInitial['ops'] = []): { terms: MfInitial['terms']; ops: MfInitial['ops'] } | null {
  // reconstrói a cadeia da esquerda para a direita; árvores fora desse formato abrem como «somente leitura» (sem editor)
  if (n.op === 'num') { terms.unshift({ kind: 'number', value: n.value }); return { terms, ops }; }
  if (n.op === 'ref') { terms.unshift({ kind: 'metric', value: n.metric }); return { terms, ops }; }
  if (n.r.op !== 'num' && n.r.op !== 'ref') return null;
  terms.unshift(n.r.op === 'num' ? { kind: 'number', value: n.r.value } : { kind: 'metric', value: n.r.metric });
  ops.unshift(n.op);
  return flatten(n.l, terms, ops);
}

export default async function MetricPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const p = await pageCtx();
  const all = await loadMetrics(p.ctx);
  const m = all.find((x) => x.id === id);
  const fromDash = one(sp.dashboard);
  if (!m) {
    // quem só visualiza não lê definições (RLS): mostra o que o widget guarda, sem dados de negócio
    if (!p.perms.analyst && fromDash && isUuid(fromDash)) {
      return (<><PageHeader title="Origem do indicador" /><Alert tone="info">A definição completa (fórmula, filtros e registros) é visível para analistas e gestores. A fonte, a versão do dataset e a data de atualização aparecem no rodapé de cada widget do dashboard.</Alert><Link className="underline" href={`/dashboards/${fromDash}`}>Voltar ao dashboard</Link></>);
    }
    notFound();
  }
  const ds = await loadDataset(p.ctx, m.dataset_id);
  const colRows = await loadColumns(p.ctx, ds?.current_version_id ?? null);
  const cols = toEngineColumns(colRows);
  const colName = new Map(colRows.map((c) => [c.column_key, c.display_name]));
  const names = new Map(all.map((x) => [x.id, x.name]));
  const defs = metricDefs(all.filter((x) => x.dataset_id === m.dataset_id));
  let sample: string = '—'; let sampleNote = '';
  if (m.status === 'active' && ds?.current_version_id) {
    try {
      const c = compileMetric(m.id, defs, cols);
      const { data } = await p.ctx.supabase.rpc('bi_run_query', { p_org: p.org, p_spec: { dataset_id: m.dataset_id, measures: c.measures } });
      const row = (data as { rows: Array<Record<string, string | null>> } | null)?.rows?.[0];
      if (row) { const v = evaluate(c.expr, normalizeCount(Object.fromEntries(c.measures.map((x) => [x.alias, row[x.alias] ?? null])), c.measures)); sample = v.state === 'ok' ? formatValue(v.value, m.format_type) : 'indisponível'; sampleNote = v.state === 'div_zero' ? 'denominador zero' : v.state === 'no_data' ? 'sem dados' : ''; }
    } catch { sample = '—'; }
  }
  const { data: versions } = await p.ctx.supabase.from('metric_versions').select('version_number, created_at, definition_snapshot_json').eq('metric_id', id).order('version_number', { ascending: false }).limit(20);
  const dsRows = (await Promise.resolve(ds ? [ds] : [])).filter((d) => d.current_version_id);
  const datasets: MfDataset[] = dsRows.map((d) => ({ id: d.id, name: d.name, columns: colRows.map((c) => ({ key: c.column_key, name: c.display_name, type: c.data_type })), metrics: all.filter((x) => x.dataset_id === d.id && x.status === 'active').map((x) => ({ id: x.id, name: x.name })) }));
  const flat = m.metric_type === 'formula' ? flatten(m.formula_ast_json as FormulaNode) : null;
  const initial: MfInitial = {
    id: m.id, datasetId: m.dataset_id, name: m.name, description: m.description ?? '', type: m.metric_type, aggregation: (m.aggregation ?? 'sum') as Aggregation, field: m.field_key ?? '', format: m.format_type, unit: m.unit ?? '', filters: m.filters_json ?? [],
    terms: flat?.terms ?? [{ kind: 'metric', value: '' }, { kind: 'metric', value: '' }], ops: flat?.ops ?? ['div'],
  };
  const canEditHere = p.perms.analyst && datasets.length > 0 && (m.metric_type === 'aggregation' || flat !== null);

  return (
    <>
      <PageHeader title={m.name} description={m.description ?? undefined}>
        <div className="flex items-center gap-2"><StatusBadge status={m.status} label={METRIC_STATUS_LABELS[m.status]} /><span className="text-sm text-muted">v{m.current_version}</span>{fromDash && isUuid(fromDash) ? <Link className="text-sm underline" href={`/dashboards/${fromDash}`}>Voltar ao dashboard</Link> : null}</div>
      </PageHeader>
      {m.invalid_reason ? <Alert tone="error">Indicador inválido: {m.invalid_reason}. Ajuste a definição ou reimporte os dados com as colunas necessárias.</Alert> : null}
      <Section title="De onde vem este número" description="Rastreabilidade: dataset, versão dos dados, fórmula e filtros — para conferir por que o indicador tem este valor.">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-muted">Dataset</dt><dd className="font-medium">{ds ? <Link className="underline" href={`/datasets/${ds.id}`}>{ds.name}</Link> : '—'}</dd></div>
          <div><dt className="text-xs text-muted">Cálculo</dt><dd className="font-medium">{m.metric_type === 'formula' ? 'Fórmula' : `${AGG_LABEL[m.aggregation as Aggregation]}${m.field_key ? ` de «${colName.get(m.field_key) ?? m.field_key}»` : ' das linhas'}`}</dd></div>
          <div><dt className="text-xs text-muted">Formato</dt><dd className="font-medium">{FORMAT_LABEL[m.format_type]}{m.unit ? ` · ${m.unit}` : ''}</dd></div>
          <div><dt className="text-xs text-muted">Valor com todos os dados</dt><dd className="text-xl font-semibold tabular-nums" data-testid="metric-sample">{sample}{sampleNote ? <span className="ml-1 text-sm font-normal text-muted">({sampleNote})</span> : null}</dd></div>
        </dl>
        {m.metric_type === 'formula' ? <p className="mt-3 text-sm">Fórmula: <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10" data-testid="formula-text">{astText(m.formula_ast_json as FormulaNode, names)}</code></p> : null}
        {m.filters_json?.length ? <ul className="mt-3 list-disc pl-5 text-sm">{m.filters_json.map((f, i) => <li key={i}>{colName.get(f.field) ?? f.field} {OP_LABEL[f.op]}{f.value !== undefined ? ` ${String(f.value)}` : ''}{f.values ? ` ${f.values.join(', ')}` : ''}{f.to ? ` e ${f.to}` : ''}</li>)}</ul> : null}
        {ds ? <p className="mt-3 text-sm"><Link className="underline" href={`/explorador?dataset=${ds.id}`}>Ver os registros do dataset</Link></p> : null}
      </Section>
      {canEditHere ? <Section title="Editar" description="Salvar cria uma NOVA versão. Dashboards já montados continuam na versão anterior até você abrir o editor e atualizá-los."><MetricForm datasets={datasets} initial={initial} /></Section> : null}
      <Section title="Versões">
        <TableShell caption="Versões do indicador" empty={!versions?.length}>
          <thead><tr><th scope="col" className={TH}>Versão</th><th scope="col" className={TH}>Criada em</th><th scope="col" className={TH}>Definição</th></tr></thead>
          <tbody>{(versions ?? []).map((v) => { const s = (v as { definition_snapshot_json: { aggregation?: string; type: string; field?: string } }).definition_snapshot_json; return <tr key={(v as { version_number: number }).version_number} className="border-t border-border"><td className={TD}>v{(v as { version_number: number }).version_number}</td><td className={TD}><DateTimeBR value={(v as { created_at: string }).created_at} tz={p.tz} /></td><td className={TD}>{s.type === 'formula' ? 'Fórmula' : `${AGG_LABEL[s.aggregation as Aggregation]}${s.field ? ` de «${colName.get(s.field) ?? s.field}»` : ''}`}</td></tr>; })}</tbody>
        </TableShell>
      </Section>
      {p.perms.analyst ? <ActionButton action={archiveMetric} fields={m.status === 'archived' ? { id, restore: 'true' } : { id }} label={m.status === 'archived' ? 'Restaurar indicador' : 'Arquivar indicador'} variant={m.status === 'archived' ? 'secondary' : 'danger'} confirm={m.status === 'archived' ? undefined : 'Arquivar? Fórmulas e metas que o usam impedem o arquivamento.'} /> : null}
    </>
  );
}
