// Especificação declarativa de consulta: validação contra o catálogo de colunas (chaves internas) e normalização de filtros.
// Nada aqui vira SQL por concatenação: o banco reconstrói tudo a partir de chaves e operadores de listas fechadas.
import {
  AGGREGATIONS, COLUMN_KEY_RE, FILTER_OPS, GRAINS, MAX_DIMENSIONS, MAX_FILTERS, MAX_MEASURES, MAX_QUERY_LIMIT, isNumeric, isTemporal,
  type Aggregation, type ColumnDef, type DataType, type Filter, type Measure, type QuerySpec,
} from './types';
import { BiError, toDec } from './decimal';
import { isRealDate, parseDateParts } from './parse';

const ALIAS_RE = /^m[0-9]{1,2}$/;
const MAX_IN_VALUES = 50;
const MAX_FILTER_TEXT = 200;

export function aggAllowed(agg: Aggregation, type: DataType | null): boolean {
  if (agg === 'count') return true;
  if (type === null) return false;
  if (agg === 'count_distinct') return true;
  if (agg === 'sum' || agg === 'avg') return isNumeric(type);
  return isNumeric(type) || isTemporal(type); // min, max
}
export const AGG_LABEL: Record<Aggregation, string> = { sum: 'Soma', count: 'Contagem', count_distinct: 'Contagem distinta', avg: 'Média', min: 'Mínimo', max: 'Máximo' };
/** Somar o resultado de grupos só faz sentido para soma e contagem. */
export const isAdditiveAgg = (a: Aggregation) => a === 'sum' || a === 'count';

const opsFor = (t: DataType): readonly string[] => {
  const base = ['eq', 'neq', 'in', 'empty', 'not_empty'];
  if (t === 'string') return [...base, 'contains'];
  if (t === 'boolean') return ['eq', 'neq', 'empty', 'not_empty'];
  return [...base, 'gt', 'gte', 'lt', 'lte', 'between'];
};
export const OP_LABEL: Record<string, string> = { eq: 'é igual a', neq: 'é diferente de', contains: 'contém', in: 'está em', gt: 'maior que', gte: 'maior ou igual a', lt: 'menor que', lte: 'menor ou igual a', between: 'entre', empty: 'está vazio', not_empty: 'não está vazio' };
export const operatorsFor = (t: DataType) => opsFor(t);

/** Valor de filtro canônico para o tipo da coluna (decimal com ponto, data ISO, booleano). */
export function canonFilterValue(v: unknown, type: DataType): string | boolean {
  if (type === 'boolean') {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    throw new BiError('bad_filter', 'Valor booleano inválido no filtro.');
  }
  if (typeof v !== 'string' || v.length > MAX_FILTER_TEXT) throw new BiError('bad_filter', 'Valor de filtro inválido.');
  if (isNumeric(type)) {
    if (!/^-?\d+(\.\d+)?$/.test(v) || !toDec(v)) throw new BiError('bad_filter', 'Valor numérico de filtro inválido (use ponto decimal).');
    return v;
  }
  if (type === 'date') {
    const p = parseDateParts(v);
    if (!p || p.h !== undefined) throw new BiError('bad_filter', 'Data de filtro inválida (AAAA-MM-DD).');
    return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }
  if (type === 'timestamp') {
    const p = parseDateParts(v);
    if (!p) throw new BiError('bad_filter', 'Data de filtro inválida.');
    return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; // filtros temporais sempre por dia civil
  }
  return v;
}

export function normalizeFilter(f: Filter, cols: Map<string, ColumnDef>): Filter {
  if (!COLUMN_KEY_RE.test(f.field)) throw new BiError('bad_field', 'Campo de filtro inválido.');
  const col = cols.get(f.field);
  if (!col) throw new BiError('bad_field', 'Campo de filtro não existe neste dataset.');
  if (!(FILTER_OPS as readonly string[]).includes(f.op)) throw new BiError('bad_op', 'Operador de filtro inválido.');
  if (!opsFor(col.type).includes(f.op)) throw new BiError('bad_op', `O operador «${OP_LABEL[f.op]}» não se aplica à coluna «${col.name}».`);
  if (f.op === 'empty' || f.op === 'not_empty') return { field: f.field, op: f.op };
  if (f.op === 'in') {
    const vs = f.values ?? [];
    if (!Array.isArray(vs) || vs.length === 0 || vs.length > MAX_IN_VALUES) throw new BiError('bad_filter', `A lista de valores precisa ter de 1 a ${MAX_IN_VALUES} itens.`);
    return { field: f.field, op: 'in', values: vs.map((v) => canonFilterValue(v, col.type)) };
  }
  if (f.op === 'between') {
    const a = canonFilterValue(f.value, col.type);
    const b = canonFilterValue(f.to, col.type);
    if (typeof a === 'boolean' || typeof b === 'boolean') throw new BiError('bad_filter', 'Intervalo inválido.');
    if (isNumeric(col.type) ? toDec(a)!.gt(toDec(b)!) : a > b) throw new BiError('bad_filter', 'O início do intervalo é maior que o fim.');
    return { field: f.field, op: 'between', value: a, to: b };
  }
  return { field: f.field, op: f.op, value: canonFilterValue(f.value, col.type) };
}

