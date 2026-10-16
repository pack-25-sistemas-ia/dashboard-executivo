'use client';

import { useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Alert, Input, Select, Textarea } from '@/components/ui/primitives';
import { setFilterValue, filterText } from '@/lib/bi/filter-edit';
import { saveMetric } from '@/lib/bi/actions/models';
import { AGG_LABEL, AGGREGATIONS, FORMAT_LABEL, FORMATS, OP_LABEL, aggAllowed, isNumeric, operatorsFor, typeLabel, type Aggregation, type DataType, type Filter, type FilterOp, type FormatType } from '@/lib/bi/engine';
import { useBiAction } from './use-bi-action';

export type MfColumn = { key: string; name: string; type: DataType };
export type MfDataset = { id: string; name: string; columns: MfColumn[]; metrics: Array<{ id: string; name: string }> };
export type MfInitial = {
  id: string | null; datasetId: string; name: string; description: string; type: 'aggregation' | 'formula'; aggregation: Aggregation; field: string; format: FormatType; unit: string; filters: Filter[];
  terms: Array<{ kind: 'metric' | 'number'; value: string }>; ops: Array<'add' | 'sub' | 'mul' | 'div'>;
};
const OPS: Record<string, string> = { add: '+', sub: '−', mul: '×', div: '÷' };

type Term = MfInitial['terms'][number];
function toAst(terms: Term[], ops: MfInitial['ops']): unknown {
  const leaf = (t: Term) => (t.kind === 'metric' ? { op: 'ref', metric: t.value } : { op: 'num', value: t.value });
  let acc: unknown = leaf(terms[0]!);
  terms.slice(1).forEach((t, i) => { acc = { op: ops[i] ?? 'add', l: acc, r: leaf(t) }; });
  return acc;
}

