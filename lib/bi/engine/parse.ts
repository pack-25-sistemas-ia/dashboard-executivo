// Leitura tipada de células (padrões brasileiros). Puro e determinístico; o servidor é a fonte da verdade da importação.
import { D, toDec } from './decimal';
import type { ColumnDef, DataType, RawCell, StoredValue } from './types';

export type CellResult = { ok: true; value: StoredValue } | { ok: false; code: string; message: string };
const bad = (code: string, message: string): CellResult => ({ ok: false, code, message });
const good = (value: StoredValue): CellResult => ({ ok: true, value });

export const MAX_STRING = 500;
export const MAX_INT_DIGITS = 15;
export const MAX_DECIMALS = 6;
const SPACES = /[  \s]/g;

// ---------------------------------------------------------------------------- números
const BR_THOUSANDS = /^\d{1,3}(\.\d{3})+(,\d+)?$/;
const US_THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

/** Texto → decimal canônico. `locale` decide quem é o separador decimal; milhar só em grupos de 3. */
export function parseNumber(input: string, locale: 'br' | 'us'): { ok: true; value: string } | { ok: false; reason: string } {
  let s = input.replace(SPACES, '').replace(/^(-?)R\$/i, '$1');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s === '' || /[^0-9.,]/.test(s)) return { ok: false, reason: 'não é um número' };
  let canon: string;
  if (locale === 'br') {
    if (s.includes('.') && !BR_THOUSANDS.test(s)) return { ok: false, reason: 'ponto fora do padrão brasileiro (milhar em grupos de 3); use vírgula decimal' };
    if ((s.match(/,/g) ?? []).length > 1) return { ok: false, reason: 'mais de uma vírgula decimal' };
    canon = s.replaceAll('.', '').replace(',', '.');
  } else {
    if (s.includes(',') && !US_THOUSANDS.test(s)) return { ok: false, reason: 'vírgula fora do padrão (milhar em grupos de 3)' };
    if ((s.match(/\./g) ?? []).length > 1) return { ok: false, reason: 'mais de um ponto decimal' };
    canon = s.replaceAll(',', '');
  }
  if (!/^\d+(\.\d+)?$/.test(canon)) return { ok: false, reason: 'não é um número' };
  const d = toDec(canon);
  if (!d) return { ok: false, reason: 'não é um número' };
  if (d.decimalPlaces() > MAX_DECIMALS) return { ok: false, reason: `mais de ${MAX_DECIMALS} casas decimais` };
  if (d.abs().trunc().toFixed().length > MAX_INT_DIGITS) return { ok: false, reason: 'valor grande demais' };
  return { ok: true, value: (neg && !d.isZero() ? d.neg() : d).toFixed() };
}

// ---------------------------------------------------------------------------- datas
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
export const isoDate = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

export type DateParts = { y: number; m: number; d: number; h?: number; mi?: number; s?: number; offset?: string };
const DATE_BR = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Reconhece DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA e ISO. Ano de 2 dígitos é recusado (ambíguo). */
export function parseDateParts(input: string): DateParts | null {
  const s = input.trim();
  let m = DATE_ISO.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!isRealDate(y, mo, d)) return null;
    const p: DateParts = { y, m: mo, d };
    if (m[4] !== undefined) { p.h = Number(m[4]); p.mi = Number(m[5]); p.s = Number(m[6] ?? 0); }
    if (m[7]) p.offset = m[7] === 'Z' ? '+00:00' : m[7].includes(':') ? m[7] : `${m[7].slice(0, 3)}:${m[7].slice(3)}`;
    if (p.h !== undefined && (p.h > 23 || (p.mi ?? 0) > 59 || (p.s ?? 0) > 59)) return null;
    return p;
  }
  m = DATE_BR.exec(s);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!isRealDate(y, mo, d)) return null;
    const p: DateParts = { y, m: mo, d };
    if (m[4] !== undefined) {
      p.h = Number(m[4]); p.mi = Number(m[5]); p.s = Number(m[6] ?? 0);
      if (p.h > 23 || p.mi > 59 || p.s > 59) return null;
    }
    return p;
  }
  return null;
}

