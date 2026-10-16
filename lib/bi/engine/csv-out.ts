// Escrita segura de CSV: neutraliza injeção de fórmula (=, +, -, @, TAB, CR) em TEXTO; números formais passam como {num}.
export type NumCell = { num: string };
export type CsvValue = string | number | boolean | null | undefined | NumCell;

export function safeCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const raw = typeof v === 'string' ? v : v.num;
  const text = typeof v === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[";\n\r,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV com ponto-e-vírgula, BOM e CRLF (abre direto no Excel brasileiro). */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header.map(safeCell).join(';'), ...rows.map((r) => r.map(safeCell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
