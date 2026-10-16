import type { ColumnRow } from './data';
import { isNumeric, type Filter, type FilterOp } from './engine';
import { one, type SearchParams } from './filters';

export const FILTER_SLOTS = [1, 2, 3];

/** Filtros do explorador a partir da URL (f1/o1/v1…). Valores viram a forma canônica; o banco valida de novo. */
export function buildFilters(sp: SearchParams, cols: ColumnRow[]): Filter[] {
  const out: Filter[] = [];
  for (const n of FILTER_SLOTS) {
    const field = one(sp[`f${n}`]); const op = one(sp[`o${n}`]) as FilterOp | undefined; let val = (one(sp[`v${n}`]) ?? '').trim();
    const col = cols.find((c) => c.column_key === field);
    if (!col || !op) continue;
    if (op === 'empty' || op === 'not_empty') { out.push({ field: col.column_key, op }); continue; }
    if (!val) continue;
    if (isNumeric(col.data_type)) val = val.replace(/\./g, col.locale === 'br' && /,/.test(val) ? '' : '.').replace(',', '.');
    if (op === 'in') out.push({ field: col.column_key, op, values: val.split('|').map((s) => s.trim()).filter(Boolean) });
    else if (op === 'between') { const [a, b] = val.split('|'); if (a && b) out.push({ field: col.column_key, op, value: a.trim(), to: b.trim() }); }
    else out.push({ field: col.column_key, op, value: col.data_type === 'boolean' ? val === 'true' : val });
  }
  return out;
}
