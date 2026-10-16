-- Dashboard Executivo — ESQUEMA: tabelas, helpers de papel, RLS (leitura) e privilégios.
-- Regra do sistema: TODA escrita passa por função SECURITY DEFINER (bi_*), que valida sessão, MFA, papel e entrada.
-- Não há privilégio de INSERT/UPDATE/DELETE para o usuário em nenhuma tabela. `dataset_rows` nem tem SELECT: linhas só saem por consulta declarativa.
-- Regra de embed do Core: tabela que referencia organization_members NÃO referencia organizations (PGRST201) — user ids são uuid sem FK, exceto onde indicado.

begin;
set local check_function_bodies = off;

-- ======================================================================= helpers de autorização
-- Perfis: owner/admin = Administrador · manager = Gestor · member = Analista · viewer = Visualizador.
create function private.bi_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;
create function private.bi_can_read(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.bi_role(org) is not null; $$;
create function private.bi_is_analyst(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.bi_role(org) in ('owner', 'admin', 'manager', 'member'), false); $$;
create function private.bi_is_manager(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.bi_role(org) in ('owner', 'admin', 'manager'), false); $$;
create function private.bi_is_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.bi_role(org) in ('owner', 'admin'), false); $$;
do $$
declare f text;
begin
  foreach f in array array['private.bi_role(uuid)', 'private.bi_can_read(uuid)', 'private.bi_is_analyst(uuid)', 'private.bi_is_manager(uuid)', 'private.bi_is_admin(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= configurações por empresa
create table public.bi_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  date_format text not null default 'DD/MM/YYYY' check (date_format in ('DD/MM/YYYY', 'YYYY-MM-DD')),
  currency text not null default 'BRL' check (currency = 'BRL'),
  portal_name text check (char_length(portal_name) <= 60),
  max_rows integer not null default 50000 check (max_rows between 1000 and 50000),
  max_file_mb integer not null default 20 check (max_file_mb between 1 and 20),
  stale_days integer not null default 7 check (stale_days between 1 and 365),
  retained_versions integer not null default 5 check (retained_versions between 2 and 20),
  default_period text not null default 'last_30' check (default_period in ('today', 'yesterday', 'last_7', 'last_30', 'this_month', 'last_month', 'this_quarter', 'this_year')),
  updated_at timestamptz not null default now()
);

-- ======================================================================= datasets
create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  source_type text not null default 'upload' check (source_type in ('upload', 'demo')),
  status text not null default 'active' check (status in ('active', 'archived')),
  restricted boolean not null default false,
  current_version_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id)
);
create unique index datasets_name_uniq on public.datasets (organization_id, lower(trim(name))) where status = 'active';

create table public.dataset_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_id uuid not null,
  version_number integer not null check (version_number >= 1),
  schema_json jsonb not null default '[]'::jsonb,
  mapping_json jsonb not null default '{}'::jsonb,
  source_import_id uuid,
  row_count integer not null default 0 check (row_count >= 0),
  stats_json jsonb not null default '{}'::jsonb,
  status text not null default 'staging' check (status in ('staging', 'published', 'superseded', 'failed')),
  rows_purged boolean not null default false,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (dataset_id, version_number),
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id) on delete cascade
);
alter table public.datasets add foreign key (current_version_id, organization_id) references public.dataset_versions (id, organization_id) deferrable initially deferred;

create table public.dataset_columns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_version_id uuid not null,
  column_key text not null check (column_key ~ '^c[1-9][0-9]{0,2}$'),
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  data_type text not null check (data_type in ('string', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'currency', 'percentage')),
  semantic_type text not null default 'dimension' check (semantic_type in ('dimension', 'measure', 'time', 'identifier')),
  nullable boolean not null default true,
  dedupe boolean not null default false,
  locale text not null default 'br' check (locale in ('br', 'us')),
  position integer not null check (position >= 0),
  metadata_json jsonb not null default '{}'::jsonb,
  unique (dataset_version_id, column_key),
  foreign key (dataset_version_id, organization_id) references public.dataset_versions (id, organization_id) on delete cascade
);

-- Linhas: chaves internas c1..cn → valor tipado (texto canônico). Sem SELECT para usuários: só consulta declarativa.
create table public.dataset_rows (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  dataset_id uuid not null,
  dataset_version_id uuid not null,
  source_row_number integer not null check (source_row_number >= 1),
  row_key text,
  values_json jsonb not null,
  imported_at timestamptz not null default now(),
  foreign key (dataset_version_id, organization_id) references public.dataset_versions (id, organization_id) on delete cascade
);
create index dataset_rows_version on public.dataset_rows (dataset_version_id);
create unique index dataset_rows_key on public.dataset_rows (dataset_version_id, row_key) where row_key is not null;

