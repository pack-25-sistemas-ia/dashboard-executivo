import { z } from 'zod';
import { AGGREGATIONS, DATA_TYPES, FILTER_OPS, GRAINS, SEMANTIC_TYPES } from './engine';
import { CHART_TYPES } from './engine';
import { FORMATS } from './engine';
import { COMPARISONS, PRESETS } from './engine';
import { GOAL_KINDS } from './engine';

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Identificador inválido.');
export const idSchema = z.object({ id: uuid });
const text = (max: number, min = 0) => z.string().trim().min(min).max(max);
const opt = (max: number) => z.string().trim().max(max).transform((s) => (s === '' ? null : s));
const bool = z.string().optional().transform((v) => v === 'on' || v === 'true');
const num = (min: number, max: number) => z.string().trim().min(1, 'Informe um número.').regex(/^-?\d+([.,]\d+)?$/, 'Número inválido.').transform((s) => Number(s.replace(',', '.'))).pipe(z.number().min(min).max(max));
const json = <T extends z.ZodTypeAny>(schema: T, fallback: unknown = []) =>
  z.string().optional().transform((s, ctx) => {
    if (s === undefined || s === '') return fallback;
    try { return JSON.parse(s) as unknown; } catch { ctx.addIssue({ code: 'custom', message: 'Configuração inválida.' }); return z.NEVER; }
  }).pipe(schema);

export const filterSchema = z.object({
  field: z.string().regex(/^c[1-9][0-9]{0,2}$/), op: z.enum(FILTER_OPS), value: z.union([z.string().max(200), z.boolean()]).optional(), values: z.array(z.union([z.string().max(200), z.boolean()])).max(50).optional(), to: z.string().max(200).optional(),
});

// ----------------------------------------------------------------------------- datasets
export const datasetSchema = z.object({ name: text(80, 1), description: opt(500), restricted: bool });
export const datasetEditSchema = datasetSchema.extend({ id: uuid });
export const accessSchema = z.object({ dataset_id: uuid, user_id: uuid, grant: bool });
export const columnsEditSchema = z.object({
  dataset_id: uuid,
  columns: json(z.array(z.object({ key: z.string().regex(/^c[1-9][0-9]{0,2}$/), name: text(80, 1), semantic: z.enum(['dimension', 'measure', 'time', 'identifier']), description: text(300).optional() })).max(100)),
});

// ----------------------------------------------------------------------------- importação
export const importColumnSchema = z.object({
  src: z.number().int().min(0).max(99).nullable(), existingKey: z.string().regex(/^c[1-9][0-9]{0,2}$/).nullable(), name: text(80, 1), type: z.enum(DATA_TYPES), semantic: z.enum(SEMANTIC_TYPES),
  required: z.boolean(), locale: z.enum(['br', 'us']), dedupe: z.boolean(), ignore: z.boolean(),
});
export const importRunSchema = z.object({
  dataset_id: uuid.nullable(), new_name: text(80).nullable(), mode: z.enum(['replace', 'append']), invalid_policy: z.enum(['reject_all', 'skip_invalid']), sheet: text(100).nullable(), columns: z.array(importColumnSchema).min(1).max(100),
});
export const publishImportSchema = z.object({ id: uuid, ack: bool });

// ----------------------------------------------------------------------------- indicadores, dimensões, gráficos
const astSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.object({ op: z.literal('ref'), metric: uuid }), z.object({ op: z.literal('num'), value: z.string().regex(/^-?\d{1,15}(\.\d{1,6})?$/) }),
  z.object({ op: z.enum(['add', 'sub', 'mul', 'div']), l: astSchema, r: astSchema }),
]));
export const metricSchema = z.object({
  id: z.string().optional().transform((v) => (v ? v : null)).pipe(uuid.nullable()), dataset_id: uuid, name: text(80, 1), description: opt(500), metric_type: z.enum(['aggregation', 'formula']),
  aggregation: z.enum(AGGREGATIONS).optional(), field_key: z.string().regex(/^c[1-9][0-9]{0,2}$/).optional().or(z.literal('')), format_type: z.enum(FORMATS), unit: opt(20),
  filters: json(z.array(filterSchema).max(20)), ast: json(astSchema.nullable(), null),
});
export const dimensionSchema = z.object({ id: z.string().optional().transform((v) => (v ? v : null)).pipe(uuid.nullable()), dataset_id: uuid, name: text(80, 1), column_key: z.string().regex(/^c[1-9][0-9]{0,2}$/), dimension_type: z.enum(['category', 'time']) });
export const dimIdSchema = z.object({ id: uuid });
export const chartBuilderSchema = z.object({
  dataset_id: uuid, chart: z.enum(CHART_TYPES), metric_ids: z.array(uuid).min(1).max(12),
  dims: z.array(z.object({ field: z.string().regex(/^c[1-9][0-9]{0,2}$/), grain: z.enum(GRAINS).optional() })).max(2),
  filters: z.array(filterSchema).max(20), period_field: z.string().regex(/^c[1-9][0-9]{0,2}$/).nullable(), title: text(120),
});
export const chartSaveSchema = z.object({ id: z.string().optional().transform((v) => (v ? v : null)).pipe(uuid.nullable()), name: text(80, 1), builder: json(chartBuilderSchema, {}) });

