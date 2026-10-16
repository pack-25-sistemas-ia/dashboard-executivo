// Aplica o mapeamento de colunas às linhas brutas: tipa cada célula, aponta erros por linha/coluna e detecta duplicidades pela chave.
import { parseCell } from './parse';
import type { ColumnDef, RawCell, StoredValue } from './types';

export type RowError = { row: number; columnKey: string | null; code: string; message: string; value?: string };
export type IngestedRow = { rowNumber: number; values: Record<string, StoredValue>; rowKey: string | null };
export type IngestResult = {
  totalRows: number;
  valid: IngestedRow[];
  invalidRows: number;
  errors: RowError[]; // truncado em MAX_RECORDED_ERRORS; invalidRows tem a contagem real
  errorsTruncated: boolean;
  duplicateInFile: number;
};

export const MAX_RECORDED_ERRORS = 1000;
const SEP = '\u001f';

const shown = (c: RawCell): string | undefined => {
  if (c === null) return undefined;
  const v = c.t === 'b' ? String(c.v) : c.v;
  return v.length > 60 ? `${v.slice(0, 57)}…` : v;
};

/**
 * `source[i]` = índice da coluna do arquivo que alimenta `columns[i]` (null = coluna sem origem → vazia).
 * Colunas com semantic = 'ignore' não devem estar em `columns` (o chamador as remove antes).
 */
export function ingest(rows: RawCell[][], columns: ColumnDef[], source: (number | null)[], tz: string, firstRowNumber = 2): IngestResult {
  const valid: IngestedRow[] = [];
  const errors: RowError[] = [];
  let invalid = 0;
  let dupes = 0;
  let truncated = false;
  const keys = new Set<string>();
  const dedupeCols = columns.filter((c) => c.dedupe);
  const push = (e: RowError) => {
    if (errors.length < MAX_RECORDED_ERRORS) errors.push(e);
    else truncated = true;
  };
  rows.forEach((raw, idx) => {
    const rowNumber = firstRowNumber + idx;
    const values: Record<string, StoredValue> = {};
    let bad = false;
    columns.forEach((col, i) => {
      const si = source[i];
      const cell = si === null || si === undefined ? null : (raw[si] ?? null);
      const r = parseCell(cell, col, tz);
      if (r.ok) values[col.key] = r.value;
      else {
        bad = true;
        push({ row: rowNumber, columnKey: col.key, code: r.code, message: r.message, value: shown(cell) });
      }
    });
    let rowKey: string | null = null;
    if (!bad && dedupeCols.length) {
      const parts = dedupeCols.map((c) => values[c.key]);
      if (parts.some((p) => p === null)) {
        bad = true;
        push({ row: rowNumber, columnKey: dedupeCols.find((c) => values[c.key] === null)!.key, code: 'key_empty', message: 'Coluna da chave de deduplicação vazia.' });
      } else {
        rowKey = parts.map((p) => String(p)).join(SEP);
        if (keys.has(rowKey)) {
          bad = true;
          dupes++;
          push({ row: rowNumber, columnKey: null, code: 'duplicate_in_file', message: 'Linha repetida no arquivo (mesma chave de deduplicação).' });
        } else keys.add(rowKey);
      }
    }
    if (bad) invalid++;
    else valid.push({ rowNumber, values, rowKey });
  });
  return { totalRows: rows.length, valid, invalidRows: invalid, errors, errorsTruncated: truncated, duplicateInFile: dupes };
}

/** Resumo de qualidade por coluna para a prévia (valores ausentes sobre as linhas válidas). */
export function nullCounts(valid: IngestedRow[], columns: ColumnDef[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(columns.map((c) => [c.key, 0]));
  for (const r of valid) for (const c of columns) if (r.values[c.key] === null || r.values[c.key] === undefined) out[c.key]!++;
  return out;
}
