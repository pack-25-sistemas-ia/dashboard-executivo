// Metas: o resultado respeita a DIREÇÃO desejada. Sem projeção de atingimento futuro (não há metodologia documentada).
import { D, toDec } from './decimal';
import { variation } from './periods';

export const GOAL_KINDS = ['min', 'max', 'growth', 'reduction', 'range'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export const GOAL_LABEL: Record<GoalKind, string> = {
  min: 'Meta mínima (quanto maior, melhor)', max: 'Meta máxima (quanto menor, melhor)', growth: 'Crescimento mínimo (%)', reduction: 'Redução mínima (%)', range: 'Manter dentro de uma faixa',
};
export type GoalStatus = 'achieved' | 'on_track' | 'attention' | 'missed' | 'unavailable';
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = { achieved: 'Atingida', on_track: 'Em andamento', attention: 'Atenção', missed: 'Não atingida', unavailable: 'Sem dados' };

export type GoalInput = {
  kind: GoalKind;
  target: string; // min/max: valor; growth/reduction: percentual; range: limite inferior
  targetHigh?: string; // range: limite superior
  actual: string | null;
  previous?: string | null; // growth/reduction: valor do período de comparação
  /** Abaixo disto (% do alvo) a meta de «mínimo» fica em «atenção» em vez de «em andamento». Padrão 80. */
  warnPct?: number;
  /** Período ainda aberto: não declara «não atingida» antes do fim. */
  periodOpen?: boolean;
};
export type GoalResult = {
  status: GoalStatus;
  attainmentPct: string | null; // % do alvo (min) ou % do limite consumido (max); null onde não se aplica
  gap: string | null; // realizado − alvo (min/max); crescimento − alvo (growth)
  note: string;
};

export function evaluateGoal(g: GoalInput): GoalResult {
  const actual = toDec(g.actual);
  const target = toDec(g.target);
  if (!target) return { status: 'unavailable', attainmentPct: null, gap: null, note: 'Alvo inválido.' };
  const warn = g.warnPct ?? 80;
  const open = g.periodOpen ?? false;
  if (g.kind === 'growth' || g.kind === 'reduction') {
    const v = variation(g.actual, g.previous ?? null);
    if (v.state !== 'ok') return { status: 'unavailable', attainmentPct: null, gap: null, note: v.note ?? 'Sem base de comparação.' };
    const change = new D(v.pct!); // positivo = cresceu
    const effective = g.kind === 'growth' ? change : change.neg(); // reduction: queda conta a favor
    const gap = effective.minus(target);
    if (gap.gte(0)) return { status: 'achieved', attainmentPct: null, gap: gap.toFixed(), note: g.kind === 'growth' ? 'Crescimento igual ou acima da meta.' : 'Redução igual ou acima da meta.' };
    return { status: open ? 'on_track' : 'missed', attainmentPct: null, gap: gap.toFixed(), note: g.kind === 'growth' ? 'Crescimento abaixo da meta.' : 'Redução abaixo da meta.' };
  }
  if (!actual) return { status: 'unavailable', attainmentPct: null, gap: null, note: 'Sem dados no período.' };
  if (g.kind === 'range') {
    const hi = toDec(g.targetHigh);
    if (!hi || hi.lt(target)) return { status: 'unavailable', attainmentPct: null, gap: null, note: 'Faixa inválida.' };
    if (actual.gte(target) && actual.lte(hi)) return { status: 'achieved', attainmentPct: null, gap: '0', note: 'Dentro da faixa.' };
    return { status: 'missed', attainmentPct: null, gap: (actual.lt(target) ? actual.minus(target) : actual.minus(hi)).toFixed(), note: actual.lt(target) ? 'Abaixo da faixa.' : 'Acima da faixa.' };
  }
  const gap = actual.minus(target);
  if (g.kind === 'min') {
    if (target.isZero()) return { status: actual.gte(0) ? 'achieved' : 'missed', attainmentPct: null, gap: gap.toFixed(), note: 'Alvo zero: percentual indisponível.' };
    const pct = actual.div(target).times(100);
    if (actual.gte(target)) return { status: 'achieved', attainmentPct: pct.toFixed(), gap: gap.toFixed(), note: 'Meta mínima atingida.' };
    return { status: open ? (pct.gte(warn) ? 'on_track' : 'attention') : 'missed', attainmentPct: pct.toFixed(), gap: gap.toFixed(), note: open ? 'Período em andamento.' : 'Abaixo da meta mínima.' };
  }
  // max: menor é melhor; «atingimento» = quanto do limite foi consumido
  const used = target.isZero() ? null : actual.div(target).times(100);
  if (actual.lte(target)) return { status: 'achieved', attainmentPct: used ? used.toFixed() : null, gap: gap.toFixed(), note: 'Dentro do limite.' };
  return { status: 'missed', attainmentPct: used ? used.toFixed() : null, gap: gap.toFixed(), note: 'Acima do limite máximo.' };
}