// ---------------------------------------------------------------------------- fuso horário
function offsetMinutesAt(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}
export function fmtOffset(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
/** Hora de parede no fuso → instante ISO com deslocamento («2026-03-05T10:30:00-03:00»). */
export function zonedToIso(y: number, m: number, d: number, h: number, mi: number, s: number, tz: string): string {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let off = offsetMinutesAt(guess, tz);
  const t = guess - off * 60000;
  const off2 = offsetMinutesAt(t, tz);
  if (off2 !== off) off = off2;
  return `${isoDate(y, m, d)}T${pad(h)}:${pad(mi)}:${pad(s)}${fmtOffset(off)}`;
}

/** Data civil (AAAA-MM-DD) de um instante no fuso informado. */
export function civilDateIn(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

// Excel: série 1 = 1900-01-01 com o defeito do ano bissexto de 1900; a época 1899-12-30 acerta de 61 em diante.
export function excelSerialToParts(serial: number): { y: number; m: number; d: number; h: number; mi: number; s: number } | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const days = Math.floor(serial);
  const secs = Math.round((serial - days) * 86400);
  const t = new Date(Date.UTC(1899, 11, 30) + days * 86400000 + secs * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
}

// ---------------------------------------------------------------------------- booleano e texto
const TRUE_SET = new Set(['true', 'verdadeiro', 'sim', 's', 'yes', 'y', '1']);
const FALSE_SET = new Set(['false', 'falso', 'nao', 'não', 'n', 'no', '0']);
export function parseBool(input: string): boolean | null {
  const k = input.trim().toLowerCase();
  if (TRUE_SET.has(k)) return true;
  if (FALSE_SET.has(k)) return false;
  return null;
}
export function cleanText(input: string): string {
  return input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[\r\n\t]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------- célula → valor tipado
const isBlank = (c: RawCell) => c === null || (c.t === 's' && c.v.trim() === '');

export function parseCell(raw: RawCell, col: Pick<ColumnDef, 'type' | 'locale' | 'required' | 'name'>, tz: string): CellResult {
  if (isBlank(raw)) return col.required ? bad('required', `«${col.name}» é obrigatória e veio vazia.`) : good(null);
  const c = raw as Exclude<RawCell, null>;
  const text = c.t === 'b' ? (c.v ? 'true' : 'false') : c.v.trim();
  switch (col.type) {
    case 'string': {
      const v = cleanText(text);
      if (v.length > MAX_STRING) return bad('too_long', `Texto com mais de ${MAX_STRING} caracteres.`);
      if (v === '') return col.required ? bad('required', `«${col.name}» é obrigatória e veio vazia.`) : good(null);
      return good(v);
    }
    case 'boolean': {
      if (c.t === 'b') return good(c.v);
      const b = parseBool(text);
      return b === null ? bad('invalid_boolean', 'Esperado sim/não, verdadeiro/falso ou 1/0.') : good(b);
    }
    case 'integer':
    case 'decimal':
    case 'currency':
    case 'percentage': {
      // XLSX entrega número nativo (independe de formato regional); texto segue a convenção da coluna.
      const r = c.t === 'n' ? parseNumber(c.v, 'us') : parseNumber(text.replace(/%$/, ''), col.locale);
      if (!r.ok) return bad('invalid_number', `Número inválido: ${r.reason}.`);
      if (col.type === 'integer' && !new D(r.value).isInteger()) return bad('not_integer', 'Esperado número inteiro (sem casas decimais).');
      return good(r.value);
    }
    case 'date': {
      if (c.t === 'n') {
        const p = excelSerialToParts(Number(c.v));
        return p ? good(isoDate(p.y, p.m, p.d)) : bad('invalid_date', 'Número não corresponde a uma data.');
      }
      const p = parseDateParts(text);
      return p ? good(isoDate(p.y, p.m, p.d)) : bad('invalid_date', 'Data inválida. Use DD/MM/AAAA ou AAAA-MM-DD.');
    }
    case 'timestamp': {
      const p = c.t === 'n' ? excelSerialToParts(Number(c.v)) : parseDateParts(text);
      if (!p) return bad('invalid_timestamp', 'Data e hora inválidas. Use DD/MM/AAAA HH:MM ou AAAA-MM-DDTHH:MM:SS.');
      const off = (p as DateParts).offset;
      if (off) return good(`${isoDate(p.y, p.m, p.d)}T${pad(p.h ?? 0)}:${pad(p.mi ?? 0)}:${pad(p.s ?? 0)}${off}`);
      return good(zonedToIso(p.y, p.m, p.d, p.h ?? 0, p.mi ?? 0, p.s ?? 0, tz));
    }
  }
}

export function typeLabel(t: DataType): string {
  return { string: 'Texto', integer: 'Número inteiro', decimal: 'Decimal', boolean: 'Sim/Não', date: 'Data', timestamp: 'Data e hora', currency: 'Moeda (R$)', percentage: 'Percentual' }[t];
}
