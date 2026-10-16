// Leitor XLSX mínimo e seguro (D-B3): só lê VALORES em cache; fórmulas nunca são avaliadas; macros e formatos legados são recusados.
// Guarda contra «zip bomb»: tamanhos descompactados são conferidos pelo diretório central ANTES de inflar qualquer entrada.
import { unzipSync } from 'fflate';
import { D } from './decimal';
import { excelSerialToParts, isoDate } from './parse';
import type { RawCell } from './types';

export class XlsxError extends Error {}

export const XLSX_LIMITS = { totalUncompressed: 160 * 1024 * 1024, sheetUncompressed: 120 * 1024 * 1024, entries: 400, maxRows: 50_001 + 1, maxCols: 100 };

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e.startsWith('#x')) return safeChr(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return safeChr(parseInt(e.slice(1), 10));
    return ENT[e] ?? '';
  });
}
function safeChr(n: number): string {
  return Number.isFinite(n) && n >= 32 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
}
const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]!) : null;
};
const dec = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

// ---------------------------------------------------------------------------- estilos (para reconhecer datas e percentuais)
type StyleKind = 'date' | 'datetime' | 'percent' | 'other';
const BUILTIN_DATE = new Set([14, 15, 16, 17, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 45, 46, 47]);
function kindOfCode(code: string): StyleKind {
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  if (c.includes('%')) return 'percent';
  const hasDate = /[ydm]/i.test(c) && /[yd]/i.test(c);
  const hasTime = /[hs]/i.test(c);
  if (hasDate && hasTime) return 'datetime';
  if (hasDate) return 'date';
  if (hasTime) return 'datetime';
  return 'other';
}
function readStyles(xml: string | null): StyleKind[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const id = Number(attr(m[0], 'numFmtId'));
    const code = attr(m[0], 'formatCode');
    if (Number.isFinite(id) && code !== null) custom.set(id, code);
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!xfs) return [];
  const out: StyleKind[] = [];
  for (const m of xfs[1]!.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    if (id === 9 || id === 10) out.push('percent');
    else if (custom.has(id)) out.push(kindOfCode(custom.get(id)!));
    else if (BUILTIN_DATE.has(id)) out.push('date');
    else if (id === 22) out.push('datetime');
    else if (BUILTIN_TIME.has(id)) out.push('datetime');
    else out.push('other');
  }
  return out;
}

function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const inner = si[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let s = '';
    for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += t[1]!;
    out.push(unescapeXml(s));
  }
  return out;
}

export type XlsxSheetInfo = { name: string; hidden: boolean };
export type XlsxRead = { sheets: XlsxSheetInfo[]; selected: string; rows: RawCell[][]; formulaCells: number; truncated: boolean };

/** Número de célula XLSX → 15 dígitos significativos (remove ruído binário como 0,30000000000000004). */
const cleanNumber = (v: string): string | null => {
  try {
    const d = new D(v);
    return d.isFinite() ? d.toSignificantDigits(15).toFixed() : null;
  } catch { return null; }
};

