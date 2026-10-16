// Períodos e comparações. TODAS as datas são civis (AAAA-MM-DD) no fuso da empresa e os intervalos são INCLUSIVOS nas duas pontas.
// «Hoje» é sempre recebido de fora (função pura): quem chama calcula a data de hoje no fuso da organização.
import { BiError, D, toDec } from './decimal';
import { isRealDate } from './parse';

export const PRESETS = ['today', 'yesterday', 'last_7', 'last_30', 'this_month', 'last_month', 'this_quarter', 'this_year', 'custom'] as const;
export type Preset = (typeof PRESETS)[number];
export const PRESET_LABEL: Record<Preset, string> = {
  today: 'Hoje', yesterday: 'Ontem', last_7: 'Últimos 7 dias', last_30: 'Últimos 30 dias', this_month: 'Mês atual', last_month: 'Mês anterior',
  this_quarter: 'Trimestre atual', this_year: 'Ano atual', custom: 'Período personalizado',
};
export type Range = { from: string; to: string };

const parts = (iso: string): [number, number, number] => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) throw new BiError('bad_date', 'Data inválida.');
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const fmt = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const fromMs = (ms: number) => { const t = new Date(ms); return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
const toMs = (iso: string) => { const [y, m, d] = parts(iso); return Date.UTC(y, m - 1, d); };

export const addDays = (iso: string, n: number) => fromMs(toMs(iso) + n * 86400000);
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / 86400000);
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Soma meses preservando o dia quando existe; senão usa o último dia do mês de destino (31/03 − 1 mês = 28 ou 29/02). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12);
  const nm = (t % 12 + 12) % 12 + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
export const startOfMonth = (iso: string) => { const [y, m] = parts(iso); return fmt(y, m, 1); };
export const endOfMonth = (iso: string) => { const [y, m] = parts(iso); return fmt(y, m, daysInMonth(y, m)); };
export const startOfQuarter = (iso: string) => { const [y, m] = parts(iso); return fmt(y, Math.floor((m - 1) / 3) * 3 + 1, 1); };
export const startOfYear = (iso: string) => { const [y] = parts(iso); return fmt(y, 1, 1); };

export function resolvePeriod(preset: Preset, today: string, custom?: Range): Range {
  parts(today);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'last_7': return { from: addDays(today, -6), to: today };
    case 'last_30': return { from: addDays(today, -29), to: today };
    case 'this_month': return { from: startOfMonth(today), to: today };
    case 'last_month': { const prev = addMonths(startOfMonth(today), -1); return { from: prev, to: endOfMonth(prev) }; }
    case 'this_quarter': return { from: startOfQuarter(today), to: today };
    case 'this_year': return { from: startOfYear(today), to: today };
    case 'custom': {
      if (!custom) throw new BiError('bad_period', 'Informe o início e o fim do período.');
      parts(custom.from); parts(custom.to);
      if (custom.from > custom.to) throw new BiError('bad_period', 'O início do período é depois do fim.');
      if (daysBetween(custom.from, custom.to) > 3660) throw new BiError('bad_period', 'Período longo demais (máximo de 10 anos).');
      return { from: custom.from, to: custom.to };
    }
  }
}

/** Mês/trimestre/ano atuais ainda em andamento (terminam hoje, não no último dia do período). */
export function isPartialPeriod(preset: Preset, today: string): boolean {
  if (preset === 'this_month') return today !== endOfMonth(today);
  if (preset === 'this_quarter') { const q = startOfQuarter(today); return today !== addDays(addMonths(q, 3), -1); }
  if (preset === 'this_year') return today !== `${today.slice(0, 4)}-12-31`;
  return false;
}

export const COMPARISONS = ['previous_period', 'previous_month', 'previous_year', 'none'] as const;
export type ComparisonMode = (typeof COMPARISONS)[number];
export const COMPARISON_LABEL: Record<ComparisonMode, string> = {
  previous_period: 'Período imediatamente anterior (mesma duração)', previous_month: 'Mês anterior', previous_year: 'Mesmo período do ano anterior', none: 'Sem comparação',
};
/** Para período parcial: comparar o mesmo número de dias («same_days») ou o período anterior inteiro («full»). Nunca silencioso. */
export type PartialBasis = 'same_days' | 'full';

export type ComparisonRange = Range & { basis: string };

export function comparisonRange(cur: Range, mode: Exclude<ComparisonMode, 'none'>, opts: { partial?: boolean; partialBasis?: PartialBasis } = {}): ComparisonRange {
  const len = daysBetween(cur.from, cur.to) + 1;
  if (mode === 'previous_period') {
    return { from: addDays(cur.from, -len), to: addDays(cur.from, -1), basis: `${len} dia(s) imediatamente antes` };
  }
  if (mode === 'previous_year') {
    const from = addMonths(cur.from, -12);
    const to = addMonths(cur.to, -12);
    return { from, to, basis: 'mesmo intervalo do ano anterior' };
  }
  // previous_month
  const from = addMonths(cur.from, -1);
  const fullTo = endOfMonth(from);
  if (opts.partial && (opts.partialBasis ?? 'same_days') === 'full') return { from, to: fullTo, basis: 'mês anterior completo (o atual está em andamento)' };
  if (opts.partial) {
    const to = addDays(from, len - 1);
    return { from, to: to > fullTo ? fullTo : to, basis: `mesmo número de dias (${len}) do mês anterior` };
  }
  const to = cur.from === startOfMonth(cur.from) && cur.to === endOfMonth(cur.to) ? endOfMonth(from) : addMonths(cur.to, -1);
  return { from, to, basis: 'mês anterior' };
}

// ---------------------------------------------------------------------------- variação
export type VariationState = 'ok' | 'prev_zero' | 'both_zero' | 'unavailable';
export type Variation = { state: VariationState; abs: string | null; pct: string | null; direction: 'up' | 'down' | 'flat' | null; note: string | null };

/** Variação % = (atual − anterior) ÷ anterior × 100. Anterior zero → nunca «infinito». */
export function variation(current: string | null, previous: string | null): Variation {
  const c = toDec(current);
  const p = toDec(previous);
  if (!c || !p) return { state: 'unavailable', abs: null, pct: null, direction: null, note: 'Sem dados em um dos períodos.' };
  const abs = c.minus(p);
  const dir = abs.isZero() ? 'flat' : abs.gt(0) ? 'up' : 'down';
  if (p.isZero()) {
    return c.isZero()
      ? { state: 'both_zero', abs: '0', pct: null, direction: 'flat', note: 'Os dois períodos valem zero.' }
      : { state: 'prev_zero', abs: abs.toFixed(), pct: null, direction: dir, note: 'O período anterior vale zero: variação percentual indisponível.' };
  }
  return { state: 'ok', abs: abs.toFixed(), pct: abs.div(p.abs()).times(100).toFixed(), direction: dir, note: null };
}
export const pctText = (v: string | null, digits = 1) => (v === null ? '—' : `${new D(v).toDecimalPlaces(digits).toFixed(digits).replace('.', ',')}%`);
