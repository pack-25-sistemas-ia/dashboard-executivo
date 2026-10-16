import type { Filter } from './engine';

/** Atualiza o valor digitado de um filtro respeitando o operador: lista (a, b, c), intervalo (início|fim) ou valor único. */
export function setFilterValue(filters: Filter[], i: number, raw: string): Filter[] {
  return filters.map((x, j) => {
    if (j !== i) return x;
    if (x.op === 'in') return { field: x.field, op: x.op, values: raw.split(',').map((s) => s.trim()).filter(Boolean) };
    if (x.op === 'between') { const [a = '', b = ''] = raw.split('|'); return { field: x.field, op: x.op, value: a, to: b }; }
    return { field: x.field, op: x.op, value: raw };
  });
}
export const filterText = (f: Filter): string => (f.op === 'in' ? (f.values ?? []).join(', ') : f.op === 'between' ? `${f.value ?? ''}|${f.to ?? ''}` : String(f.value ?? ''));