// ----------------------------------------------------------------------------- dashboards
export const dashCreateSchema = z.object({ name: text(80, 1), description: opt(500), template: z.string().max(40).optional() });
export const layoutBp = z.object({ x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(1000), w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(30) });
export const widgetInSchema = z.object({
  id: z.string().nullable().optional(), kind: z.enum(['chart', 'text', 'goal', 'freshness', 'alert']), title: text(120), layout: z.object({ lg: layoutBp, md: layoutBp.optional(), sm: layoutBp.optional() }),
  builder: chartBuilderSchema.optional(), chart_id: uuid.nullable().optional(), text: text(2000).optional(), goal_id: uuid.optional(), comparison: z.boolean().optional(), keep: z.boolean().optional(),
});
export const dashFilterInSchema = z.object({ id: z.string().nullable().optional(), dataset_id: uuid, field_key: z.string().regex(/^c[1-9][0-9]{0,2}$/), label: text(60, 1), operator: z.enum(['eq', 'in', 'between', 'contains']) });
export const dashSaveSchema = z.object({
  id: uuid, expected: z.coerce.number().int().min(1), name: text(80, 1), description: opt(500), default_period: z.enum(PRESETS.filter((p) => p !== 'custom') as unknown as [string, ...string[]]),
  comparison: z.enum(COMPARISONS), partial_basis: z.enum(['same_days', 'full']),
  widgets: json(z.array(widgetInSchema).max(40)), filters: json(z.array(dashFilterInSchema).max(8)),
});
export const publishDashSchema = z.object({ id: uuid, visibility: z.enum(['private', 'organization']) });
export const shareSchema = z.object({ dashboard_id: uuid, user_id: uuid, level: z.enum(['view', 'edit', 'admin']) });
export const revokeSchema = z.object({ dashboard_id: uuid, user_id: uuid });
export const duplicateSchema = z.object({ id: uuid, name: text(80, 1) });
export const restoreSchema = z.object({ id: uuid, version: z.coerce.number().int().min(1), expected: z.coerce.number().int().min(1) });
export const favoriteSchema = z.object({ id: uuid, on: bool });

// ----------------------------------------------------------------------------- metas, visões, configurações
export const goalSchema = z.object({
  id: z.string().optional().transform((v) => (v ? v : null)).pipe(uuid.nullable()), metric_id: uuid, name: text(80, 1), kind: z.enum(GOAL_KINDS), period_type: z.enum(['month', 'quarter', 'year', 'custom']),
  target: num(-1e15, 1e15), target_high: z.string().optional().transform((v) => (v === undefined || v === '' ? null : Number(v.replace(',', '.')))).pipe(z.number().min(-1e15).max(1e15).nullable()),
  warn_pct: num(1, 100), comparison: z.enum(['previous_period', 'previous_month', 'previous_year']), owner_id: z.string().optional().transform((v) => (v ? v : null)).pipe(uuid.nullable()),
});
export const goalPeriodSchema = z.object({ goal_id: uuid, start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'), target: num(-1e15, 1e15) });
export const viewSchema = z.object({ id: z.string().optional().transform((v) => (v ? v : null)).pipe(uuid.nullable()), dataset_id: uuid, name: text(80, 1), filters: json(z.array(filterSchema).max(20)), columns: json(z.array(z.string().regex(/^c[1-9][0-9]{0,2}$/)).max(100)), sorting: json(z.array(z.object({ field: z.string().regex(/^c[1-9][0-9]{0,2}$/), dir: z.enum(['asc', 'desc']) })).max(3)) });
export const settingsSchema = z.object({
  timezone: text(60, 1), date_format: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD']), portal_name: opt(60), max_rows: num(1000, 50000), max_file_mb: num(1, 20), stale_days: num(1, 365), retained_versions: num(2, 20),
  default_period: z.enum(PRESETS.filter((p) => p !== 'custom') as unknown as [string, ...string[]]),
});
export const prefSchema = z.object({ type: text(40, 1), enabled: bool });
