import 'server-only';
import type { Context } from '@/lib/auth/session';
import type { ColumnDef, DataType, Filter, FormatType, SemanticType } from './engine';
import type { MetricDef } from './engine';
import type { WidgetDisplay } from './widgets';

// Leituras: sempre pelo cliente do usuário (RLS). Valores de dados saem só por funções bi_* (consulta declarativa); aqui só metadados.

export type DatasetRow = {
  id: string; name: string; description: string | null; source_type: string; status: 'active' | 'archived'; restricted: boolean; current_version_id: string | null; created_at: string; updated_at: string;
};
export type VersionRow = {
  id: string; dataset_id: string; version_number: number; row_count: number; status: string; rows_purged: boolean; published_at: string | null; created_at: string; stats_json: { rows?: number; nulls?: Record<string, number>; rejected?: number; skipped_existing?: number };
};
export type ColumnRow = { column_key: string; display_name: string; data_type: DataType; semantic_type: SemanticType; nullable: boolean; dedupe: boolean; locale: 'br' | 'us'; position: number; metadata_json: { description?: string } };
export type MetricRow = {
  id: string; dataset_id: string; name: string; description: string | null; metric_type: 'aggregation' | 'formula'; aggregation: string | null; field_key: string | null; formula_ast_json: unknown; filters_json: Filter[];
  format_type: FormatType; unit: string | null; status: 'active' | 'invalid' | 'archived'; invalid_reason: string | null; current_version: number; created_at: string; updated_at: string;
};
export type ImportJobRow = {
  id: string; dataset_id: string; dataset_version_id: string | null; file_name: string; file_type: string; import_mode: string; status: string; total_rows: number; valid_rows: number; invalid_rows: number; skipped_existing: number;
  notes: string[]; error_message: string | null; created_at: string; completed_at: string | null; created_by: string | null;
};
export type ImportErrorRow = { row_number: number; column_key: string | null; error_code: string; error_message: string; rejected_value: string | null };
export type DimensionRow = { id: string; dataset_id: string; name: string; column_key: string; dimension_type: 'category' | 'time' };
export type ChartRow = { id: string; dataset_id: string; name: string; chart_type: string; configuration_json: Record<string, unknown>; status: string; created_at: string };
export type DashboardRow = {
  id: string; name: string; description: string | null; status: 'draft' | 'published' | 'archived'; visibility: 'private' | 'organization'; template_key: string | null; default_period: string; comparison: string;
  partial_basis: 'same_days' | 'full'; row_version: number; created_by: string | null; created_at: string; updated_at: string; published_at: string | null;
};
export type WidgetRow = {
  id: string; dashboard_id: string; dataset_id: string | null; chart_id: string | null; metric_id: string | null; widget_type: string; title: string; query_json: Record<string, unknown> | null;
  display_json: Record<string, unknown> & Partial<WidgetDisplay>; layout_json: Record<string, { x: number; y: number; w: number; h: number }>; metric_version: number | null;
};
export type DashFilterRow = { id: string; dashboard_id: string; dataset_id: string; field_key: string; label: string; operator: 'eq' | 'in' | 'between' | 'contains'; default_value_json: unknown; position: number };
export type GoalRow = {
  id: string; metric_id: string; name: string; goal_kind: 'min' | 'max' | 'growth' | 'reduction' | 'range'; period_type: 'month' | 'quarter' | 'year' | 'custom'; target_value_decimal: number; target_high_decimal: number | null;
  warn_pct: number; comparison_operator: string; scope_json: Filter[]; owner_id: string | null; status: 'active' | 'archived'; created_at: string;
};
export type GoalPeriodRow = { id: string; goal_id: string; period_start: string; period_end: string; target_value_decimal: number };
export type NotificationRow = { id: string; type: string; title: string; body: string | null; resource_type: string | null; resource_id: string | null; read_at: string | null; created_at: string };
export type SavedViewRow = { id: string; dataset_id: string; name: string; filters_json: Filter[]; columns_json: string[]; sorting_json: Array<{ field: string; dir: 'asc' | 'desc' }>; created_by: string | null; created_at: string };
export type MemberRow = { user_id: string; role: string; name: string };
export type ExportRow = { id: string; dashboard_id: string | null; dataset_id: string | null; report_type: string; row_count: number; created_at: string; created_by: string | null };

