import { describe, expect, it } from 'vitest';
import {
  BiError, checkChart, comparisonRange, compileMetric, evaluate, evaluateGoal, findCycle, formatValue, isPartialPeriod, normalizeCount, resolvePeriod, validateAst, validateQuery, variation,
  type ColumnDef, type FormulaNode, type MetricDef, type QuerySpec,
} from '@/lib/bi/engine';

const C = (key: string, name: string, type: ColumnDef['type']): ColumnDef => ({ key, name, type, semantic: 'measure', required: false, locale: 'br', dedupe: false });
const COLS = [C('c1', 'Data', 'date'), C('c2', 'Canal', 'string'), C('c3', 'Valor', 'currency'), C('c4', 'Qtd', 'integer'), C('c5', 'Ativo', 'boolean')];
const DS = 'ds';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const agg = (n: number, a: 'sum' | 'count' | 'avg' | 'count_distinct' | 'min' | 'max', field?: string): MetricDef => ({ id: id(n), name: `m${n}`, datasetId: DS, kind: 'aggregation', agg: a, ...(field ? { field } : {}) });
const formula = (n: number, ast: FormulaNode): MetricDef => ({ id: id(n), name: `f${n}`, datasetId: DS, kind: 'formula', ast });
const ref = (n: number): FormulaNode => ({ op: 'ref', metric: id(n) });
const defsOf = (...d: MetricDef[]) => new Map(d.map((x) => [x.id, x]));
const code = (fn: () => unknown) => { try { fn(); return 'no-error'; } catch (e) { return e instanceof BiError ? e.code : 'other'; } };

