// Motor de métricas: definições (agregação ou fórmula), compilação para medidas-base, avaliação decimal e regras de divisão por zero.
// Fórmulas são uma ÁRVORE validada (ref | número | + − × ÷). Não existe avaliação de texto, eval nem JavaScript do usuário.
import { D, BiError, toDec, type Dec } from './decimal';
import { isAdditiveAgg, normalizeMeasure } from './query';
import type { Aggregation, ColumnDef, Filter, Measure } from './types';

export type FormulaNode =
  | { op: 'ref'; metric: string }
  | { op: 'num'; value: string }
  | { op: 'add' | 'sub' | 'mul' | 'div'; l: FormulaNode; r: FormulaNode };

export type MetricDef =
  | { id: string; name: string; datasetId: string; kind: 'aggregation'; agg: Aggregation; field?: string; filters?: Filter[] }
  | { id: string; name: string; datasetId: string; kind: 'formula'; ast: FormulaNode };

export const FORMULA_LIMITS = { depth: 6, nodes: 40, refs: 20 } as const;

/** Expressão sobre apelidos de medidas-base (m0, m1…). */
export type Expr = { op: 'm'; alias: string } | { op: 'num'; value: string } | { op: 'add' | 'sub' | 'mul' | 'div'; l: Expr; r: Expr };
export type Compiled = { measures: Measure[]; expr: Expr; additive: boolean };

/** Valida a árvore (formato, tamanho) sem olhar o catálogo. */
export function validateAst(node: FormulaNode, depth = 1, count = { n: 0 }): void {
  if (depth > FORMULA_LIMITS.depth) throw new BiError('formula_deep', `Fórmula profunda demais (máximo ${FORMULA_LIMITS.depth} níveis).`);
  if (++count.n > FORMULA_LIMITS.nodes) throw new BiError('formula_big', `Fórmula grande demais (máximo ${FORMULA_LIMITS.nodes} elementos).`);
  const op = (node as { op?: unknown }).op;
  if (op === 'ref') {
    if (typeof (node as { metric: unknown }).metric !== 'string' || !/^[0-9a-f-]{36}$/i.test((node as { metric: string }).metric)) throw new BiError('formula_ref', 'Referência de métrica inválida.');
    return;
  }
  if (op === 'num') {
    const v = (node as { value: unknown }).value;
    if (typeof v !== 'string' || !/^-?\d{1,15}(\.\d{1,6})?$/.test(v)) throw new BiError('formula_num', 'Número inválido na fórmula.');
    return;
  }
  if (op === 'add' || op === 'sub' || op === 'mul' || op === 'div') {
    const n = node as { l: FormulaNode; r: FormulaNode };
    if (!n.l || !n.r || typeof n.l !== 'object' || typeof n.r !== 'object') throw new BiError('formula_shape', 'Operação incompleta na fórmula.');
    validateAst(n.l, depth + 1, count);
    validateAst(n.r, depth + 1, count);
    return;
  }
  throw new BiError('formula_op', 'Operação não permitida na fórmula.');
}

/** Métricas que a fórmula referencia (diretas). */
export function refsOf(node: FormulaNode, out: Set<string> = new Set()): Set<string> {
  if (node.op === 'ref') out.add(node.metric);
  else if (node.op !== 'num') { refsOf(node.l, out); refsOf(node.r, out); }
  return out;
}

/** Detecta referência circular entre métricas (a métrica `id` já com a fórmula nova). */
export function findCycle(id: string, defs: Map<string, MetricDef>): string[] | null {
  const stack: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (cur: string): string[] | null => {
    if (visiting.has(cur)) return [...stack.slice(stack.indexOf(cur)), cur];
    if (done.has(cur)) return null;
    visiting.add(cur);
    stack.push(cur);
    const def = defs.get(cur);
    if (def?.kind === 'formula') for (const r of refsOf(def.ast)) { const c = visit(r); if (c) return c; }
    stack.pop();
    visiting.delete(cur);
    done.add(cur);
    return null;
  };
  return visit(id);
}

const sig = (m: Omit<Measure, 'alias'>) => JSON.stringify([m.agg, m.field ?? null, m.filters ?? []]);