const arr = <T>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);

export async function loadDatasets(ctx: Context): Promise<DatasetRow[]> {
  const { data } = await ctx.supabase.from('datasets').select('id, name, description, source_type, status, restricted, current_version_id, created_at, updated_at').order('name');
  return arr<DatasetRow>(data);
}
export async function loadCurrentVersions(ctx: Context, ids: string[]): Promise<Map<string, VersionRow>> {
  if (!ids.length) return new Map();
  const { data } = await ctx.supabase.from('dataset_versions').select('id, dataset_id, version_number, row_count, status, rows_purged, published_at, created_at, stats_json').in('id', ids);
  return new Map(arr<VersionRow>(data).map((v) => [v.dataset_id, v]));
}
export async function loadDataset(ctx: Context, id: string): Promise<DatasetRow | null> {
  const { data } = await ctx.supabase.from('datasets').select('id, name, description, source_type, status, restricted, current_version_id, created_at, updated_at').eq('id', id).maybeSingle();
  return (data as DatasetRow | null) ?? null;
}
export async function loadVersions(ctx: Context, datasetId: string): Promise<VersionRow[]> {
  const { data } = await ctx.supabase.from('dataset_versions').select('id, dataset_id, version_number, row_count, status, rows_purged, published_at, created_at, stats_json').eq('dataset_id', datasetId).order('version_number', { ascending: false }).limit(30);
  return arr<VersionRow>(data);
}
export async function loadColumns(ctx: Context, versionId: string | null): Promise<ColumnRow[]> {
  if (!versionId) return [];
  const { data } = await ctx.supabase.from('dataset_columns').select('column_key, display_name, data_type, semantic_type, nullable, dedupe, locale, position, metadata_json').eq('dataset_version_id', versionId).order('position');
  return arr<ColumnRow>(data);
}
/** Colunas no formato do motor (chaves internas). */
export const toEngineColumns = (cols: ColumnRow[]): ColumnDef[] => cols.map((c) => ({ key: c.column_key, name: c.display_name, type: c.data_type, semantic: c.semantic_type === 'time' ? 'time' : c.semantic_type, required: !c.nullable, locale: c.locale, dedupe: c.dedupe }));

