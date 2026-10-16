-- Dashboard Executivo — METAS, VISÕES SALVAS, AVISOS, CONFIGURAÇÕES e QUALIDADE DOS DADOS.

begin;
set local check_function_bodies = off;

-- ======================================================================= metas (gestor+)
create function public.bi_save_goal(p_org uuid, p_id uuid, p_metric uuid, p_name text, p_kind text, p_period_type text, p_target numeric, p_target_high numeric, p_warn numeric,
                                    p_comparison text, p_scope jsonb, p_owner uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m record; cols jsonb; f jsonb; out uuid;
begin
  perform private.bi_guard(p_org, 'manager');
  select * into m from public.metric_definitions where id = p_metric and organization_id = p_org;
  if m.id is null or not private.bi_dataset_visible(p_org, m.dataset_id) then raise exception 'indicador não encontrado' using errcode = 'P0002'; end if;
  if m.status <> 'active' then raise exception 'o indicador está inválido ou arquivado' using errcode = '55000'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'nome inválido (1 a 80 caracteres)' using errcode = '22023'; end if;
  if p_kind not in ('min', 'max', 'growth', 'reduction', 'range') or p_period_type not in ('month', 'quarter', 'year', 'custom') or p_comparison not in ('previous_period', 'previous_month', 'previous_year') then raise exception 'configuração de meta inválida' using errcode = '22023'; end if;
  if p_target is null or abs(p_target) >= 1e17 then raise exception 'valor-alvo inválido' using errcode = '22023'; end if;
  if p_kind = 'range' and (p_target_high is null or p_target_high < p_target) then raise exception 'a faixa precisa ter limite superior maior ou igual ao inferior' using errcode = '22023'; end if;
  if p_kind in ('growth', 'reduction') and p_target < 0 then raise exception 'o percentual-alvo não pode ser negativo' using errcode = '22023'; end if;
  if p_warn is null or p_warn < 1 or p_warn > 100 then raise exception 'limite de atenção inválido (1 a 100)' using errcode = '22023'; end if;
  if p_owner is not null and not exists (select 1 from public.organization_members where organization_id = p_org and user_id = p_owner) then raise exception 'responsável não pertence à empresa' using errcode = '22023'; end if;
  p_scope := coalesce(p_scope, '[]'::jsonb);
  if jsonb_typeof(p_scope) <> 'array' or jsonb_array_length(p_scope) > 10 then raise exception 'escopo da meta inválido' using errcode = '22023'; end if;
  cols := private.bi_cols((select current_version_id from public.datasets where id = m.dataset_id));
  for f in select * from jsonb_array_elements(p_scope) loop perform private.bi_pred(f, cols, private.bi_tz(p_org)); end loop;
  if p_id is null then
    insert into public.goal_definitions (organization_id, metric_id, name, goal_kind, period_type, target_value_decimal, target_high_decimal, warn_pct, comparison_operator, scope_json, owner_id, created_by)
      values (p_org, p_metric, trim(p_name), p_kind, p_period_type, p_target, case when p_kind = 'range' then p_target_high end, p_warn, p_comparison, p_scope, p_owner, (select auth.uid())) returning id into out;
  else
    update public.goal_definitions set name = trim(p_name), goal_kind = p_kind, period_type = p_period_type, target_value_decimal = p_target, target_high_decimal = case when p_kind = 'range' then p_target_high end,
           warn_pct = p_warn, comparison_operator = p_comparison, scope_json = p_scope, owner_id = p_owner where id = p_id and organization_id = p_org and metric_id = p_metric returning id into out;
    if out is null then raise exception 'meta não encontrada' using errcode = 'P0002'; end if;
  end if;
  return out;
end $$;

create function public.bi_archive_goal(p_org uuid, p_id uuid, p_archive boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'manager');
  update public.goal_definitions set status = case when p_archive then 'archived' else 'active' end where id = p_id and organization_id = p_org;
end $$;

create function public.bi_set_goal_period(p_org uuid, p_goal uuid, p_start date, p_end date, p_target numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'manager');
  if not exists (select 1 from public.goal_definitions where id = p_goal and organization_id = p_org) then raise exception 'meta não encontrada' using errcode = 'P0002'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 3660 then raise exception 'período da meta inválido' using errcode = '22023'; end if;
  if p_target is null or abs(p_target) >= 1e17 then raise exception 'valor-alvo inválido' using errcode = '22023'; end if;
  insert into public.goal_periods (organization_id, goal_id, period_start, period_end, target_value_decimal) values (p_org, p_goal, p_start, p_end, p_target)
    on conflict (goal_id, period_start, period_end) do update set target_value_decimal = excluded.target_value_decimal;
end $$;

-- aviso de meta: idempotente por meta+situação+período (o app chama quando um gestor abre o painel de metas)
create function public.bi_goal_notify(p_org uuid, p_goal uuid, p_status text, p_period text) returns void
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  perform private.bi_guard(p_org, 'manager');
  if p_status not in ('achieved', 'missed', 'attention') or char_length(coalesce(p_period, '')) not between 1 and 30 then raise exception 'aviso inválido' using errcode = '22023'; end if;
  select * into g from public.goal_definitions where id = p_goal and organization_id = p_org and status = 'active';
  if g.id is null then return; end if;
  perform private.bi_notify_user(p_org, coalesce(g.owner_id, g.created_by), case p_status when 'achieved' then 'goal_achieved' else 'goal_below' end,
    case p_status when 'achieved' then 'Meta atingida' when 'attention' then 'Meta em atenção' else 'Meta abaixo do esperado' end, 'Meta «' || g.name || '» (' || p_period || ').', 'goal_definitions', g.id, 'goal:' || g.id || ':' || p_status || ':' || p_period);
end $$;

-- ======================================================================= visões salvas
create function public.bi_save_view(p_org uuid, p_id uuid, p_dataset uuid, p_name text, p_filters jsonb, p_columns jsonb, p_sorting jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cols jsonb; f jsonb; out uuid; ver uuid;
begin
  perform private.bi_guard(p_org, 'analyst');
  if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select current_version_id into ver from public.datasets where id = p_dataset and organization_id = p_org;
  if ver is null then raise exception 'o dataset ainda não tem dados publicados' using errcode = '55000'; end if;
  cols := private.bi_cols(ver);
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'nome inválido (1 a 80 caracteres)' using errcode = '22023'; end if;
  p_filters := coalesce(p_filters, '[]'::jsonb); p_columns := coalesce(p_columns, '[]'::jsonb); p_sorting := coalesce(p_sorting, '[]'::jsonb);
  if jsonb_typeof(p_filters) <> 'array' or jsonb_array_length(p_filters) > 20 or jsonb_typeof(p_columns) <> 'array' or jsonb_array_length(p_columns) > 100 or jsonb_typeof(p_sorting) <> 'array' or jsonb_array_length(p_sorting) > 3 then raise exception 'visão inválida' using errcode = '22023'; end if;
  for f in select * from jsonb_array_elements(p_filters) loop perform private.bi_pred(f, cols, private.bi_tz(p_org)); end loop;
  for f in select * from jsonb_array_elements(p_columns) loop perform private.bi_key(cols, f #>> '{}'); end loop;
  for f in select * from jsonb_array_elements(p_sorting) loop perform private.bi_key(cols, f ->> 'field'); if (f ->> 'dir') not in ('asc', 'desc') then raise exception 'ordenação inválida' using errcode = '22023'; end if; end loop;
  if p_id is null then
    insert into public.saved_views (organization_id, dataset_id, name, filters_json, columns_json, sorting_json, created_by) values (p_org, p_dataset, trim(p_name), p_filters, p_columns, p_sorting, (select auth.uid())) returning id into out;
  else
    update public.saved_views set name = trim(p_name), filters_json = p_filters, columns_json = p_columns, sorting_json = p_sorting
     where id = p_id and organization_id = p_org and dataset_id = p_dataset and (created_by = (select auth.uid()) or private.bi_is_manager(p_org)) returning id into out;
    if out is null then raise exception 'visão não encontrada' using errcode = 'P0002'; end if;
  end if;
  return out;
end $$;

create function public.bi_delete_view(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'analyst');
  delete from public.saved_views where id = p_id and organization_id = p_org and (created_by = (select auth.uid()) or private.bi_is_manager(p_org));
end $$;

-- ======================================================================= avisos
create function public.bi_mark_notifications_read(p_org uuid, p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.bi_guard(p_org, 'read');
  update public.bi_notifications set read_at = now() where organization_id = p_org and user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create function public.bi_set_notification_pref(p_org uuid, p_type text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'read');
  if p_type not in ('import_done', 'import_failed', 'metric_invalid', 'dashboard_shared', 'permission_revoked', 'goal_achieved', 'goal_below', 'dataset_stale') then raise exception 'tipo de aviso inválido' using errcode = '22023'; end if;
  insert into public.bi_notification_prefs (organization_id, user_id, type, enabled) values (p_org, (select auth.uid()), p_type, coalesce(p_enabled, true))
    on conflict (organization_id, user_id, type) do update set enabled = excluded.enabled;
end $$;

-- ======================================================================= configurações (administrador)
create function public.bi_update_settings(p_org uuid, p_timezone text, p_date_format text, p_portal_name text, p_max_rows integer, p_max_file_mb integer, p_stale_days integer, p_retained integer, p_default_period text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'admin');
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then raise exception 'fuso horário inválido' using errcode = '22023'; end if;
  if p_date_format not in ('DD/MM/YYYY', 'YYYY-MM-DD') or p_default_period not in ('today', 'yesterday', 'last_7', 'last_30', 'this_month', 'last_month', 'this_quarter', 'this_year') then raise exception 'formato inválido' using errcode = '22023'; end if;
  if p_portal_name is not null and char_length(p_portal_name) > 60 then raise exception 'nome do portal longo demais (máximo 60)' using errcode = '22023'; end if;
  if p_max_rows not between 1000 and 50000 or p_max_file_mb not between 1 and 20 or p_stale_days not between 1 and 365 or p_retained not between 2 and 20 then raise exception 'limite fora do permitido' using errcode = '22023'; end if;
  update public.bi_settings set timezone = p_timezone, date_format = p_date_format, portal_name = nullif(trim(p_portal_name), ''), max_rows = p_max_rows, max_file_mb = p_max_file_mb, stale_days = p_stale_days,
         retained_versions = p_retained, default_period = p_default_period where organization_id = p_org;
end $$;

-- ======================================================================= qualidade dos dados
create function public.bi_quality_overview(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record; out jsonb;
begin
  perform private.bi_guard(p_org, 'analyst');
  select * into s from public.bi_settings where organization_id = p_org;
  select jsonb_build_object(
    'stale_days', s.stale_days,
    'datasets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'status', d.status, 'restricted', d.restricted, 'version', v.version_number, 'rows', v.row_count, 'published_at', v.published_at,
        'stale', d.status = 'active' and (v.published_at is null or v.published_at < now() - make_interval(days => s.stale_days)),
        'rejected_last', coalesce((v.stats_json ->> 'rejected')::int, 0), 'skipped_last', coalesce((v.stats_json ->> 'skipped_existing')::int, 0),
        'failed_imports_30d', (select count(*) from public.import_jobs j where j.dataset_id = d.id and j.status = 'failed' and j.created_at > now() - interval '30 days'),
        'invalid_metrics', (select count(*) from public.metric_definitions m where m.dataset_id = d.id and m.status = 'invalid'),
        'nulls', v.stats_json -> 'nulls',
        'columns', (select coalesce(jsonb_agg(jsonb_build_object('key', c.column_key, 'name', c.display_name, 'type', c.data_type) order by c.position), '[]'::jsonb) from public.dataset_columns c where c.dataset_version_id = v.id)
      ) order by d.name)
      from public.datasets d left join public.dataset_versions v on v.id = d.current_version_id where d.organization_id = p_org and private.bi_dataset_visible(p_org, d.id)), '[]'::jsonb),
    'recent_imports', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'dataset_id', j.dataset_id, 'dataset', d.name, 'file_name', j.file_name, 'file_type', j.file_type, 'mode', j.import_mode, 'status', j.status,
        'total', j.total_rows, 'valid', j.valid_rows, 'invalid', j.invalid_rows, 'skipped', j.skipped_existing, 'created_at', j.created_at, 'error', j.error_message) order by j.created_at desc)
      from (select * from public.import_jobs where organization_id = p_org order by created_at desc limit 30) j join public.datasets d on d.id = j.dataset_id and private.bi_dataset_visible(p_org, d.id)), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- aviso de dataset desatualizado: um por dataset e semana (idempotente); chamado ao abrir o painel de qualidade
