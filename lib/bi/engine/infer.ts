// Sugestão de tipo por coluna a partir de uma amostra. É só sugestão: o usuário confirma o tipo antes da validação.
import { parseCell } from './parse';
import type { ColumnDef, DataType, RawCell, SemanticType } from './types';

export type Inference = {
  type: DataType;
  locale: 'br' | 'us';
  nonEmpty: number;
  /** Texto de aviso quando a sugestão é ambígua (ex.: «1.234» pode ser 1234 ou 1,234). */
  warning: string | null;
};

const blank = (c: RawCell) => c === null || (c.t === 's' && c.v.trim() === '');
const ORDER: DataType[] = ['boolean', 'integer', 'date', 'timestamp', 'percentage', 'currency', 'decimal'];
const TZ = 'America/Sao_Paulo';

function allParse(cells: RawCell[], type: DataType, locale: 'br' | 'us'): boolean {
  return cells.every((c) => parseCell(c, { type, locale, required: false, name: 'x' }, TZ).ok);
}

/** Heurística: percentual exige «%» em todos; moeda exige «R$» em todos; data com hora vira timestamp. */
export function inferColumn(sample: RawCell[]): Inference {
  const cells = sample.filter((c) => !blank(c));
  const nonEmpty = cells.length;
  if (nonEmpty === 0) return { type: 'string', locale: 'br', nonEmpty: 0, warning: 'Coluna vazia na amostra.' };
  const texts = cells.map((c) => (c && c.t !== 'b' ? c.v.trim() : String(c?.v)));
  const allNative = cells.every((c) => c?.t === 'n' || c?.t === 'd' || c?.t === 'b');
  // Locale: vírgula decimal (1.234,56 / 12,5) → br; ponto decimal fora do padrão de milhar (12.5) → us.
  const hasBrComma = texts.some((t) => /\d,\d/.test(t));
  const hasUsDot = texts.some((t) => /\d\.\d{1,2}$/.test(t) || /\d\.\d{4,}$/.test(t));
  const locale: 'br' | 'us' = hasUsDot && !hasBrComma ? 'us' : 'br';
  let warning: string | null = null;
  if (!allNative && !hasBrComma && texts.some((t) => /^\d{1,3}(\.\d{3})+$/.test(t))) warning = 'Há valores como «1.234»: interpretados como milhar (1234). Altere o formato se forem decimais.';

  if (cells.every((c) => c?.t === 'b')) return { type: 'boolean', locale, nonEmpty, warning };
  if (!allNative && texts.every((t) => /^%?-?[\d.,]+%$|^-?[\d.,]+\s*%$/.test(t)) && allParse(cells, 'percentage', locale)) return { type: 'percentage', locale, nonEmpty, warning };
  if (!allNative && texts.every((t) => /^-?\s*R\$/i.test(t)) && allParse(cells, 'currency', locale)) return { type: 'currency', locale, nonEmpty, warning };
  // «0/1» e «sim/não» como booleano só quando há pelo menos um valor textual (para não confundir 0/1 numérico com sim/não).
  const boolWords = texts.every((t) => /^(true|false|verdadeiro|falso|sim|n[aã]o|yes|no)$/i.test(t));
  if (boolWords) return { type: 'boolean', locale, nonEmpty, warning };
  for (const type of ORDER) {
    if (type === 'boolean' || type === 'percentage' || type === 'currency') continue;
    if (type === 'timestamp') {
      const withTime = texts.every((t) => /\d{1,2}:\d{2}/.test(t)) || cells.every((c) => c?.t === 'd' && /T\d/.test(c.v));
      if (!withTime) continue;
    }
    if (type === 'date' && texts.every((t) => /\d{1,2}:\d{2}/.test(t))) continue;
    // número nativo (XLSX) só é data quando a célula TEM formato de data; senão 12,5 viraria «12/01/1900»
    if ((type === 'date' || type === 'timestamp') && cells.some((c) => c?.t === 'n')) continue;
    if (allParse(cells, type, locale)) {
      if (type === 'integer' && texts.some((t) => /^0\d+$/.test(t))) return { type: 'string', locale, nonEmpty, warning: 'Valores com zeros à esquerda (códigos) ficam como texto.' };
      return { type, locale, nonEmpty, warning };
    }
  }
  return { type: 'string', locale, nonEmpty, warning };
}

const TIME_HINT = /\b(data|date|dia|mes|m[eê]s|ano|periodo|per[ií]odo|criad|competencia|compet[eê]ncia)\b/i;
const MEASURE_TYPES: DataType[] = ['integer', 'decimal', 'currency', 'percentage'];

/** Papel semântico sugerido: tempo, medida ou dimensão (o usuário pode trocar). */
export function suggestSemantic(name: string, type: DataType): SemanticType {
  if (type === 'date' || type === 'timestamp') return 'time';
  if (MEASURE_TYPES.includes(type)) return /\b(id|codigo|c[oó]digo|cpf|cnpj|telefone)\b/i.test(name) ? 'identifier' : 'measure';
  if (TIME_HINT.test(name) && type === 'string') return 'dimension';
  return /\b(id|codigo|c[oó]digo|cpf|cnpj)\b/i.test(name) ? 'identifier' : 'dimension';
}

/** Cabeçalhos viram colunas internas c1..cn; duplicados e vazios recebem rótulos distintos. */
export function buildColumns(headers: string[], inferences: Inference[]): ColumnDef[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const base = h.trim().slice(0, 80) || `Coluna ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    const name = n > 1 ? `${base} (${n})` : base;
    const inf = inferences[i] ?? { type: 'string' as const, locale: 'br' as const };
    return { key: `c${i + 1}`, name, type: inf.type, semantic: suggestSemantic(name, inf.type), required: false, locale: inf.locale, dedupe: false };
  });
}

/** Cabeçalhos duplicados, para avisar o usuário (a importação não os descarta: renomeia). */
export function duplicateHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const h of headers) {
    const k = h.trim().toLowerCase();
    if (seen.has(k)) dup.add(h.trim());
    seen.add(k);
  }
  return [...dup];
}
