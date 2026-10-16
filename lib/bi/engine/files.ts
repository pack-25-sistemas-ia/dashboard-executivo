// Leitura de arquivos de importação (CSV/XLSX). Valida formato pelo CONTEÚDO (não pela extensão) e aplica os limites do MVP.
import Papa from 'papaparse';
import { readXlsx, XlsxError, type XlsxSheetInfo } from './xlsx';
import type { RawCell } from './types';

export const IMPORT_LIMITS = { fileBytes: 20 * 1024 * 1024, rows: 50_000, cols: 100, cellChars: 2000 } as const;

export class FileError extends Error {}

export type FileKind = 'csv' | 'xlsx';
export type ReadFile = {
  kind: FileKind;
  sheets: XlsxSheetInfo[];
  sheet: string | null;
  headers: string[];
  rows: RawCell[][]; // sem o cabeçalho
  notes: string[];
};

/** Decodifica UTF-8 estrito; se falhar (Excel/ERPs antigos), Windows-1252. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/** Formato real do arquivo: zip («PK») = xlsx; OLE2 = xls legado (recusado); resto precisa ser texto. */
export function sniffKind(bytes: Uint8Array, fileName: string): FileKind {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (/^(xlsm|xlsb|xls|xltm|xlam)$/.test(ext)) throw new FileError(ext === 'xls' ? 'Formato .xls (antigo) não é suportado. Salve como .xlsx ou CSV.' : 'Planilhas com macros ou formato binário não são aceitas. Salve como .xlsx ou CSV.');
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5)) return 'xlsx';
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new FileError('Formato .xls (antigo) não é suportado. Salve como .xlsx ou CSV.');
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) throw new FileError('PDF não é aceito. Envie CSV ou XLSX.');
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) throw new FileError('O arquivo não parece texto (CSV) nem planilha .xlsx.');
  if (!/^(csv|txt|tsv)$/.test(ext)) throw new FileError('Envie um arquivo .csv ou .xlsx.');
  return 'csv';
}

const isBlankRow = (r: RawCell[]) => r.every((c) => c === null || (c.t === 's' && c.v.trim() === ''));

function normalize(kind: FileKind, matrix: RawCell[][], extra: { sheets: XlsxSheetInfo[]; sheet: string | null; notes: string[] }): ReadFile {
  const rows = matrix.filter((r) => !isBlankRow(r));
  if (rows.length === 0) throw new FileError('O arquivo está vazio.');
  const head = rows[0]!;
  const width = Math.max(...rows.slice(0, 2000).map((r) => r.length));
  if (width > IMPORT_LIMITS.cols) throw new FileError(`O arquivo tem mais de ${IMPORT_LIMITS.cols} colunas.`);
  const headers: string[] = [];
  for (let i = 0; i < width; i++) {
    const c = head[i];
    headers.push(c ? (c.t === 'b' ? String(c.v) : c.v.trim()) : '');
  }
  while (headers.length && headers[headers.length - 1] === '' && rows.slice(1, 500).every((r) => r[headers.length - 1] == null)) headers.pop();
  if (headers.length === 0) throw new FileError('Não encontrei cabeçalhos na primeira linha.');
  const body = rows.slice(1);
  if (body.length === 0) throw new FileError('O arquivo tem cabeçalho, mas nenhuma linha de dados.');
  if (body.length > IMPORT_LIMITS.rows) throw new FileError(`O arquivo tem mais de ${IMPORT_LIMITS.rows.toLocaleString('pt-BR')} linhas de dados (limite do MVP).`);
  const out = body.map((r) => {
    const row: RawCell[] = [];
    for (let i = 0; i < headers.length; i++) row.push(r[i] ?? null);
    return row;
  });
  return { kind, sheets: extra.sheets, sheet: extra.sheet, headers, rows: out, notes: extra.notes };
}

export function readCsv(bytes: Uint8Array): ReadFile {
  const { text, encoding } = decodeText(bytes);
  const parsed = Papa.parse<string[]>(text, { delimiter: '', delimitersToGuess: [';', ',', '\t', '|'], skipEmptyLines: 'greedy', header: false, preview: IMPORT_LIMITS.rows + 3 });
  const fatal = parsed.errors.find((e) => e.type === 'Quotes');
  if (fatal) throw new FileError('Aspas não fechadas: o arquivo parece truncado ou malformado.');
  for (const row of parsed.data) {
    if (row.length > IMPORT_LIMITS.cols) throw new FileError(`O arquivo tem mais de ${IMPORT_LIMITS.cols} colunas.`);
    for (const cell of row) if (cell.length > IMPORT_LIMITS.cellChars) throw new FileError(`Há uma célula com mais de ${IMPORT_LIMITS.cellChars} caracteres.`);
  }
  const matrix: RawCell[][] = parsed.data.map((r) => r.map((v): RawCell => ({ t: 's', v })));
  const notes: string[] = [];
  if (encoding === 'windows-1252') notes.push('Codificação Windows-1252 detectada e convertida.');
  return normalize('csv', matrix, { sheets: [], sheet: null, notes });
}

export function readSpreadsheet(bytes: Uint8Array, sheet?: string): ReadFile {
  try {
    const x = readXlsx(bytes, sheet);
    const notes: string[] = [];
    if (x.formulaCells > 0) notes.push(`${x.formulaCells.toLocaleString('pt-BR')} célula(s) tinham fórmula: lemos apenas o valor já calculado; nenhuma fórmula é executada.`);
    if (x.truncated) throw new FileError(`A aba tem mais de ${IMPORT_LIMITS.rows.toLocaleString('pt-BR')} linhas (limite do MVP).`);
    for (const row of x.rows) for (const c of row) if (c && c.t === 's' && c.v.length > IMPORT_LIMITS.cellChars) throw new FileError(`Há uma célula com mais de ${IMPORT_LIMITS.cellChars} caracteres.`);
    return normalize('xlsx', x.rows, { sheets: x.sheets, sheet: x.selected, notes });
  } catch (e) {
    if (e instanceof XlsxError) throw new FileError(e.message);
    if (e instanceof FileError) throw e;
    throw new FileError('Não foi possível ler a planilha. Verifique se o arquivo não está corrompido.');
  }
}

/** Ponto de entrada único: valida tamanho e formato e devolve cabeçalhos + linhas brutas. */
export function readImportFile(bytes: Uint8Array, fileName: string, sheet?: string): ReadFile {
  if (bytes.length === 0) throw new FileError('O arquivo está vazio.');
  if (bytes.length > IMPORT_LIMITS.fileBytes) throw new FileError(`O arquivo passa de ${IMPORT_LIMITS.fileBytes / 1024 / 1024} MB (limite do MVP).`);
  const kind = sniffKind(bytes, fileName);
  return kind === 'xlsx' ? readSpreadsheet(bytes, sheet) : readCsv(bytes);
}