/** Editor de indicador sem código: agregação sobre uma coluna, ou fórmula encadeada (A op B op C…, sempre da esquerda para a direita, sem texto livre). */
export function MetricForm({ datasets, initial }: { datasets: MfDataset[]; initial: MfInitial }) {
  const [state, action, ref] = useBiAction(saveMetric, { reset: false });
  const [m, setM] = useState(initial);
  const ds = datasets.find((d) => d.id === m.datasetId);
  const cols = ds?.columns ?? [];
  const fieldType = cols.find((c) => c.key === m.field)?.type ?? null;
  const aggOk = (a: Aggregation) => aggAllowed(a, a === 'count' ? null : fieldType);
  const others = (ds?.metrics ?? []).filter((x) => x.id !== m.id);
  const upd = (p: Partial<MfInitial>) => setM((x) => ({ ...x, ...p }));
  const updTerm = (i: number, p: Partial<Term>) => upd({ terms: m.terms.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  const text = m.terms.map((t, i) => { const label = t.kind === 'metric' ? others.find((o) => o.id === t.value)?.name ?? '?' : t.value || '0'; return i === 0 ? label : `${OPS[m.ops[i - 1] ?? 'add']} ${label}`; });
  const preview = m.terms.length > 1 ? `${'('.repeat(m.terms.length - 1)}${text[0]}${text.slice(1).map((x) => ` ${x})`).join('')}` : text[0];
  const ast = m.type === 'formula' && m.terms.every((t) => t.value) ? toAst(m.terms, m.ops) : null;

  return (
    <form ref={ref} action={action} noValidate className="grid gap-4 sm:grid-cols-2">
      {m.id ? <input type="hidden" name="id" value={m.id} /> : null}
      <input type="hidden" name="dataset_id" value={m.datasetId} />
      <input type="hidden" name="metric_type" value={m.type} />
      <input type="hidden" name="filters" value={JSON.stringify(m.type === 'aggregation' ? m.filters : [])} />
      <input type="hidden" name="ast" value={ast ? JSON.stringify(ast) : ''} />
      <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="mf-name" className="mb-1 block text-sm font-medium">Nome do indicador</label><Input id="mf-name" name="name" required maxLength={80} value={m.name} onChange={(e) => upd({ name: e.target.value })} />{state.fieldErrors?.name ? <p className="mt-1 text-sm text-danger">{state.fieldErrors.name[0]}</p> : null}</div>
        <div><label htmlFor="mf-ds" className="mb-1 block text-sm font-medium">Dataset</label>
          <Select id="mf-ds" value={m.datasetId} disabled={Boolean(m.id)} onChange={(e) => upd({ datasetId: e.target.value, field: '', filters: [], terms: [{ kind: 'metric', value: '' }, { kind: 'metric', value: '' }] })}>{datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      </div>
      <div className="sm:col-span-2"><label htmlFor="mf-desc" className="mb-1 block text-sm font-medium">Descrição (o que este número significa)</label><Textarea id="mf-desc" name="description" rows={2} maxLength={500} value={m.description} onChange={(e) => upd({ description: e.target.value })} /></div>

      <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium">Tipo de indicador</legend>
        <label className="mr-6 inline-flex items-center gap-2 text-sm"><input type="radio" name="kind-ui" checked={m.type === 'aggregation'} onChange={() => upd({ type: 'aggregation' })} /> Agregação sobre uma coluna (soma, contagem, média…)</label>
        <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name="kind-ui" checked={m.type === 'formula'} onChange={() => upd({ type: 'formula' })} /> Fórmula entre outros indicadores (razão, diferença…)</label>
      </fieldset>

      {m.type === 'aggregation' ? (
        <>
          <div><label htmlFor="mf-agg" className="mb-1 block text-sm font-medium">Agregação</label>
            <Select id="mf-agg" name="aggregation" value={m.aggregation} onChange={(e) => upd({ aggregation: e.target.value as Aggregation, field: e.target.value === 'count' ? '' : m.field })}>{AGGREGATIONS.map((a) => <option key={a} value={a} disabled={Boolean(m.field) && !aggOk(a)}>{AGG_LABEL[a]}</option>)}</Select></div>
          <div><label htmlFor="mf-field" className="mb-1 block text-sm font-medium">Coluna{m.aggregation === 'count' ? ' (opcional: sem coluna conta as linhas)' : ''}</label>
            <Select id="mf-field" name="field_key" value={m.field} onChange={(e) => { const t = cols.find((c) => c.key === e.target.value)?.type ?? null; upd({ field: e.target.value, aggregation: m.aggregation !== 'count' && !aggAllowed(m.aggregation, t) ? 'count' : m.aggregation }); }}>
              <option value="">{m.aggregation === 'count' ? 'Contar linhas' : 'Escolha…'}</option>
              {cols.map((c) => <option key={c.key} value={c.key}>{c.name} — {typeLabel(c.type)}</option>)}</Select></div>
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">Filtros próprios (opcional)</p>
            {m.filters.map((f, i) => {
              const col = cols.find((c) => c.key === f.field);
              const needsValue = f.op !== 'empty' && f.op !== 'not_empty';
              return (
                <div key={i} className="mb-2 flex flex-wrap gap-2">
                  <Select aria-label={`Coluna do filtro ${i + 1}`} value={f.field} onChange={(e) => upd({ filters: m.filters.map((x, j) => (j === i ? { field: e.target.value, op: 'eq', value: '' } : x)) })} className="w-48">{cols.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select>
                  <Select aria-label={`Operador do filtro ${i + 1}`} value={f.op} onChange={(e) => upd({ filters: m.filters.map((x, j) => (j === i ? { field: x.field, op: e.target.value as FilterOp, value: '' } : x)) })} className="w-44">{(col ? operatorsFor(col.type) : []).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</Select>
                  {needsValue ? <Input aria-label={`Valor do filtro ${i + 1}`} value={filterText(f)} className="w-56" placeholder={col && isNumeric(col.type) ? 'Número (ponto decimal)' : col && (col.type === 'date' || col.type === 'timestamp') ? 'AAAA-MM-DD' : 'Valor'}
                    onChange={(e) => upd({ filters: setFilterValue(m.filters, i, e.target.value) })} /> : null}
                  <button type="button" className="text-sm text-danger underline" onClick={() => upd({ filters: m.filters.filter((_, j) => j !== i) })}>Remover</button>
                </div>
              );
            })}
            {m.filters.length < 10 && cols[0] ? <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => upd({ filters: [...m.filters, { field: cols[0]!.key, op: 'eq', value: '' }] })}>+ Adicionar filtro</button> : null}
          </div>
        </>
      ) : (
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium">Fórmula (calculada da esquerda para a direita)</p>
          {others.length === 0 ? <Alert tone="info">Crie antes ao menos um indicador de agregação neste dataset para combiná-los.</Alert> : null}
          {m.terms.map((t, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
              {i > 0 ? <Select aria-label={`Operação ${i}`} value={m.ops[i - 1] ?? 'add'} onChange={(e) => upd({ ops: m.ops.map((o, j) => (j === i - 1 ? (e.target.value as 'add') : o)) })} className="w-24">{Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select> : null}
              <Select aria-label={`Tipo do termo ${i + 1}`} value={t.kind} onChange={(e) => updTerm(i, { kind: e.target.value as 'metric' | 'number', value: '' })} className="w-32"><option value="metric">Indicador</option><option value="number">Número</option></Select>
              {t.kind === 'metric'
                ? <Select aria-label={`Indicador do termo ${i + 1}`} value={t.value} onChange={(e) => updTerm(i, { value: e.target.value })} className="w-64"><option value="">Escolha…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>
                : <Input aria-label={`Número do termo ${i + 1}`} value={t.value} onChange={(e) => updTerm(i, { value: e.target.value.replace(',', '.') })} className="w-32" inputMode="decimal" placeholder="100" />}
              {m.terms.length > 2 ? <button type="button" className="text-sm text-danger underline" onClick={() => upd({ terms: m.terms.filter((_, j) => j !== i), ops: m.ops.filter((_, j) => j !== Math.max(0, i - 1)) })}>Remover</button> : null}
            </div>
          ))}
          {m.terms.length < 5 ? <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => upd({ terms: [...m.terms, { kind: 'metric', value: '' }], ops: [...m.ops, 'add'] })}>+ Adicionar termo</button> : null}
          <p className="mt-2 text-sm" aria-live="polite"><span className="text-muted">Resultado = </span><strong data-testid="formula-preview">{preview}</strong></p>
          <p className="mt-1 text-xs text-muted">Divisão por zero não vira infinito: o resultado fica «indisponível» com a explicação. Fórmulas são só números e indicadores — nunca texto executável.</p>
        </div>
      )}

      <div><label htmlFor="mf-fmt" className="mb-1 block text-sm font-medium">Formato de exibição</label>
        <Select id="mf-fmt" name="format_type" value={m.format} onChange={(e) => upd({ format: e.target.value as FormatType })}>{FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}</Select></div>
      <div><label htmlFor="mf-unit" className="mb-1 block text-sm font-medium">Unidade (opcional)</label><Input id="mf-unit" name="unit" maxLength={20} value={m.unit} onChange={(e) => upd({ unit: e.target.value })} placeholder="ex.: pedidos, h" /></div>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3"><SubmitButton pendingText="Salvando…">{m.id ? 'Salvar nova versão' : 'Criar indicador'}</SubmitButton><FormMessage state={state} /></div>
    </form>
  );
}