export async function loadMetrics(ctx: Context, datasetId?: string): Promise<MetricRow[]> {
  let q = ctx.supabase.from('metric_definitions').select('id, dataset_id, name, description, metric_type, aggregation, field_key, formula_ast_json, filters_json, format_type, unit, status, invalid_reason, current_version, created_at, updated_at').order('name');
  if (datasetId) q = q.eq('dataset_id', datasetId);
  const { data } = await q;
  return arr<MetricRow>(data);
}
export function metricDefs(rows: MetricRow[]): Map<string, MetricDef> {
  const m = new Map<string, MetricDef>();
  for (const r of rows) {
    if (r.metric_type === 'aggregation') m.set(r.id, { id: r.id, name: r.name, datasetId: r.dataset_id, kind: 'aggregation', agg: r.aggregation as 'sum', ...(r.field_key ? { field: r.field_key } : {}), ...(r.filters_json?.length ? { filters: r.filters_json } : {}) });
    else m.set(r.id, { id: r.id, name: r.name, datasetId: r.dataset_id, kind: 'formula', ast: r.formula_ast_json as never });
  }
  return m;
}
export async function loadDimensions(ctx: Context, datasetId: string): Promise<DimensionRow[]> {
  const { data } = await ctx.supabase.from('dimension_definitions').select('id, dataset_id, name, column_key, dimension_type').eq('dataset_id', datasetId).order('name');
  return arr<DimensionRow>(data);
}
export async function loadCharts(ctx: Context, datasetId?: string): Promise<ChartRow[]> {
  let q = ctx.supabase.from('chart_definitions').select('id, dataset_id, name, chart_type, configuration_json, status, created_at').neq('status', 'archived').order('name');
  if (datasetId) q = q.eq('dataset_id', datasetId);
  const { data } = await q;
  return arr<ChartRow>(data);
}
export async function loadImports(ctx: Context, datasetId?: string, limit = 30): Promise<ImportJobRow[]> {
  let q = ctx.supabase.from('import_jobs').select('id, dataset_id, dataset_version_id, file_name, file_type, import_mode, status, total_rows, valid_rows, invalid_rows, skipped_existing, notes, error_message, created_at, completed_at, created_by').order('created_at', { ascending: false }).limit(limit);
  if (datasetId) q = q.eq('dataset_id', datasetId);
  const { data } = await q;
  return arr<ImportJobRow>(data);
}
export async function loadImport(ctx: Context, id: string): Promise<{ job: ImportJobRow; errors: ImportErrorRow[] } | null> {
  const { data } = await ctx.supabase.from('import_jobs').select('id, dataset_id, dataset_version_id, file_name, file_type, import_mode, status, total_rows, valid_rows, invalid_rows, skipped_existing, notes, error_message, created_at, completed_at, created_by').eq('id', id).maybeSingle();
  if (!data) return null;
  const { data: errs } = await ctx.supabase.from('import_row_errors').select('row_number, column_key, error_code, error_message, rejected_value').eq('import_job_id', id).order('row_number').limit(1000);
  return { job: data as ImportJobRow, errors: arr<ImportErrorRow>(errs) };
}