describe('fórmulas e métricas', () => {
  it('razão (pedidos concluídos ÷ criados × 100) compila para medidas-base únicas e avalia com decimal exato', () => {
    const defs = defsOf(agg(1, 'count'), agg(2, 'sum', 'c4'), formula(3, { op: 'mul', l: { op: 'div', l: ref(2), r: ref(1) }, r: { op: 'num', value: '100' } }));
    const c = compileMetric(id(3), defs, COLS);
    expect(c.measures.map((m) => m.agg)).toEqual(['sum', 'count']);
    const [sum, cnt] = c.measures.map((m) => m.alias) as [string, string];
    expect(evaluate(c.expr, { [sum]: '37', [cnt]: '200' })).toEqual({ value: '18.5', state: 'ok' });
    expect(c.additive).toBe(false);
  });
  it('soma de duas somas é fórmula e, por isso, não é tratada como aditiva entre grupos', () => {
    const defs = defsOf(agg(1, 'sum', 'c3'), agg(2, 'sum', 'c4'), formula(3, { op: 'add', l: ref(1), r: ref(2) }));
    expect(compileMetric(id(3), defs, COLS).additive).toBe(false);
  });
  it('0,1 + 0,2 é exatamente 0,3 (sem ponto flutuante)', () => {
    const defs = defsOf(agg(1, 'sum', 'c3'), agg(2, 'sum', 'c4'), formula(3, { op: 'add', l: ref(1), r: ref(2) }));
    const c = compileMetric(id(3), defs, COLS);
    expect(evaluate(c.expr, { m0: '0.1', m1: '0.2' }).value).toBe('0.3');
  });
  it('divisão por zero e ausência de dados nunca viram NaN, Infinity nem percentual inventado', () => {
    const defs = defsOf(agg(1, 'sum', 'c3'), agg(2, 'sum', 'c4'), formula(3, { op: 'div', l: ref(1), r: ref(2) }));
    const c = compileMetric(id(3), defs, COLS);
    expect(evaluate(c.expr, { m0: '10', m1: '0' })).toEqual({ value: null, state: 'div_zero' });
    expect(evaluate(c.expr, { m0: null, m1: '5' })).toEqual({ value: null, state: 'no_data' });
    expect(evaluate(c.expr, { m0: '10', m1: '4' })).toEqual({ value: '2.5', state: 'ok' });
  });
  it('contagem de nenhuma linha vale zero; soma de nenhuma linha é «sem dados»', () => {
    const c = compileMetric(id(1), defsOf(agg(1, 'count'), agg(2, 'sum', 'c3')), COLS);
    expect(evaluate(c.expr, normalizeCount({ m0: null }, c.measures)).value).toBe('0');
    const s = compileMetric(id(2), defsOf(agg(2, 'sum', 'c3')), COLS);
    expect(evaluate(s.expr, normalizeCount({ m0: null }, s.measures))).toEqual({ value: null, state: 'no_data' });
  });
  it('métrica reutilizada na mesma fórmula gera uma única medida-base', () => {
    const defs = defsOf(agg(1, 'sum', 'c3'), formula(2, { op: 'sub', l: ref(1), r: { op: 'mul', l: ref(1), r: { op: 'num', value: '0.1' } } }));
    expect(compileMetric(id(2), defs, COLS).measures).toHaveLength(1);
  });
  it('detecta referência circular (direta e indireta) e auto-referência', () => {
    const a = formula(1, { op: 'add', l: ref(2), r: { op: 'num', value: '1' } });
    const b = formula(2, { op: 'add', l: ref(1), r: { op: 'num', value: '1' } });
    expect(findCycle(id(1), defsOf(a, b))).not.toBeNull();
    expect(code(() => compileMetric(id(1), defsOf(a, b), COLS))).toBe('metric_cycle');
    expect(code(() => compileMetric(id(1), defsOf(formula(1, ref(1))), COLS))).toBe('metric_cycle');
    expect(findCycle(id(3), defsOf(agg(3, 'count')))).toBeNull();
  });
  it('recusa operação fora da lista, JavaScript, SQL, referência que não é UUID e fórmulas grandes ou profundas', () => {
    expect(code(() => validateAst({ op: 'eval', code: 'process.exit()' } as unknown as FormulaNode))).toBe('formula_op');
    expect(code(() => validateAst({ op: 'num', value: '1; drop table x' } as FormulaNode))).toBe('formula_num');
    expect(code(() => validateAst({ op: 'ref', metric: "x'; select" } as FormulaNode))).toBe('formula_ref');
    expect(code(() => validateAst({ op: 'add', l: { op: 'num', value: '1' } } as unknown as FormulaNode))).toBe('formula_shape');
    let deep: FormulaNode = { op: 'num', value: '1' };
    for (let i = 0; i < 8; i++) deep = { op: 'add', l: deep, r: { op: 'num', value: '1' } };
    expect(code(() => validateAst(deep))).toBe('formula_deep');
    let wide: FormulaNode = { op: 'num', value: '1' };
    for (let i = 0; i < 3; i++) wide = { op: 'add', l: wide, r: wide };
    for (let i = 0; i < 3; i++) wide = { op: 'add', l: wide, r: wide };
    expect(code(() => validateAst(wide))).toMatch(/formula_(big|deep)/);
  });
  it('não combina métricas de datasets diferentes nem agregação incompatível com o tipo da coluna', () => {
    const other: MetricDef = { id: id(9), name: 'x', datasetId: 'outro', kind: 'aggregation', agg: 'count' };
    expect(code(() => compileMetric(id(1), defsOf(other, formula(1, ref(9))), COLS))).toBe('metric_dataset');
    expect(code(() => compileMetric(id(1), defsOf(agg(1, 'sum', 'c2')), COLS))).toBe('bad_agg'); // soma de texto
    expect(code(() => compileMetric(id(1), defsOf(agg(1, 'avg', 'c1')), COLS))).toBe('bad_agg'); // média de data
    expect(code(() => compileMetric(id(1), defsOf(agg(1, 'sum', 'c9')), COLS))).toBe('bad_field');
    expect(code(() => compileMetric(id(1), defsOf(agg(1, 'sum')), COLS))).toBe('bad_agg'); // soma sem coluna
    expect(code(() => compileMetric(id(1), defsOf(agg(1, 'min', 'c1')), COLS))).toBe('no-error'); // mínimo de data é válido
  });
  it('só soma e contagem são aditivas (base para pizza/empilhado/total de tabela)', () => {
    expect(compileMetric(id(1), defsOf(agg(1, 'sum', 'c3')), COLS).additive).toBe(true);
    expect(compileMetric(id(1), defsOf(agg(1, 'count')), COLS).additive).toBe(true);
    expect(compileMetric(id(1), defsOf(agg(1, 'avg', 'c3')), COLS).additive).toBe(false);
    expect(compileMetric(id(1), defsOf(agg(1, 'count_distinct', 'c2')), COLS).additive).toBe(false);
  });
});

