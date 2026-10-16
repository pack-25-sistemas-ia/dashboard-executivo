// Tipos de domínio do BI. Chaves de coluna são INTERNAS (c1..cn): o nome vindo do arquivo é só rótulo.
export const DATA_TYPES = ['string', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'currency', 'percentage'] as const;
export type DataType = (typeof DATA_TYPES)[number];
export const NUMERIC_TYPES: readonly DataType[] = ['integer', 'decimal', 'currency', 'percentage'];
export const TEMPORAL_TYPES: readonly DataType[] = ['date', 'timestamp'];
export const isNumeric = (t: DataType) => NUMERIC_TYPES.includes(t);
export const isTemporal = (t: DataType) => TEMPORAL_TYPES.includes(t);

export const SEMANTIC_TYPES = ['dimension', 'measure', 'time', 'identifier', 'ignore'] as const;
export type SemanticType = (typeof SEMANTIC_TYPES)[number];

export const COLUMN_KEY_RE = /^c[1-9][0-9]{0,2}$/;

export type ColumnDef = {
  key: string; // c1..cn
  name: string; // rótulo exibido
  type: DataType;
  semantic: SemanticType;
  required: boolean;
  /** Formato numérico de origem para texto: 'br' (1.234,56) ou 'us' (1,234.56). */
  locale: 'br' | 'us';
  dedupe: boolean; // participa da chave de deduplicação
  description?: string;
};

/** Valor lido do arquivo antes da tipagem. CSV só produz 's'; XLSX produz tipos nativos. */
export type RawCell = { t: 's'; v: string } | { t: 'n'; v: string } | { t: 'd'; v: string } | { t: 'b'; v: boolean } | null;

/** Valor tipado como é gravado em `values_json`. */
export type StoredValue = string | boolean | null;

export const AGGREGATIONS = ['sum', 'count', 'count_distinct', 'avg', 'min', 'max'] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const FILTER_OPS = ['eq', 'neq', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export type Filter = { field: string; op: FilterOp; value?: string | boolean | null; values?: (string | boolean)[]; to?: string };

export const GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type Grain = (typeof GRAINS)[number];

export type Measure = { alias: string; agg: Aggregation; field?: string; filters?: Filter[] };
export type Dimension = { field: string; grain?: Grain };
export type QueryPeriod = { field: string; from: string; to: string }; // datas ISO, ambas inclusivas, no fuso da empresa
export type QuerySpec = {
  dataset_id: string;
  measures: Measure[];
  dimensions?: Dimension[];
  filters?: Filter[];
  period?: QueryPeriod;
  order?: { by: string; dir: 'asc' | 'desc' }[]; // by = alias da medida ou «d0», «d1»… da dimensão
  limit?: number;
};
export const MAX_QUERY_LIMIT = 1000;
export const MAX_MEASURES = 12;
export const MAX_DIMENSIONS = 2;
export const MAX_FILTERS = 20;