export function normalizeMeasure(m: Measure, cols: Map<string, ColumnDef>): Measure {
  if (!ALIAS_RE.test(m.alias)) throw new BiError('bad_alias', 'Apelido de medida inválido.');
  if (!(AGGREGATIONS as readonly string[]).includes(m.agg)) throw new BiError('bad_agg', 'Agregação inválida.');
  let type: DataType | null = null;
  if (m.field !== undefined && m.field !== null) {
    if (!COLUMN_KEY_RE.test(m.field)) throw new BiError('bad_field', 'Campo inválido na medida.');
    const col = cols.get(m.field);
    if (!col) throw new BiError('bad_field', 'Campo da medida não existe neste dataset.');
    type = col.type;
  }
  if (m.agg !== 'count' && m.field === undefined) throw new BiError('bad_agg', 'Esta agregação precisa de uma coluna.');
  if (!aggAllowed(m.agg, type)) throw new BiError('bad_agg', `A agregação «${AGG_LABEL[m.agg]}» não se aplica a esta coluna.`);
  const filters = (m.filters ?? []).map((f) => normalizeFilter(f, cols));
  if (filters.length > MAX_FILTERS) throw new BiError('too_complex', 'Filtros demais na medida.');
  return { alias: m.alias, agg: m.agg, ...(m.field !== undefined ? { field: m.field } : {}), ...(filters.length ? { filters } : {}) };
}

/** Valida e normaliza a consulta inteira. Lança BiError (mensagem em português, segura para exibir). */
export function validateQuery(spec: QuerySpec, columns: ColumnDef[]): QuerySpec {
  const cols = new Map(columns.map((c) => [c.key, c]));
  if (!spec.measures?.length || spec.measures.length > MAX_MEASURES) throw new BiError('too_complex', `Use de 1 a ${MAX_MEASURES} medidas.`);
  const measures = spec.measures.map((m) => normalizeMeasure(m, cols));
  if (new Set(measures.map((m) => m.alias)).size !== measures.length) throw new BiError('bad_alias', 'Apelidos de medida repetidos.');
  const dims = spec.dimensions ?? [];
  if (dims.length > MAX_DIMENSIONS) throw new BiError('too_complex', `Use no máximo ${MAX_DIMENSIONS} dimensões.`);
  const dimensions = dims.map((d) => {
    if (!COLUMN_KEY_RE.test(d.field)) throw new BiError('bad_field', 'Dimensão inválida.');
    const col = cols.get(d.field);
    if (!col) throw new BiError('bad_field', 'Dimensão não existe neste dataset.');
    if (d.grain !== undefined) {
      if (!(GRAINS as readonly string[]).includes(d.grain)) throw new BiError('bad_grain', 'Granularidade inválida.');
      if (!isTemporal(col.type)) throw new BiError('bad_grain', 'Granularidade só vale para colunas de data.');
    }
    return d.grain ? { field: d.field, grain: d.grain } : { field: d.field };
  });
  if (new Set(dimensions.map((d) => d.field)).size !== dimensions.length) throw new BiError('too_complex', 'Dimensões repetidas.');
  const filters = (spec.filters ?? []).map((f) => normalizeFilter(f, cols));
  if (filters.length > MAX_FILTERS) throw new BiError('too_complex', `Use no máximo ${MAX_FILTERS} filtros.`);
  let period = spec.period;
  if (period) {
    const col = cols.get(period.field);
    if (!col || !isTemporal(col.type)) throw new BiError('bad_period', 'O período precisa de uma coluna de data.');
    for (const d of [period.from, period.to]) {
      const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
      if (!p || !isRealDate(Number(p[1]), Number(p[2]), Number(p[3]))) throw new BiError('bad_period', 'Período com data inválida.');
    }
    if (period.from > period.to) throw new BiError('bad_period', 'O início do período é depois do fim.');
    period = { field: period.field, from: period.from, to: period.to };
  }
  const limit = Math.min(Math.max(Math.trunc(spec.limit ?? 500), 1), MAX_QUERY_LIMIT);
  const valid = new Set([...measures.map((m) => m.alias), ...dimensions.map((_, i) => `d${i}`)]);
  const order = (spec.order ?? []).map((o) => {
    if (!valid.has(o.by) || (o.dir !== 'asc' && o.dir !== 'desc')) throw new BiError('bad_order', 'Ordenação inválida.');
    return { by: o.by, dir: o.dir };
  });
  return { dataset_id: spec.dataset_id, measures, ...(dimensions.length ? { dimensions } : {}), ...(filters.length ? { filters } : {}), ...(period ? { period } : {}), ...(order.length ? { order } : {}), limit };
}