describe('consulta declarativa', () => {
  const base: QuerySpec = { dataset_id: DS, measures: [{ alias: 'm0', agg: 'sum', field: 'c3' }], dimensions: [{ field: 'c1', grain: 'month' }] };
  it('normaliza limite, filtros e período', () => {
    const q = validateQuery({ ...base, limit: 99999, filters: [{ field: 'c2', op: 'in', values: ['A', 'B'] }], period: { field: 'c1', from: '2026-01-01', to: '2026-01-31' } }, COLS);
    expect(q.limit).toBe(1000);
    expect(q.filters![0]).toEqual({ field: 'c2', op: 'in', values: ['A', 'B'] });
  });
  it('só aceita chaves internas: nome de coluna, SQL ou injeção nunca passam', () => {
    for (const field of ['Valor', 'c3; drop table x', "c3' or '1'='1", 'c3 ', '', 'C3', 'c0', 'c1000']) {
      expect(code(() => validateQuery({ ...base, measures: [{ alias: 'm0', agg: 'sum', field }] }, COLS))).toMatch(/bad_(field|agg)/);
      expect(code(() => validateQuery({ ...base, dimensions: [{ field }] }, COLS))).toBe('bad_field');
    }
    expect(code(() => validateQuery({ ...base, measures: [{ alias: 'm0; select 1', agg: 'sum', field: 'c3' }] }, COLS))).toBe('bad_alias');
    expect(code(() => validateQuery({ ...base, measures: [{ alias: 'm0', agg: 'sum); drop' as 'sum', field: 'c3' }] }, COLS))).toBe('bad_agg');
  });
  it('operadores respeitam o tipo e os valores são canônicos', () => {
    const f = (filter: QuerySpec['filters']) => code(() => validateQuery({ ...base, filters: filter }, COLS));
    expect(f([{ field: 'c2', op: 'contains', value: 'lo' }])).toBe('no-error');
    expect(f([{ field: 'c3', op: 'contains', value: '1' }])).toBe('bad_op');
    expect(f([{ field: 'c5', op: 'gt', value: 'true' }])).toBe('bad_op');
    expect(f([{ field: 'c3', op: 'gt', value: '1,5' }])).toBe('bad_filter'); // vírgula não é canônica
    expect(f([{ field: 'c1', op: 'between', value: '2026-02-01', to: '2026-01-01' }])).toBe('bad_filter');
    expect(f([{ field: 'c1', op: 'eq', value: '2026-02-30' }])).toBe('bad_filter');
    expect(f([{ field: 'c2', op: 'in', values: [] }])).toBe('bad_filter');
    expect(f([{ field: 'c2', op: 'in', values: Array.from({ length: 51 }, (_, i) => String(i)) }])).toBe('bad_filter');
    expect(f([{ field: 'c2', op: 'drop' as 'eq', value: 'x' }])).toBe('bad_op');
  });
  it('período exige coluna de data, ordem válida e granularidade só em datas', () => {
    expect(code(() => validateQuery({ ...base, period: { field: 'c2', from: '2026-01-01', to: '2026-01-31' } }, COLS))).toBe('bad_period');
    expect(code(() => validateQuery({ ...base, period: { field: 'c1', from: '2026-02-01', to: '2026-01-31' } }, COLS))).toBe('bad_period');
    expect(code(() => validateQuery({ ...base, dimensions: [{ field: 'c2', grain: 'month' }] }, COLS))).toBe('bad_grain');
    expect(code(() => validateQuery({ ...base, order: [{ by: 'zz', dir: 'asc' }] }, COLS))).toBe('bad_order');
    expect(code(() => validateQuery({ ...base, dimensions: [{ field: 'c1' }, { field: 'c2' }, { field: 'c4' }] }, COLS))).toBe('too_complex');
  });
});