create function public.bi_check_freshness(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare s record; d record; n int := 0; wk text := to_char(now(), 'IYYY-"W"IW');
begin
  perform private.bi_guard(p_org, 'analyst');
  select * into s from public.bi_settings where organization_id = p_org;
  for d in select ds.id, ds.name from public.datasets ds left join public.dataset_versions v on v.id = ds.current_version_id
            where ds.organization_id = p_org and ds.status = 'active' and v.id is not null and v.published_at < now() - make_interval(days => s.stale_days) loop
    n := n + private.bi_notify_roles(p_org, array['owner', 'admin', 'manager', 'member']::public.org_role[], 'dataset_stale', 'Dataset desatualizado', 'O dataset «' || d.name || '» não recebe dados há mais de ' || s.stale_days || ' dias.', 'datasets', d.id, 'stale:' || d.id || ':' || wk);
  end loop;
  return n;
end $$;

-- Meta de um widget de meta: quem VÊ o dashboard lê a meta daquele widget (e só ela), sem acesso às demais metas.
create function public.bi_widget_goal(p_org uuid, p_dashboard uuid, p_widget uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w record; g record;
begin
  perform private.bi_guard(p_org, 'read');
  perform private.bi_need_level(p_org, p_dashboard, 'view');
  select * into w from public.dashboard_widgets where id = p_widget and dashboard_id = p_dashboard and organization_id = p_org and widget_type = 'goal';
  if w.id is null or (w.display_json ->> 'goalId') !~ '^[0-9a-f-]{36}$' then return null; end if;
  select * into g from public.goal_definitions where id = (w.display_json ->> 'goalId')::uuid and organization_id = p_org and status = 'active';
  if g.id is null then return null; end if;
  return jsonb_build_object('goal', jsonb_build_object('id', g.id, 'metric_id', g.metric_id, 'name', g.name, 'goal_kind', g.goal_kind, 'period_type', g.period_type, 'target_value_decimal', g.target_value_decimal,
      'target_high_decimal', g.target_high_decimal, 'warn_pct', g.warn_pct, 'comparison_operator', g.comparison_operator, 'scope_json', g.scope_json, 'owner_id', g.owner_id, 'status', g.status, 'created_at', g.created_at),
    'periods', coalesce((select jsonb_agg(jsonb_build_object('id', gp.id, 'goal_id', gp.goal_id, 'period_start', gp.period_start, 'period_end', gp.period_end, 'target_value_decimal', gp.target_value_decimal)) from public.goal_periods gp where gp.goal_id = g.id), '[]'::jsonb));
end $$;

-- ======================================================================= pessoas da empresa (para compartilhar e atribuir responsável)
-- Perfis só são legíveis pelo próprio usuário e por administradores (minimização). Analista+ precisa escolher pessoas: devolvemos só id, papel e um rótulo.
create function public.bi_members(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'analyst');
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'name', coalesce(nullif(p.full_name, ''), nullif(split_part(p.email, '@', 1), ''), 'Pessoa da equipe')) order by coalesce(p.full_name, p.email))
    from public.organization_members m left join public.profiles p on p.id = m.user_id where m.organization_id = p_org), '[]'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.bi_members(uuid)', 'public.bi_widget_goal(uuid, uuid, uuid)', 'public.bi_save_goal(uuid, uuid, uuid, text, text, text, numeric, numeric, numeric, text, jsonb, uuid)', 'public.bi_archive_goal(uuid, uuid, boolean)', 'public.bi_set_goal_period(uuid, uuid, date, date, numeric)',
    'public.bi_goal_notify(uuid, uuid, text, text)', 'public.bi_save_view(uuid, uuid, uuid, text, jsonb, jsonb, jsonb)', 'public.bi_delete_view(uuid, uuid)', 'public.bi_mark_notifications_read(uuid, uuid[])',
    'public.bi_set_notification_pref(uuid, text, boolean)', 'public.bi_update_settings(uuid, text, text, text, integer, integer, integer, integer, text)', 'public.bi_quality_overview(uuid)', 'public.bi_check_freshness(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
