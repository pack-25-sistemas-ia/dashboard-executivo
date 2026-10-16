// Filtros vindos da URL (a URL é a fonte: compartilhável e funciona sem JavaScript). Tudo validado; valor inválido cai no padrão.
import { PRESETS, resolvePeriod, type Preset, type Range, type ComparisonMode, COMPARISONS } from './engine';

export type SearchParams = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidOrNull = (v: string | undefined): string | null => (v && UUID.test(v) ? v.toLowerCase() : null);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export const PAGE_SIZE = 20;
export function pageFrom(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}

/** Texto de busca seguro: remove curingas e separadores. */
export function safeSearch(v: string | undefined): string | null {
  const s = (v ?? '').replace(/[%_,()*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s.length >= 2 ? s : null;
}

export type PeriodSel = { preset: Preset; range: Range; comparison: ComparisonMode };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Período e comparação do dashboard a partir da URL (?p=last_30&from=&to=&cmp=previous_period); inválido cai no padrão do dashboard. */
export function resolvePeriodSel(sp: SearchParams, today: string, defaults: { preset: Preset; comparison: ComparisonMode }): PeriodSel {
  const rawP = one(sp.p);
  const preset: Preset = (PRESETS as readonly string[]).includes(rawP ?? '') ? (rawP as Preset) : defaults.preset;
  const rawC = one(sp.cmp);
  const comparison: ComparisonMode = (COMPARISONS as readonly string[]).includes(rawC ?? '') ? (rawC as ComparisonMode) : defaults.comparison;
  const from = one(sp.from); const to = one(sp.to);
  try {
    if (preset === 'custom') {
      if (from && to && ISO.test(from) && ISO.test(to)) return { preset, range: resolvePeriod('custom', today, { from, to }), comparison };
      return { preset: defaults.preset, range: resolvePeriod(defaults.preset, today), comparison };
    }
    return { preset, range: resolvePeriod(preset, today), comparison };
  } catch {
    return { preset: defaults.preset, range: resolvePeriod(defaults.preset, today), comparison: defaults.comparison };
  }
}

/** Monta uma URL preservando os filtros atuais e alterando alguns. */
export function withParams(base: string, current: SearchParams, changes: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const s = one(v);
    if (s !== undefined && s !== '' && !(k in changes)) q.set(k, s);
  }
  for (const [k, v] of Object.entries(changes)) if (v !== null && v !== '') q.set(k, v);
  const str = q.toString();
  return str ? `${base}?${str}` : base;
}
