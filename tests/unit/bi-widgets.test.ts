import { describe, expect, it } from 'vitest';
import { BiError, compileMetric, type ColumnDef, type MetricDef } from '@/lib/bi/engine';
import { buildWidget, evalRows, mergeMetrics, othersRow, type MetricRef, type ResultRow } from '@/lib/bi/widgets';
import { TEMPLATES, planTemplate } from '@/lib/bi/templates';
import { setFilterValue, filterText } from '@/lib/bi/filter-edit';

const C = (key: string, name: string, type: ColumnDef['type']): ColumnDef => ({ key, name, type, semantic: 'measure', required: false, locale: 'br', dedupe: false });
const COLS = [C('c1', 'Data', 'date'), C('c2', 'Canal', 'string'), C('c3', 'Valor', 'currency'), C('c4', 'Qtd', 'integer')];
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const agg = (n: number, a: 'sum' | 'count' | 'avg', field?: string): MetricDef => ({ id: id(n), name: `m${n}`, datasetId: 'ds', kind: 'aggregation', agg: a, ...(field ? { field } : {}) });
const defs = new Map<string, MetricDef>([
  [id(1), agg(1, 'sum', 'c3')], [id(2), agg(2, 'count')], [id(3), agg(3, 'avg', 'c3')],
  [id(4), { id: id(4), name: 'ticket', datasetId: 'ds', kind: 'formula', ast: { op: 'div', l: { op: 'ref', metric: id(1) }, r: { op: 'ref', metric: id(2) } } }],
]);
const ref = (n: number, name = `m${n}`): MetricRef => ({ id: id(n), name, format: 'decimal', unit: null, version: 1, compiled: compileMetric(id(n), defs, COLS) });
const code = (fn: () => unknown) => { try { fn(); return 'no-error'; } catch (e) { return e instanceof BiError ? e.code : 'other'; } };
const build = (chart: Parameters<typeof buildWidget>[0]['chart'], metrics: MetricRef[], dims: Parameters<typeof buildWidget>[0]['dims'] = []) =>
  buildWidget({ chart, metrics, dims, datasetId: 'ds', datasetName: 'Vendas', periodField: 'c1' }, COLS);

describe('junção de métricas em uma consulta', () => {
  it('medidas-base repetidas entre indicadores viram uma só e as expressões são reescritas', () => {
    const { measures, exprs } = mergeMetrics([ref(1), ref(4)]); // soma e ticket (soma ÷ contagem)
    expect(measures.map((m) => m.agg)).toEqual(['sum', 'count']);
    expect(measures.map((m) => m.alias)).toEqual(['m0', 'm1']);
    expect(exprs[0]).toEqual({ op: 'm', alias: 'm0' });
    expect(JSON.stringify(exprs[1])).toContain('"alias":"m1"');
  });
  it('mais de 12 medidas-base é recusado', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ ...ref(1), compiled: { ...ref(1).compiled, measures: [{ alias: 'm0', agg: 'sum' as const, field: 'c3', filters: [{ field: 'c2', op: 'eq' as const, value: `v${i}` }] }] } }));
    expect(code(() => mergeMetrics(many))).toBe('too_complex');
  });
});

describe('montagem do widget', () => {
  it('KPI: uma métrica, sem dimensões, limite 1, período declarado só como coluna', () => {
    const w = build('kpi', [ref(1)]);
    expect(w.query_json.limit).toBe(1);
    expect(w.query_json.period).toEqual({ field: 'c1' });
    expect(w.display_json.metrics[0]!.expr).toEqual({ op: 'm', alias: 'm0' });
    expect(w.display_json.metrics[0]!.additive).toBe(true);
    expect(code(() => build('kpi', [ref(1)], [{ field: 'c2', name: 'Canal', type: 'string' }]))).toBe('bad_chart');
    expect(code(() => build('kpi', []))).toBe('no_metric');
  });
  it('linha exige data com granularidade; barras ordenam pelo maior valor; tempo ordena pela data', () => {
    expect(code(() => build('line', [ref(1)], [{ field: 'c2', name: 'Canal', type: 'string' }]))).toBe('bad_chart');
    const l = build('line', [ref(1)], [{ field: 'c1', name: 'Data', type: 'date', grain: 'month' }]);
    expect(l.query_json.order).toEqual([{ by: 'd0', dir: 'asc' }]);
    const b = build('bar', [ref(1)], [{ field: 'c2', name: 'Canal', type: 'string' }]);
    expect(b.query_json.order).toEqual([{ by: 'm0', dir: 'desc' }]);
    expect(b.query_json.limit).toBe(30);
  });
  it('pizza só com soma/contagem (nunca média) e mostra as 7 maiores categorias', () => {
    expect(code(() => build('pie', [ref(3)], [{ field: 'c2', name: 'Canal', type: 'string' }]))).toBe('bad_chart');
    expect(code(() => build('donut', [ref(4)], [{ field: 'c2', name: 'Canal', type: 'string' }]))).toBe('bad_chart'); // razão não é aditiva
    const p = build('donut', [ref(1)], [{ field: 'c2', name: 'Canal', type: 'string' }]);
    expect(p.query_json.limit).toBe(7);
  });
  it('dimensão ou coluna de período inexistente/errada é recusada', () => {
    expect(code(() => build('bar', [ref(1)], [{ field: 'c9', name: 'x', type: 'string' }]))).toBe('bad_field');
    expect(code(() => buildWidget({ chart: 'kpi', metrics: [ref(1)], dims: [], datasetId: 'ds', datasetName: 'V', periodField: 'c2' }, COLS))).toBe('bad_period');
  });
});