export async function loadDashboards(ctx: Context): Promise<DashboardRow[]> {
  const { data } = await ctx.supabase.from('dashboards').select('id, name, description, status, visibility, template_key, default_period, comparison, partial_basis, row_version, created_by, created_at, updated_at, published_at').neq('status', 'archived').order('updated_at', { ascending: false });
  return arr<DashboardRow>(data);
}
export async function loadDashboard(ctx: Context, id: string): Promise<{ dashboard: DashboardRow; widgets: WidgetRow[]; filters: DashFilterRow[]; level: 'admin' | 'edit' | 'view' } | null> {
  const { data } = await ctx.supabase.from('dashboards').select('id, name, description, status, visibility, template_key, default_period, comparison, partial_basis, row_version, created_by, created_at, updated_at, published_at').eq('id', id).maybeSingle();
  if (!data) return null;
  const dashboard = data as DashboardRow;
  const [{ data: w }, { data: f }, { data: p }] = await Promise.all([
    ctx.supabase.from('dashboard_widgets').select('id, dashboard_id, dataset_id, chart_id, metric_id, widget_type, title, query_json, display_json, layout_json, metric_version').eq('dashboard_id', id).order('created_at'),
    ctx.supabase.from('dashboard_filters').select('id, dashboard_id, dataset_id, field_key, label, operator, default_value_json, position').eq('dashboard_id', id).order('position'),
    ctx.supabase.from('dashboard_permissions').select('permission_level').eq('dashboard_id', id).eq('user_id', ctx.user.id).maybeSingle(),
  ]);
  const role = ctx.membership.role;
  const level: 'admin' | 'edit' | 'view' = role === 'owner' || role === 'admin' || dashboard.created_by === ctx.user.id ? 'admin' : ((p as { permission_level: 'view' | 'edit' | 'admin' } | null)?.permission_level ?? 'view');
  return { dashboard, widgets: arr<WidgetRow>(w), filters: arr<DashFilterRow>(f), level };
}
export async function loadDashboardVersions(ctx: Context, id: string): Promise<Array<{ version_number: number; created_at: string; created_by: string | null }>> {
  const { data } = await ctx.supabase.from('dashboard_versions').select('version_number, created_at, created_by').eq('dashboard_id', id).order('version_number', { ascending: false }).limit(20);
  return arr(data);
}
export async function loadDashboardShares(ctx: Context, id: string): Promise<Array<{ user_id: string; permission_level: string; created_at: string }>> {
  const { data } = await ctx.supabase.from('dashboard_permissions').select('user_id, permission_level, created_at').eq('dashboard_id', id);
  return arr(data);
}
export async function loadAllShares(ctx: Context): Promise<Array<{ dashboard_id: string; user_id: string; permission_level: string; created_at: string }>> {
  const { data } = await ctx.supabase.from('dashboard_permissions').select('dashboard_id, user_id, permission_level, created_at').order('created_at', { ascending: false }).limit(500);
  return arr(data);
}
export async function loadFavoriteIds(ctx: Context): Promise<Set<string>> {
  const { data } = await ctx.supabase.from('dashboard_favorites').select('dashboard_id');
  return new Set(arr<{ dashboard_id: string }>(data).map((r) => r.dashboard_id));
}
export async function loadRecent(ctx: Context, limit = 5): Promise<Array<{ dashboard_id: string; viewed_at: string }>> {
  const { data } = await ctx.supabase.from('dashboard_views').select('dashboard_id, viewed_at').order('viewed_at', { ascending: false }).limit(limit);
  return arr(data);
}
export async function loadGoals(ctx: Context): Promise<{ goals: GoalRow[]; periods: GoalPeriodRow[] }> {
  const [{ data: g }, { data: p }] = await Promise.all([
    ctx.supabase.from('goal_definitions').select('id, metric_id, name, goal_kind, period_type, target_value_decimal, target_high_decimal, warn_pct, comparison_operator, scope_json, owner_id, status, created_at').order('created_at', { ascending: false }),
    ctx.supabase.from('goal_periods').select('id, goal_id, period_start, period_end, target_value_decimal'),
  ]);
  return { goals: arr<GoalRow>(g), periods: arr<GoalPeriodRow>(p) };
}
export async function loadNotifications(ctx: Context, limit = 100): Promise<NotificationRow[]> {
  const { data } = await ctx.supabase.from('bi_notifications').select('id, type, title, body, resource_type, resource_id, read_at, created_at').eq('user_id', ctx.user.id).order('created_at', { ascending: false }).limit(limit);
  return arr<NotificationRow>(data);
}
export async function countUnread(ctx: Context): Promise<number> {
  const { count } = await ctx.supabase.from('bi_notifications').select('id', { count: 'exact', head: true }).eq('user_id', ctx.user.id).is('read_at', null);
  return count ?? 0;
}
export async function loadPrefs(ctx: Context): Promise<Map<string, boolean>> {
  const { data } = await ctx.supabase.from('bi_notification_prefs').select('type, enabled');
  return new Map(arr<{ type: string; enabled: boolean }>(data).map((r) => [r.type, r.enabled]));
}
export async function loadViews(ctx: Context, datasetId: string): Promise<SavedViewRow[]> {
  const { data } = await ctx.supabase.from('saved_views').select('id, dataset_id, name, filters_json, columns_json, sorting_json, created_by, created_at').eq('dataset_id', datasetId).order('name');
  return arr<SavedViewRow>(data);
}
export async function loadMembers(ctx: Context): Promise<MemberRow[]> {
  const { data } = await ctx.supabase.rpc('bi_members', { p_org: ctx.membership.organization_id });
  return arr<MemberRow>(data);
}
export async function loadExports(ctx: Context, limit = 30): Promise<ExportRow[]> {
  const { data } = await ctx.supabase.from('report_exports').select('id, dashboard_id, dataset_id, report_type, row_count, created_at, created_by').order('created_at', { ascending: false }).limit(limit);
  return arr<ExportRow>(data);
}
