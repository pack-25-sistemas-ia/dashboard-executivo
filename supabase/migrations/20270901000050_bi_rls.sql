-- Dashboard Executivo — RLS (somente leitura para o usuário) e MFA no banco.
-- Escrita: exclusivamente funções bi_* (SECURITY DEFINER). Nenhum INSERT/UPDATE/DELETE concedido; dataset_rows não tem nem SELECT.

begin;
set local check_function_bodies = off;

-- Dataset visível: analista+ e, se restrito, administrador ou autorizado explicitamente.
create function private.bi_dataset_visible(org uuid, ds uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.bi_is_analyst(org) and exists (
    select 1 from public.datasets d
    where d.id = ds and d.organization_id = org
      and (not d.restricted or private.bi_is_admin(org)
           or exists (select 1 from public.dataset_access a where a.dataset_id = d.id and a.user_id = (select auth.uid())))
  );
$$;

-- Nível do usuário no dashboard: admin (administrador da empresa, criador ou concedido), edit, view ou null.
create function private.bi_dashboard_level(org uuid, dash uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when private.bi_role(org) is null then null
    else (
      select case
        when private.bi_is_admin(org) or d.created_by = (select auth.uid()) then 'admin'
        when p.permission_level is not null then p.permission_level
        when d.visibility = 'organization' and d.status = 'published' then 'view'
        else null end
      from public.dashboards d
      left join public.dashboard_permissions p on p.dashboard_id = d.id and p.user_id = (select auth.uid())
      where d.id = dash and d.organization_id = org
    ) end;
$$;
create function private.bi_dashboard_visible(org uuid, dash uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.bi_dashboard_level(org, dash) is not null; $$;

do $$
declare f text;
begin
  foreach f in array array['private.bi_dataset_visible(uuid, uuid)', 'private.bi_dashboard_level(uuid, uuid)', 'private.bi_dashboard_visible(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------- habilitar RLS e conceder só SELECT
do $$
declare t text;
begin
  foreach t in array array['bi_settings', 'datasets', 'dataset_versions', 'dataset_columns', 'dataset_rows', 'dataset_access', 'import_jobs', 'import_row_errors', 'dimension_definitions',
    'metric_definitions', 'metric_versions', 'chart_definitions', 'dashboards', 'dashboard_versions', 'dashboard_widgets', 'dashboard_filters', 'dashboard_permissions', 'dashboard_favorites',
    'dashboard_views', 'goal_definitions', 'goal_periods', 'saved_views', 'report_exports', 'data_refresh_events', 'bi_notifications', 'bi_notification_prefs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    if t <> 'dataset_rows' then execute format('grant select on public.%I to authenticated', t); end if;
  end loop;
end $$;

create policy bi_settings_select on public.bi_settings for select to authenticated using (private.bi_can_read(organization_id));

create policy datasets_select on public.datasets for select to authenticated using (private.bi_dataset_visible(organization_id, id));
create policy dataset_versions_select on public.dataset_versions for select to authenticated using (private.bi_dataset_visible(organization_id, dataset_id));
create policy dataset_columns_select on public.dataset_columns for select to authenticated
  using (exists (select 1 from public.dataset_versions v where v.id = dataset_version_id and v.organization_id = organization_id and private.bi_dataset_visible(v.organization_id, v.dataset_id)));
create policy import_jobs_select on public.import_jobs for select to authenticated using (private.bi_dataset_visible(organization_id, dataset_id));
create policy import_row_errors_select on public.import_row_errors for select to authenticated
  using (exists (select 1 from public.import_jobs j where j.id = import_job_id and j.organization_id = organization_id and private.bi_dataset_visible(j.organization_id, j.dataset_id)));
create policy dimensions_select on public.dimension_definitions for select to authenticated using (private.bi_dataset_visible(organization_id, dataset_id));
create policy metrics_select on public.metric_definitions for select to authenticated using (private.bi_dataset_visible(organization_id, dataset_id));
create policy metric_versions_select on public.metric_versions for select to authenticated
  using (exists (select 1 from public.metric_definitions m where m.id = metric_id and m.organization_id = organization_id and private.bi_dataset_visible(m.organization_id, m.dataset_id)));
create policy charts_select on public.chart_definitions for select to authenticated using (private.bi_dataset_visible(organization_id, dataset_id));
create policy saved_views_select on public.saved_views for select to authenticated using (private.bi_dataset_visible(organization_id, dataset_id) and (created_by = (select auth.uid()) or private.bi_is_manager(organization_id)));
create policy refresh_select on public.data_refresh_events for select to authenticated using (private.bi_dataset_visible(organization_id, dataset_id));
create policy dataset_access_select on public.dataset_access for select to authenticated using (private.bi_is_admin(organization_id) or user_id = (select auth.uid()));

create policy dashboards_select on public.dashboards for select to authenticated using (private.bi_dashboard_visible(organization_id, id));
create policy dashboard_versions_select on public.dashboard_versions for select to authenticated using (private.bi_dashboard_visible(organization_id, dashboard_id));
create policy dashboard_widgets_select on public.dashboard_widgets for select to authenticated using (private.bi_dashboard_visible(organization_id, dashboard_id));
create policy dashboard_filters_select on public.dashboard_filters for select to authenticated using (private.bi_dashboard_visible(organization_id, dashboard_id));
create policy dashboard_permissions_select on public.dashboard_permissions for select to authenticated
  using (user_id = (select auth.uid()) or private.bi_dashboard_level(organization_id, dashboard_id) = 'admin');
create policy dashboard_favorites_select on public.dashboard_favorites for select to authenticated using (user_id = (select auth.uid()) and private.bi_can_read(organization_id));
create policy dashboard_views_select on public.dashboard_views for select to authenticated using (user_id = (select auth.uid()) and private.bi_can_read(organization_id));

create policy goals_select on public.goal_definitions for select to authenticated using (private.bi_is_analyst(organization_id));
create policy goal_periods_select on public.goal_periods for select to authenticated using (private.bi_is_analyst(organization_id));
create policy exports_select on public.report_exports for select to authenticated using (private.bi_can_read(organization_id) and (created_by = (select auth.uid()) or private.bi_is_admin(organization_id)));
create policy bi_notifications_select on public.bi_notifications for select to authenticated using (user_id = (select auth.uid()) and private.bi_can_read(organization_id));
create policy bi_notification_prefs_select on public.bi_notification_prefs for select to authenticated using (user_id = (select auth.uid()) and private.bi_can_read(organization_id));

-- MFA no banco (mesma regra do Core): sem AAL2 não lê as tabelas de negócio (RESTRICTIVE), nem pela API REST direta.
do $$
declare t text;
begin
  foreach t in array array['bi_settings', 'datasets', 'dataset_versions', 'dataset_columns', 'dataset_access', 'import_jobs', 'import_row_errors', 'dimension_definitions', 'metric_definitions',
    'metric_versions', 'chart_definitions', 'dashboards', 'dashboard_versions', 'dashboard_widgets', 'dashboard_filters', 'dashboard_permissions', 'dashboard_favorites', 'dashboard_views',
    'goal_definitions', 'goal_periods', 'saved_views', 'report_exports', 'data_refresh_events', 'bi_notifications', 'bi_notification_prefs'] loop
    execute format('create policy mfa_select on public.%I as restrictive for select to authenticated using (private.mfa_ok())', t);
  end loop;
end $$;

commit;