describe('avaliação das linhas (no servidor)', () => {
  it('ticket = soma ÷ contagem por grupo; contagem vazia vale 0; soma vazia é «sem dados»; divisão por zero é indisponível', () => {
    const w = build('bar', [ref(1), ref(2), ref(4)], [{ field: 'c2', name: 'Canal', type: 'string' }]);
    const rows = evalRows(w.display_json, [
      { d0: 'Loja', m0: '100', m1: '4' },
      { d0: 'Site', m0: null, m1: null },
      { d0: 'Mista', m0: '50', m1: '0' },
    ], w.query_json.measures);
    expect(rows[0]!.values.map((v) => v.value)).toEqual(['100', '4', '25']);
    expect(rows[1]!.values.map((v) => v.state)).toEqual(['no_data', 'ok', 'no_data']);
    expect(rows[1]!.values[1]!.value).toBe('0');
    expect(rows[2]!.values[2]).toEqual({ value: null, state: 'div_zero' });
  });
  it('«Outros» da pizza = total − maiores (decimal exato) e só quando sobra algo e a métrica é aditiva', () => {
    const w = build('pie', [ref(1)], [{ field: 'c2', name: 'Canal', type: 'string' }]);
    const row = (v: string): ResultRow => ({ dims: ['x'], values: [{ value: v, state: 'ok' }] });
    expect(othersRow(w.display_json, [row('10.10'), row('20.20')], row('35.35'))?.values[0]).toEqual({ value: '5.05', state: 'ok' });
    expect(othersRow(w.display_json, [row('10'), row('20')], row('30'))).toBeNull();
    expect(othersRow(w.display_json, [row('10')], undefined)).toBeNull();
    const avgW = build('bar', [ref(3)], [{ field: 'c2', name: 'Canal', type: 'string' }]);
    expect(othersRow(avgW.display_json, [row('10')], row('99'))).toBeNull();
  });
});

describe('modelos de dashboard', () => {
  it('sem os campos obrigatórios o modelo diz que é incompatível (nada é adivinhado)', () => {
    const t = TEMPLATES.find((x) => x.key === 'comercial')!;
    expect(planTemplate(t, {}, {}).missingRequired).toEqual(['Data da venda', 'Valor da venda']);
    const ok = planTemplate(t, { date: 'c1', revenue: 'c3' }, {});
    expect(ok.missingRequired).toEqual([]);
    expect(ok.metrics.map((m) => m.key)).toEqual(['revenue', 'orders', 'ticket']);
    expect(ok.widgets.map((w) => w.title)).toContain('Receita observada');
    expect(ok.skipped).toEqual(expect.arrayContaining(['Receita por canal', 'Receita por vendedor']));
  });
  it('marketing só calcula CPA/ROAS com os campos necessários; operações exige o valor de «concluída»', () => {
    const m = TEMPLATES.find((x) => x.key === 'marketing')!;
    const p1 = planTemplate(m, { date: 'c1', spend: 'c3', leads: 'c4' }, {});
    expect(p1.metrics.map((x) => x.key)).toEqual(['spend', 'leads', 'cpl']);
    const p2 = planTemplate(m, { date: 'c1', spend: 'c3', leads: 'c4', conversions: 'c4', revenue: 'c3' }, {});
    expect(p2.metrics.map((x) => x.key)).toEqual(expect.arrayContaining(['cpa', 'roas']));
    const o = TEMPLATES.find((x) => x.key === 'operacoes')!;
    expect(planTemplate(o, { date: 'c1', status: 'c2' }, {}).needExtras).toHaveLength(1);
    expect(planTemplate(o, { date: 'c1', status: 'c2' }, {}).metrics.map((x) => x.key)).not.toContain('done');
    expect(planTemplate(o, { date: 'c1', status: 'c2' }, { done_value: 'Concluído' }).metrics.map((x) => x.key)).toEqual(expect.arrayContaining(['done', 'rate']));
  });
  it('todo modelo é consistente: widgets e fórmulas só referenciam métricas e papéis que existem', () => {
    for (const t of TEMPLATES) {
      const keys = new Set(t.metrics.map((m) => m.key));
      const roles = new Set(t.roles.map((r) => r.key));
      for (const w of t.widgets) { for (const k of w.metrics) expect(keys.has(k), `${t.key}: ${w.title} → ${k}`).toBe(true); for (const r of w.needs) expect(roles.has(r), `${t.key}: ${w.title} precisa de ${r}`).toBe(true); }
      for (const m of t.metrics) { for (const n of m.needs) expect(roles.has(n), `${t.key}: ${m.key} precisa de ${n}`).toBe(true); if (m.step.kind === 'formula') for (const u of m.step.uses) expect(keys.has(u), `${t.key}: ${m.key} usa ${u}`).toBe(true); }
    }
    expect(TEMPLATES.map((t) => t.key)).toEqual(['comercial', 'financeiro', 'marketing', 'operacoes', 'executivo']);
  });
});

describe('edição de filtros no editor', () => {
  it('lista, intervalo e valor único respeitam o operador', () => {
    const f = [{ field: 'c2', op: 'in' as const, values: [] }, { field: 'c3', op: 'between' as const }, { field: 'c2', op: 'eq' as const, value: '' }];
    expect(setFilterValue(f, 0, 'A, B ,, C')[0]).toEqual({ field: 'c2', op: 'in', values: ['A', 'B', 'C'] });
    expect(setFilterValue(f, 1, '10|20')[1]).toEqual({ field: 'c3', op: 'between', value: '10', to: '20' });
    expect(setFilterValue(f, 2, 'Loja')[2]).toEqual({ field: 'c2', op: 'eq', value: 'Loja' });
    expect(filterText({ field: 'c3', op: 'between', value: '10', to: '20' })).toBe('10|20');
    expect(filterText({ field: 'c2', op: 'in', values: ['A', 'B'] })).toBe('A, B');
  });
});