export function readXlsx(bytes: Uint8Array, wantedSheet?: string): XlsxRead {
  // 1ª passada: só o diretório central (nada é inflado).
  const names: { name: string; size: number }[] = [];
  let total = 0;
  unzipSync(bytes, {
    filter: (f) => {
      names.push({ name: f.name, size: f.originalSize });
      total += f.originalSize;
      return false;
    },
  });
  if (names.length > XLSX_LIMITS.entries) throw new XlsxError('Planilha com estrutura interna incomum (arquivos demais).');
  if (names.some((n) => /vbaProject/i.test(n.name))) throw new XlsxError('A planilha contém macros (VBA). Salve como .xlsx sem macros ou exporte para CSV.');
  if (!names.some((n) => n.name === 'xl/workbook.xml')) throw new XlsxError('Arquivo não parece uma planilha .xlsx válida.');
  if (total > XLSX_LIMITS.totalUncompressed) throw new XlsxError('Planilha grande demais depois de descompactada.');
  if (names.some((n) => n.size > XLSX_LIMITS.sheetUncompressed)) throw new XlsxError('Uma das partes da planilha é grande demais.');

  // 2ª passada: só as partes necessárias.
  const files = unzipSync(bytes, {
    filter: (f) => f.name === 'xl/workbook.xml' || f.name === 'xl/_rels/workbook.xml.rels' || f.name === 'xl/sharedStrings.xml' || f.name === 'xl/styles.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(f.name),
  });
  const text = (n: string) => (files[n] ? dec(files[n]) : null);
  const wb = text('xl/workbook.xml')!;
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) relTarget.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const sheets: (XlsxSheetInfo & { path: string })[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], 'name');
    const rid = /\br:id="([^"]*)"/.exec(m[0])?.[1] ?? attr(m[0], 'id');
    const path = rid ? relTarget.get(rid) : undefined;
    if (name && path) sheets.push({ name, hidden: (attr(m[0], 'state') ?? 'visible') !== 'visible', path });
  }
  if (!sheets.length) throw new XlsxError('A planilha não tem abas legíveis.');
  const chosen = (wantedSheet ? sheets.find((s) => s.name === wantedSheet) : sheets.find((s) => !s.hidden) ?? sheets[0]);
  if (!chosen) throw new XlsxError('Aba não encontrada.');
  const sheetXml = text(chosen.path);
  if (sheetXml === null) throw new XlsxError('Aba sem conteúdo legível.');

  const strings = readSharedStrings(text('xl/sharedStrings.xml'));
  const styles = readStyles(text('xl/styles.xml'));
  const rows: RawCell[][] = [];
  let formulaCells = 0;
  let truncated = false;
  let maxCol = 0;

  for (const rm of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rn = Number(attr(rm[1]!, 'r'));
    const rowIdx = Number.isFinite(rn) && rn >= 1 ? rn - 1 : rows.length;
    if (rowIdx >= XLSX_LIMITS.maxRows) { truncated = true; break; }
    const row: RawCell[] = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1]!, 'r');
      const ci = ref ? colIndex(ref) : row.length;
      if (ci < 0 || ci >= XLSX_LIMITS.maxCols) { maxCol = Math.max(maxCol, ci + 1); continue; }
      const type = attr(cm[1]!, 't') ?? 'n';
      const styleKind = styles[Number(attr(cm[1]!, 's') ?? 0)] ?? 'other';
      const body = cm[2] ?? '';
      if (/<f\b/.test(body)) formulaCells++;
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let cell: RawCell = null;
      if (type === 's') {
        const idx = Number(v);
        cell = Number.isInteger(idx) && strings[idx] !== undefined ? { t: 's', v: strings[idx]! } : null;
      } else if (type === 'inlineStr') {
        let s = '';
        for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += t[1]!;
        cell = { t: 's', v: unescapeXml(s) };
      } else if (type === 'str') cell = v === undefined ? null : { t: 's', v: unescapeXml(v) };
      else if (type === 'b') cell = v === undefined ? null : { t: 'b', v: v.trim() === '1' };
      else if (type === 'e') cell = { t: 's', v: v ? unescapeXml(v) : '#ERRO' };
      else if (type === 'd') cell = v === undefined ? null : { t: 'd', v: unescapeXml(v) };
      else if (v !== undefined && v.trim() !== '') {
        const n = cleanNumber(v.trim());
        if (n === null) cell = { t: 's', v: v.trim() };
        else if (styleKind === 'percent') cell = { t: 's', v: `${new D(n).mul(100).toSignificantDigits(15).toFixed()}%` };
        else if (styleKind === 'date' || styleKind === 'datetime') {
          const p = excelSerialToParts(Number(n));
          if (!p) cell = { t: 'n', v: n };
          else {
            const time = styleKind === 'datetime' || Number(n) % 1 !== 0;
            cell = { t: 'd', v: time ? `${isoDate(p.y, p.m, p.d)}T${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}:${String(p.s).padStart(2, '0')}` : isoDate(p.y, p.m, p.d) };
          }
        } else cell = { t: 'n', v: n };
      }
      while (row.length < ci) row.push(null);
      row[ci] = cell;
    }
    while (rows.length < rowIdx) rows.push([]);
    rows[rowIdx] = row;
  }
  if (maxCol > XLSX_LIMITS.maxCols) throw new XlsxError(`A aba tem mais de ${XLSX_LIMITS.maxCols} colunas.`);
  return { sheets: sheets.map(({ name, hidden }) => ({ name, hidden })), selected: chosen.name, rows, formulaCells, truncated };
}