/** Compila uma métrica em medidas-base únicas + expressão. Valida dataset, tipos, ciclos e limites. */
export function compileMetric(id: string, defs: Map<string, MetricDef>, columns: ColumnDef[]): Compiled {
  const cols = new Map(columns.map((c) => [c.key, c]));
  const root = defs.get(id);
  if (!root) throw new BiError('metric_missing', 'Métrica não encontrada.');
  const cycle = findCycle(id, defs);
  if (cycle) throw new BiError('metric_cycle', 'Referência circular entre métricas.');
  const measures: Measure[] = [];
  const bySig = new Map<string, string>();
  let refCount = 0;
  let additive = true;
  const build = (mid: string, depth: number): Expr => {
    if (depth > FORMULA_LIMITS.depth) throw new BiError('formula_deep', 'Métricas aninhadas demais.');
    const d = defs.get(mid);
    if (!d) throw new BiError('metric_missing', 'Uma métrica referenciada não existe.');
    if (d.datasetId !== root.datasetId) throw new BiError('metric_dataset', 'Uma fórmula só pode combinar métricas do mesmo dataset.');
    if (d.kind === 'aggregation') {
      const norm = normalizeMeasure({ alias: 'm0', agg: d.agg, ...(d.field ? { field: d.field } : {}), ...(d.filters?.length ? { filters: d.filters } : {}) }, cols);
      const { alias: _a, ...rest } = norm;
      void _a;
      const k = sig(rest);
      let alias = bySig.get(k);
      if (!alias) {
        alias = `m${measures.length}`;
        measures.push({ alias, ...rest });
        bySig.set(k, alias);
      }
      if (!isAdditiveAgg(d.agg)) additive = false;
      return { op: 'm', alias };
    }
    validateAst(d.ast);
    const walk = (n: FormulaNode, dep: number): Expr => {
      if (n.op === 'num') return { op: 'num', value: n.value };
      if (n.op === 'ref') {
        if (++refCount > FORMULA_LIMITS.refs) throw new BiError('formula_big', 'Referências demais na fórmula.');
        return build(n.metric, dep + 1);
      }
      return { op: n.op, l: walk(n.l, dep), r: walk(n.r, dep) };
    };
    return walk(d.ast, depth);
  };
  const expr = build(id, 1);
  if (measures.length > 12) throw new BiError('too_complex', 'A métrica usa medidas demais.');
  // Métrica de agregação simples fica «aditiva» se soma/contagem; fórmula nunca.
  return { measures, expr, additive: root.kind === 'aggregation' ? additive : false };
}

// ---------------------------------------------------------------------------- avaliação
export type MetricState = 'ok' | 'div_zero' | 'no_data';
export type MetricValue = { value: string | null; state: MetricState };
export const STATE_TEXT: Record<Exclude<MetricState, 'ok'>, string> = {
  div_zero: 'Indisponível: o denominador é zero.',
  no_data: 'Sem dados no período/filtro.',
};

type Ev = { v: Dec } | { fail: Exclude<MetricState, 'ok'> };

/** `values[alias]` = texto numérico vindo do banco (ou null quando não há linhas). */
export function evaluate(expr: Expr, values: Record<string, string | null>): MetricValue {
  const go = (e: Expr): Ev => {
    if (e.op === 'num') return { v: new D(e.value) };
    if (e.op === 'm') {
      const raw = values[e.alias];
      const d = toDec(raw);
      return d ? { v: d } : { fail: 'no_data' };
    }
    const a = go(e.l);
    if ('fail' in a) return a;
    const b = go(e.r);
    if ('fail' in b) return b;
    switch (e.op) {
      case 'add': return { v: a.v.plus(b.v) };
      case 'sub': return { v: a.v.minus(b.v) };
      case 'mul': return { v: a.v.times(b.v) };
      case 'div': return b.v.isZero() ? { fail: 'div_zero' } : { v: a.v.div(b.v) };
    }
  };
  const r = go(expr);
  if ('fail' in r) return { value: null, state: r.fail };
  return { value: r.v.toFixed(), state: 'ok' };
}

/** Métrica simples de contagem nunca é «sem dados»: contar zero linhas é zero. */
export function normalizeCount(values: Record<string, string | null>, measures: Measure[]): Record<string, string | null> {
  const out = { ...values };
  for (const m of measures) if ((m.agg === 'count' || m.agg === 'count_distinct') && (out[m.alias] === null || out[m.alias] === undefined)) out[m.alias] = '0';
  return out;
}