-- Permissão explícita para datasets restritos (usuário → dataset).
create table public.dataset_access (
  organization_id uuid not null,
  dataset_id uuid not null,
  user_id uuid not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  primary key (dataset_id, user_id),
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

-- ======================================================================= importação
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_id uuid not null,
  dataset_version_id uuid,
  file_name text not null check (char_length(file_name) between 1 and 200),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  file_type text not null check (file_type in ('csv', 'xlsx')),
  import_mode text not null check (import_mode in ('replace', 'append')),
  invalid_policy text not null default 'reject_all' check (invalid_policy in ('reject_all', 'skip_invalid')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'published', 'failed', 'cancelled')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  processed_rows integer not null default 0,
  skipped_existing integer not null default 0,
  notes jsonb not null default '[]'::jsonb,
  error_message text check (char_length(error_message) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, organization_id),
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id) on delete cascade
);
create unique index import_jobs_one_running on public.import_jobs (dataset_id) where status = 'processing';
create index import_jobs_dataset on public.import_jobs (dataset_id, created_at desc);
create index import_jobs_hash on public.import_jobs (dataset_id, file_hash) where status = 'published';

create table public.import_row_errors (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  import_job_id uuid not null,
  row_number integer not null,
  column_key text,
  error_code text not null check (char_length(error_code) <= 40),
  error_message text not null check (char_length(error_message) <= 300),
  rejected_value text check (char_length(rejected_value) <= 80),
  foreign key (import_job_id, organization_id) references public.import_jobs (id, organization_id) on delete cascade
);
create index import_row_errors_job on public.import_row_errors (import_job_id, row_number);

-- ======================================================================= dimensões, métricas, gráficos
create table public.dimension_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  column_key text not null check (column_key ~ '^c[1-9][0-9]{0,2}$'),
  dimension_type text not null default 'category' check (dimension_type in ('category', 'time')),
  configuration_json jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id) on delete cascade
);
create unique index dimension_name_uniq on public.dimension_definitions (dataset_id, lower(trim(name)));

create table public.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  metric_type text not null check (metric_type in ('aggregation', 'formula')),
  aggregation text check (aggregation in ('sum', 'count', 'count_distinct', 'avg', 'min', 'max')),
  field_key text check (field_key ~ '^c[1-9][0-9]{0,2}$'),
  formula_ast_json jsonb,
  filters_json jsonb not null default '[]'::jsonb,
  format_type text not null default 'decimal' check (format_type in ('integer', 'decimal', 'currency', 'percentage')),
  unit text check (char_length(unit) <= 20),
  status text not null default 'active' check (status in ('active', 'invalid', 'archived')),
  invalid_reason text check (char_length(invalid_reason) <= 300),
  current_version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id) on delete cascade,
  check ((metric_type = 'aggregation' and aggregation is not null and formula_ast_json is null) or (metric_type = 'formula' and aggregation is null and field_key is null and formula_ast_json is not null))
);
create unique index metric_name_uniq on public.metric_definitions (dataset_id, lower(trim(name))) where status <> 'archived';

create table public.metric_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  metric_id uuid not null,
  version_number integer not null check (version_number >= 1),
  definition_snapshot_json jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (metric_id, version_number),
  foreign key (metric_id, organization_id) references public.metric_definitions (id, organization_id) on delete cascade
);

create table public.chart_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  chart_type text not null check (chart_type in ('kpi', 'bar', 'line', 'area', 'pie', 'donut', 'table', 'stacked_bar', 'combo')),
  configuration_json jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id) on delete cascade
);

-- ======================================================================= dashboards
create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  visibility text not null default 'private' check (visibility in ('private', 'organization')),
  template_key text check (char_length(template_key) <= 40),
  default_period text not null default 'last_30' check (default_period in ('today', 'yesterday', 'last_7', 'last_30', 'this_month', 'last_month', 'this_quarter', 'this_year')),
  comparison text not null default 'previous_period' check (comparison in ('previous_period', 'previous_month', 'previous_year', 'none')),
  partial_basis text not null default 'same_days' check (partial_basis in ('same_days', 'full')),
  row_version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (id, organization_id)
);
create unique index dashboards_name_uniq on public.dashboards (organization_id, lower(trim(name))) where status <> 'archived';

create table public.dashboard_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dashboard_id uuid not null,
  version_number integer not null check (version_number >= 1),
  layout_snapshot_json jsonb not null,
  filters_snapshot_json jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (dashboard_id, version_number),
  foreign key (dashboard_id, organization_id) references public.dashboards (id, organization_id) on delete cascade
);

