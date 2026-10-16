// Formatação pt-BR. Arredonda meio-para-cima só na exibição; o valor guardado continua exato.
import { D, toDec } from './decimal';

export const FORMATS = ['integer', 'decimal', 'currency', 'percentage'] as const;
export type FormatType = (typeof FORMATS)[number];
export const FORMAT_LABEL: Record<FormatType, string> = { integer: 'Número inteiro', decimal: 'Decimal', currency: 'Moeda (R$)', percentage: 'Percentual' };

export function formatValue(value: string | null | undefined, type: FormatType, opts: { decimals?: number; compact?: boolean } = {}): string {
  const d = toDec(value);
  if (!d) return '—';
  const decimals = opts.decimals ?? (type === 'integer' ? 0 : 2);
  const rounded = d.toDecimalPlaces(decimals, D.ROUND_HALF_UP).toFixed(decimals);
  if (opts.compact && type !== 'percentage' && d.abs().gte(1000)) {
    const c = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1, ...(type === 'currency' ? { style: 'currency', currency: 'BRL' } : {}) }).format(Number(rounded));
    return c;
  }
  const n = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, ...(type === 'currency' ? { style: 'currency', currency: 'BRL' } : {}) }).format(rounded as unknown as number);
  return type === 'percentage' ? `${n}%` : n;
}

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Rótulo de um período de grão temporal para eixos: 2026-03 → «mar/2026». */
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function labelBucket(iso: string, grain: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  if (grain === 'year') return m[1]!;
  if (grain === 'quarter') return `T${Math.floor((Number(m[2]) - 1) / 3) + 1}/${m[1]}`;
  if (grain === 'month') return `${MES[Number(m[2]) - 1]}/${m[1]}`;
  return `${m[3]}/${m[2]}${grain === 'week' ? ' (sem.)' : ''}`;
}