describe('períodos e comparações (intervalos inclusivos, fuso da empresa)', () => {
  const today = '2026-10-15';
  it('presets', () => {
    expect(resolvePeriod('today', today)).toEqual({ from: today, to: today });
    expect(resolvePeriod('yesterday', today)).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(resolvePeriod('last_7', today)).toEqual({ from: '2026-10-09', to: today });
    expect(resolvePeriod('last_30', today)).toEqual({ from: '2026-09-16', to: today });
    expect(resolvePeriod('this_month', today)).toEqual({ from: '2026-10-01', to: today });
    expect(resolvePeriod('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolvePeriod('this_quarter', today)).toEqual({ from: '2026-10-01', to: today });
    expect(resolvePeriod('this_year', today)).toEqual({ from: '2026-01-01', to: today });
    expect(resolvePeriod('last_month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(resolvePeriod('last_month', '2024-03-31')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
  it('personalizado valida início, fim e tamanho', () => {
    expect(code(() => resolvePeriod('custom', today, { from: '2026-02-01', to: '2026-01-01' }))).toBe('bad_period');
    expect(code(() => resolvePeriod('custom', today, { from: '2026-02-30', to: '2026-03-01' }))).toBe('bad_date');
    expect(code(() => resolvePeriod('custom', today))).toBe('bad_period');
    expect(code(() => resolvePeriod('custom', today, { from: '2010-01-01', to: '2026-01-01' }))).toBe('bad_period');
  });
  it('mês parcial: o mesmo número de dias OU o mês anterior inteiro — nunca misturado em silêncio', () => {
    const cur = resolvePeriod('this_month', today);
    expect(isPartialPeriod('this_month', today)).toBe(true);
    expect(isPartialPeriod('this_month', '2026-10-31')).toBe(false);
    expect(isPartialPeriod('last_month', today)).toBe(false);
    const same = comparisonRange(cur, 'previous_month', { partial: true, partialBasis: 'same_days' });
    expect(same).toMatchObject({ from: '2026-09-01', to: '2026-09-15' });
    expect(same.basis).toMatch(/mesmo número de dias/);
    const full = comparisonRange(cur, 'previous_month', { partial: true, partialBasis: 'full' });
    expect(full).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(full.basis).toMatch(/completo/);
  });
  it('bordas de calendário: 31 → fevereiro, ano bissexto e período imediatamente anterior', () => {
    expect(comparisonRange({ from: '2026-03-01', to: '2026-03-31' }, 'previous_month')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(comparisonRange({ from: '2024-03-01', to: '2024-03-31' }, 'previous_month')).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
    expect(comparisonRange({ from: '2026-03-10', to: '2026-03-16' }, 'previous_period')).toMatchObject({ from: '2026-03-03', to: '2026-03-09' });
    expect(comparisonRange({ from: '2024-02-29', to: '2024-02-29' }, 'previous_year')).toMatchObject({ from: '2023-02-28', to: '2023-02-28' });
  });
  it('variação percentual: fórmula, queda, anterior zero e sem dados', () => {
    expect(variation('120', '100')).toMatchObject({ state: 'ok', pct: '20', direction: 'up', abs: '20' });
    expect(variation('80', '100')).toMatchObject({ state: 'ok', pct: '-20', direction: 'down' });
    expect(variation('5', '0')).toMatchObject({ state: 'prev_zero', pct: null });
    expect(variation('0', '0')).toMatchObject({ state: 'both_zero', pct: null });
    expect(variation(null, '10').state).toBe('unavailable');
    expect(variation('100', '100')).toMatchObject({ pct: '0', direction: 'flat' });
  });
});

describe('metas respeitam a direção', () => {
  it('exemplo do prompt: R$ 82.000 de R$ 100.000 = 82 % (mínimo)', () => {
    const r = evaluateGoal({ kind: 'min', target: '100000', actual: '82000' });
    expect(r).toMatchObject({ status: 'missed', attainmentPct: '82', gap: '-18000' });
    expect(evaluateGoal({ kind: 'min', target: '100000', actual: '82000', periodOpen: true }).status).toBe('on_track');
    expect(evaluateGoal({ kind: 'min', target: '100000', actual: '50000', periodOpen: true }).status).toBe('attention');
    expect(evaluateGoal({ kind: 'min', target: '100000', actual: '100000' }).status).toBe('achieved');
  });
  it('menor é melhor: abaixo do limite é BOM, acima é ruim', () => {
    expect(evaluateGoal({ kind: 'max', target: '5000', actual: '4000' })).toMatchObject({ status: 'achieved', attainmentPct: '80' });
    expect(evaluateGoal({ kind: 'max', target: '5000', actual: '6000' }).status).toBe('missed');
  });
  it('faixa, crescimento e redução', () => {
    expect(evaluateGoal({ kind: 'range', target: '10', targetHigh: '20', actual: '15' }).status).toBe('achieved');
    expect(evaluateGoal({ kind: 'range', target: '10', targetHigh: '20', actual: '10' }).status).toBe('achieved');
    expect(evaluateGoal({ kind: 'range', target: '10', targetHigh: '20', actual: '20' }).status).toBe('achieved');
    expect(evaluateGoal({ kind: 'range', target: '10', targetHigh: '20', actual: '9.99' }).status).toBe('missed');
    expect(evaluateGoal({ kind: 'range', target: '10', targetHigh: '20', actual: '25' }).note).toMatch(/Acima/);
    expect(evaluateGoal({ kind: 'range', target: '30', targetHigh: '20', actual: '25' }).status).toBe('unavailable');
    expect(evaluateGoal({ kind: 'growth', target: '10', actual: '115', previous: '100' }).status).toBe('achieved');
    expect(evaluateGoal({ kind: 'growth', target: '10', actual: '105', previous: '100' }).status).toBe('missed');
    expect(evaluateGoal({ kind: 'reduction', target: '10', actual: '85', previous: '100' }).status).toBe('achieved');
    expect(evaluateGoal({ kind: 'reduction', target: '10', actual: '120', previous: '100' }).status).toBe('missed');
    expect(evaluateGoal({ kind: 'growth', target: '10', actual: '5', previous: '0' }).status).toBe('unavailable');
  });
  it('sem dados não vira «0 %» e alvo zero não divide', () => {
    expect(evaluateGoal({ kind: 'min', target: '100', actual: null }).status).toBe('unavailable');
    expect(evaluateGoal({ kind: 'min', target: '0', actual: '5' })).toMatchObject({ status: 'achieved', attainmentPct: null });
  });
});

describe('adequação de gráficos', () => {
  const add = { additive: true };
  const avg = { additive: false };
  const dim = (type: ColumnDef['type'], grain?: string) => ({ type, ...(grain ? { grain } : {}) });
  const ok = (r: ReturnType<typeof checkChart>) => r.ok;
  it('linha/área exigem dimensão temporal com granularidade', () => {
    expect(ok(checkChart({ type: 'line', measures: [add], dimensions: [dim('date', 'month')] }))).toBe(true);
    expect(ok(checkChart({ type: 'line', measures: [add], dimensions: [dim('string')] }))).toBe(false);
    expect(ok(checkChart({ type: 'line', measures: [add], dimensions: [dim('date')] }))).toBe(false);
    expect(ok(checkChart({ type: 'area', measures: [add], dimensions: [] }))).toBe(false);
  });
  it('pizza/donut só com soma ou contagem e categoria (nunca média, razão ou data)', () => {
    expect(ok(checkChart({ type: 'pie', measures: [add], dimensions: [dim('string')] }))).toBe(true);
    const r = checkChart({ type: 'donut', measures: [avg], dimensions: [dim('string')] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/somados/);
    expect(ok(checkChart({ type: 'pie', measures: [add], dimensions: [dim('date', 'month')] }))).toBe(false);
    expect(ok(checkChart({ type: 'pie', measures: [add, add], dimensions: [dim('string')] }))).toBe(false);
  });
  it('empilhado, combinado, KPI e barras', () => {
    expect(ok(checkChart({ type: 'stacked_bar', measures: [add], dimensions: [dim('date', 'month'), dim('string')] }))).toBe(true);
    expect(ok(checkChart({ type: 'stacked_bar', measures: [avg], dimensions: [dim('string')] }))).toBe(false);
    expect(ok(checkChart({ type: 'stacked_bar', measures: [add, avg], dimensions: [dim('string')] }))).toBe(false);
    expect(ok(checkChart({ type: 'stacked_bar', measures: [avg], dimensions: [dim('date', 'month'), dim('string')] }))).toBe(false);
    expect(ok(checkChart({ type: 'combo', measures: [add, avg], dimensions: [dim('date', 'month')] }))).toBe(true);
    expect(ok(checkChart({ type: 'combo', measures: [add], dimensions: [dim('date', 'month')] }))).toBe(false);
    expect(ok(checkChart({ type: 'kpi', measures: [add], dimensions: [] }))).toBe(true);
    expect(ok(checkChart({ type: 'kpi', measures: [add], dimensions: [dim('string')] }))).toBe(false);
    expect(ok(checkChart({ type: 'bar', measures: [avg], dimensions: [dim('string')] }))).toBe(true);
    expect(ok(checkChart({ type: 'bar', measures: [], dimensions: [dim('string')] }))).toBe(false);
  });
});

describe('formatação', () => {
  it('BRL, milhar, percentual e meio-para-cima só na exibição', () => {
    expect(formatValue('1234.5', 'currency').replace(/ /g, ' ')).toBe('R$ 1.234,50');
    expect(formatValue('0.005', 'decimal')).toBe('0,01');
    expect(formatValue('12.5', 'percentage')).toBe('12,50%');
    expect(formatValue('1234567', 'integer')).toBe('1.234.567');
    expect(formatValue(null, 'currency')).toBe('—');
    expect(formatValue('abc', 'integer')).toBe('—');
  });
});