create table public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dashboard_id uuid not null,
  dataset_id uuid,
  chart_id uuid,
  metric_id uuid,
  widget_type text not null check (widget_type in ('kpi', 'chart', 'table', 'text', 'goal', 'comparison', 'alert', 'freshness')),
  title text not null check (char_length(title) <= 120),
  -- query_json: consulta declarativa JÁ validada pelo banco (medidas-base, dimensões, filtros próprios). display_json: apresentação + expressão da métrica.
  query_json jsonb,
  display_json jsonb not null default '{}'::jsonb,
  layout_json jsonb not null,
  metric_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (dashboard_id, organization_id) references public.dashboards (id, organization_id) on delete cascade,
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id),
  foreign key (chart_id, organization_id) references public.chart_definitions (id, organization_id) on delete set null (chart_id),
  foreign key (metric_id, organization_id) references public.metric_definitions (id, organization_id) on delete set null (metric_id)
);
create index dashboard_widgets_dash on public.dashboard_widgets (dashboard_id);

create table public.dashboard_filters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dashboard_id uuid not null,
  dataset_id uuid not null,
  field_key text not null check (field_key ~ '^c[1-9][0-9]{0,2}$'),
  label text not null check (char_length(label) between 1 and 60),
  operator text not null check (operator in ('eq', 'in', 'between', 'contains')),
  default_value_json jsonb,
  configuration_json jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (dashboard_id, organization_id) references public.dashboards (id, organization_id) on delete cascade,
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id)
);

create table public.dashboard_permissions (
  organization_id uuid not null,
  dashboard_id uuid not null,
  user_id uuid not null,
  permission_level text not null check (permission_level in ('view', 'edit', 'admin')),
  granted_by uuid,
  created_at timestamptz not null default now(),
  primary key (dashboard_id, user_id),
  foreign key (dashboard_id, organization_id) references public.dashboards (id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

create table public.dashboard_favorites (
  organization_id uuid not null,
  dashboard_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (dashboard_id, user_id),
  foreign key (dashboard_id, organization_id) references public.dashboards (id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

create table public.dashboard_views (
  organization_id uuid not null,
  dashboard_id uuid not null,
  user_id uuid not null,
  viewed_at timestamptz not null default now(),
  primary key (dashboard_id, user_id),
  foreign key (dashboard_id, organization_id) references public.dashboards (id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

-- ======================================================================= metas
create table public.goal_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  metric_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  goal_kind text not null check (goal_kind in ('min', 'max', 'growth', 'reduction', 'range')),
  period_type text not null check (period_type in ('month', 'quarter', 'year', 'custom')),
  target_value_decimal numeric(24,6) not null,
  target_high_decimal numeric(24,6),
  warn_pct numeric(6,2) not null default 80 check (warn_pct between 1 and 100),
  comparison_operator text not null default 'previous_period' check (comparison_operator in ('previous_period', 'previous_month', 'previous_year')),
  scope_json jsonb not null default '[]'::jsonb,
  owner_id uuid,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (metric_id, organization_id) references public.metric_definitions (id, organization_id),
  check (goal_kind <> 'range' or (target_high_decimal is not null and target_high_decimal >= target_value_decimal))
);

create table public.goal_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  goal_id uuid not null,
  period_start date not null,
  period_end date not null,
  target_value_decimal numeric(24,6) not null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (goal_id, period_start, period_end),
  foreign key (goal_id, organization_id) references public.goal_definitions (id, organization_id) on delete cascade
);

-- ======================================================================= visões salvas, exportações, atualização, avisos
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  filters_json jsonb not null default '[]'::jsonb,
  columns_json jsonb not null default '[]'::jsonb,
  sorting_json jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id) on delete cascade
);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dashboard_id uuid,
  dataset_id uuid,
  report_type text not null check (report_type in ('dashboard_csv', 'dataset_csv', 'metric_detail_csv')),
  row_count integer not null default 0,
  filters_json jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index report_exports_org on public.report_exports (organization_id, created_at desc);

create table public.data_refresh_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_id uuid not null,
  dataset_version_id uuid,
  import_job_id uuid,
  refresh_type text not null check (refresh_type in ('initial', 'replace', 'append')),
  status text not null check (status in ('started', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text check (char_length(error_message) <= 300),
  foreign key (dataset_id, organization_id) references public.datasets (id, organization_id) on delete cascade
);
create index data_refresh_dataset on public.data_refresh_events (dataset_id, started_at desc);

create table public.bi_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  type text not null check (char_length(type) <= 40),
  title text not null check (char_length(title) <= 120),
  body text check (char_length(body) <= 300),
  resource_type text check (char_length(resource_type) <= 40),
  resource_id uuid,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index bi_notifications_user on public.bi_notifications (user_id, organization_id, read_at, created_at desc);
create unique index bi_notifications_dedupe on public.bi_notifications (organization_id, user_id, dedupe_key) where dedupe_key is not null;

create table public.bi_notification_prefs (
  organization_id uuid not null,
  user_id uuid not null,
  type text not null check (char_length(type) <= 40),
  enabled boolean not null default true,
  primary key (organization_id, user_id, type),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

commit;
