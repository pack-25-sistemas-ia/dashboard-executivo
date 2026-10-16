-- Dashboard Executivo — DASHBOARDS: criação, edição com controle otimista, publicação versionada, duplicação, compartilhamento interno e favoritos.

begin;
set local check_function_bodies = off;

-- nível mínimo exigido: 'view' | 'edit' | 'admin' (o nível vem de bi_dashboard_level: administrador da empresa, criador ou concedido)
create function private.bi_need_level(p_org uuid, p_dash uuid, p_min text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare lvl text;
begin
  lvl := private.bi_dashboard_level(p_org, p_dash);
  if lvl is null or (p_min = 'edit' and lvl = 'view') or (p_min = 'admin' and lvl <> 'admin') then raise exception 'sem permissão' using errcode = '42501'; end if;
  return lvl;
end $$;
revoke all on function private.bi_need_level(uuid, uuid, text) from public, anon, authenticated;

create function private.bi_layout_ok(l jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
declare bp text; b jsonb;
begin
  if jsonb_typeof(l) <> 'object' or not (l ? 'lg') then return false; end if;
  for bp in select jsonb_object_keys(l) loop
    if bp not in ('lg', 'md', 'sm') then return false; end if;
    b := l -> bp;
    if jsonb_typeof(b) <> 'object' or jsonb_typeof(b -> 'x') <> 'number' or jsonb_typeof(b -> 'y') <> 'number' or jsonb_typeof(b -> 'w') <> 'number' or jsonb_typeof(b -> 'h') <> 'number' then return false; end if;
    if (b ->> 'x')::numeric <> trunc((b ->> 'x')::numeric) or (b ->> 'y')::numeric <> trunc((b ->> 'y')::numeric) or (b ->> 'w')::numeric <> trunc((b ->> 'w')::numeric) or (b ->> 'h')::numeric <> trunc((b ->> 'h')::numeric) then return false; end if;
    if (b ->> 'x')::int < 0 or (b ->> 'y')::int < 0 or (b ->> 'y')::int > 1000 or (b ->> 'w')::int not between 1 and 12 or (b ->> 'h')::int not between 1 and 30 or (b ->> 'x')::int + (b ->> 'w')::int > 12 then return false; end if;
  end loop;
  return true;
end $$;

-- ----------------------------------------------------------------------- criar
create function public.bi_create_dashboard(p_org uuid, p_name text, p_description text default null, p_template text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid; s record;
begin
  perform private.bi_guard(p_org, 'analyst');
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'informe o nome do dashboard (1 a 80 caracteres)' using errcode = '22023'; end if;
  select * into s from public.bi_settings where organization_id = p_org;
  begin
    insert into public.dashboards (organization_id, name, description, template_key, default_period, created_by)
      values (p_org, trim(p_name), nullif(trim(p_description), ''), left(p_template, 40), s.default_period, (select auth.uid())) returning dashboards.id into id;
  exception when unique_violation then raise exception 'já existe um dashboard com este nome' using errcode = '23505';
  end;
  return id;
end $$;

-- ----------------------------------------------------------------------- salvar (rascunho ou publicado) — concorrência otimista por row_version
create function public.bi_save_dashboard(p_org uuid, p_id uuid, p_expected integer, p_name text, p_description text, p_default_period text, p_comparison text, p_partial_basis text,
                                         p_widgets jsonb, p_filters jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d record; w jsonb; f jsonb; wid uuid; ver uuid; cols jsonb; spec jsonb; ds record; keep uuid[] := '{}'; fkeep uuid[] := '{}'; fid uuid; t text; n int := 0; tz text := private.bi_tz(p_org); ids jsonb := '[]'::jsonb; q jsonb; per jsonb;
begin
  perform private.bi_guard(p_org, 'analyst');
  perform private.bi_need_level(p_org, p_id, 'edit');
  select * into d from public.dashboards where id = p_id and organization_id = p_org for update;
  if d.status = 'archived' then raise exception 'dashboard arquivado não pode ser editado' using errcode = '55000'; end if;
  if d.row_version <> p_expected then
    raise exception 'conflito de edição: este dashboard foi alterado por outra pessoa (versão % em vez de %). Recarregue para ver as mudanças.', d.row_version, p_expected using errcode = '40001';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'informe o nome do dashboard (1 a 80 caracteres)' using errcode = '22023'; end if;
  if p_default_period not in ('today', 'yesterday', 'last_7', 'last_30', 'this_month', 'last_month', 'this_quarter', 'this_year') or p_comparison not in ('previous_period', 'previous_month', 'previous_year', 'none') or p_partial_basis not in ('same_days', 'full') then
    raise exception 'período ou comparação inválidos' using errcode = '22023';
  end if;
  if jsonb_typeof(p_widgets) <> 'array' or jsonb_array_length(p_widgets) > 40 then raise exception 'use no máximo 40 widgets' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_filters, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_filters, '[]'::jsonb)) > 8 then raise exception 'use no máximo 8 filtros globais' using errcode = '22023'; end if;

  -- filtros globais
  for f in select * from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) loop
    select * into ds from public.datasets where id = (f ->> 'dataset_id')::uuid and organization_id = p_org and status = 'active';
    if ds.id is null or not private.bi_dataset_visible(p_org, ds.id) or ds.current_version_id is null then raise exception 'filtro global com dataset inválido ou sem permissão' using errcode = '42501'; end if;
    cols := private.bi_cols(ds.current_version_id);
    t := cols ->> private.bi_key(cols, f ->> 'field_key');
    if (f ->> 'operator') not in ('eq', 'in', 'between', 'contains') or ((f ->> 'operator') = 'contains' and t <> 'string') or ((f ->> 'operator') = 'between' and not (private.bi_is_numeric(t) or private.bi_is_temporal(t))) or t = 'boolean' and (f ->> 'operator') <> 'eq' then
      raise exception 'operador do filtro global não combina com a coluna' using errcode = '22023';
    end if;
    if char_length(coalesce(f ->> 'label', '')) not between 1 and 60 then raise exception 'rótulo do filtro inválido (1 a 60 caracteres)' using errcode = '22023'; end if;
  end loop;

  -- widgets
  for w in select * from jsonb_array_elements(p_widgets) loop
    if (w ->> 'widget_type') not in ('kpi', 'chart', 'table', 'text', 'goal', 'comparison', 'alert', 'freshness') then raise exception 'tipo de widget inválido' using errcode = '22023'; end if;
    if char_length(coalesce(w ->> 'title', '')) > 120 then raise exception 'título do widget longo demais (máximo 120)' using errcode = '22023'; end if;
    if not private.bi_layout_ok(w -> 'layout_json') then raise exception 'posição ou tamanho de widget inválido' using errcode = '22023'; end if;
    if jsonb_typeof(coalesce(w -> 'display_json', '{}'::jsonb)) <> 'object' or char_length(coalesce(w -> 'display_json', '{}'::jsonb)::text) > 12000 then raise exception 'configuração de widget inválida ou grande demais' using errcode = '22023'; end if;
    q := w -> 'query_json';
    if q is not null and jsonb_typeof(q) <> 'null' then
      ds := null;
      select * into ds from public.datasets where id = (w ->> 'dataset_id')::uuid and organization_id = p_org and status = 'active';
      if ds.id is null or not private.bi_dataset_visible(p_org, ds.id) then raise exception 'widget com dataset inválido ou sem permissão' using errcode = '42501'; end if;
      if ds.current_version_id is null then raise exception 'o dataset do widget não tem dados publicados' using errcode = '55000'; end if;
      if char_length(q::text) > 12000 then raise exception 'consulta do widget grande demais' using errcode = '22023'; end if;
      -- validação REAL da consulta: executa com limite 1 (período provisório se o widget só declara a coluna de data)
      spec := q - 'dataset_id' || jsonb_build_object('dataset_id', ds.id, 'limit', 1);
      per := spec -> 'period';
      if jsonb_typeof(per) = 'object' and ((per ->> 'from') is null or (per ->> 'to') is null) then
        spec := jsonb_set(spec, '{period}', jsonb_build_object('field', per ->> 'field', 'from', (private.bi_today(p_org) - 30)::text, 'to', private.bi_today(p_org)::text));
      end if;
      perform private.bi_exec_query(p_org, ds.current_version_id, spec, tz);
      if w ->> 'metric_id' is not null and not exists (select 1 from public.metric_definitions m where m.id = (w ->> 'metric_id')::uuid and m.organization_id = p_org and m.dataset_id = ds.id and m.status = 'active') then
        raise exception 'o widget usa um indicador inexistente, inválido ou de outro dataset' using errcode = '22023';
      end if;
      if w ->> 'chart_id' is not null and not exists (select 1 from public.chart_definitions c where c.id = (w ->> 'chart_id')::uuid and c.organization_id = p_org and c.dataset_id = ds.id) then
        raise exception 'o widget usa um gráfico inexistente ou de outro dataset' using errcode = '22023';
      end if;
    end if;
  end loop;

  -- aplica: atualiza os existentes (mesmo id), insere novos e remove os que saíram
  for w in select * from jsonb_array_elements(p_widgets) loop
    wid := nullif(w ->> 'id', '')::uuid;
    if wid is not null and exists (select 1 from public.dashboard_widgets x where x.id = wid and x.dashboard_id = p_id and x.organization_id = p_org) then
      update public.dashboard_widgets set widget_type = w ->> 'widget_type', title = coalesce(w ->> 'title', ''), dataset_id = nullif(w ->> 'dataset_id', '')::uuid, chart_id = nullif(w ->> 'chart_id', '')::uuid,
             metric_id = nullif(w ->> 'metric_id', '')::uuid, query_json = case when jsonb_typeof(w -> 'query_json') = 'object' then w -> 'query_json' else null end,
             display_json = coalesce(w -> 'display_json', '{}'::jsonb), layout_json = w -> 'layout_json', metric_version = nullif(w ->> 'metric_version', '')::int where id = wid;
    else
      insert into public.dashboard_widgets (organization_id, dashboard_id, widget_type, title, dataset_id, chart_id, metric_id, query_json, display_json, layout_json, metric_version)
        values (p_org, p_id, w ->> 'widget_type', coalesce(w ->> 'title', ''), nullif(w ->> 'dataset_id', '')::uuid, nullif(w ->> 'chart_id', '')::uuid, nullif(w ->> 'metric_id', '')::uuid,
                case when jsonb_typeof(w -> 'query_json') = 'object' then w -> 'query_json' else null end, coalesce(w -> 'display_json', '{}'::jsonb), w -> 'layout_json', nullif(w ->> 'metric_version', '')::int)
        returning id into wid;
    end if;
    keep := keep || wid;
    ids := ids || to_jsonb(wid::text);
  end loop;
  delete from public.dashboard_widgets where dashboard_id = p_id and organization_id = p_org and not (id = any (keep));

  for f in select * from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) loop
    fid := nullif(f ->> 'id', '')::uuid;
    if fid is not null and exists (select 1 from public.dashboard_filters x where x.id = fid and x.dashboard_id = p_id and x.organization_id = p_org) then
      update public.dashboard_filters set dataset_id = (f ->> 'dataset_id')::uuid, field_key = f ->> 'field_key', label = f ->> 'label', operator = f ->> 'operator', default_value_json = f -> 'default_value_json', position = n where id = fid;
    else
      insert into public.dashboard_filters (organization_id, dashboard_id, dataset_id, field_key, label, operator, default_value_json, position)
        values (p_org, p_id, (f ->> 'dataset_id')::uuid, f ->> 'field_key', f ->> 'label', f ->> 'operator', f -> 'default_value_json', n) returning id into fid;
    end if;
    fkeep := fkeep || fid;
    n := n + 1;
  end loop;
  delete from public.dashboard_filters where dashboard_id = p_id and organization_id = p_org and not (id = any (fkeep));

  begin
    update public.dashboards set name = trim(p_name), description = nullif(trim(p_description), ''), default_period = p_default_period, comparison = p_comparison, partial_basis = p_partial_basis,
           row_version = row_version + 1 where id = p_id;
  exception when unique_violation then raise exception 'já existe um dashboard com este nome' using errcode = '23505';
  end;
  perform private.bi_audit(p_org, 'dashboard_saved', 'dashboards', p_id, jsonb_build_object('widgets', jsonb_array_length(p_widgets)));
  return jsonb_build_object('row_version', d.row_version + 1, 'widget_ids', ids);
end $$;

-- ----------------------------------------------------------------------- publicar (gestor+) com instantâneo versionado
create function private.bi_dashboard_snapshot(p_org uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'widgets', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'widget_type', w.widget_type, 'title', w.title, 'dataset_id', w.dataset_id, 'chart_id', w.chart_id, 'metric_id', w.metric_id,
        'query_json', w.query_json, 'display_json', w.display_json, 'layout_json', w.layout_json, 'metric_version', w.metric_version) order by w.created_at, w.id)
      from public.dashboard_widgets w where w.dashboard_id = p_id and w.organization_id = p_org), '[]'::jsonb),
    'settings', (select jsonb_build_object('default_period', d.default_period, 'comparison', d.comparison, 'partial_basis', d.partial_basis, 'name', d.name) from public.dashboards d where d.id = p_id and d.organization_id = p_org));
$$;
revoke all on function private.bi_dashboard_snapshot(uuid, uuid) from public, anon, authenticated;

create function public.bi_publish_dashboard(p_org uuid, p_id uuid, p_visibility text default 'private') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d record; vnum int; nwid int; restricted_n int;
begin
  perform private.bi_guard(p_org, 'manager');
  perform private.bi_need_level(p_org, p_id, 'edit');
  if p_visibility not in ('private', 'organization') then raise exception 'visibilidade inválida' using errcode = '22023'; end if;
  select * into d from public.dashboards where id = p_id and organization_id = p_org for update;
  if d.status = 'archived' then raise exception 'dashboard arquivado' using errcode = '55000'; end if;
  select count(*) into nwid from public.dashboard_widgets where dashboard_id = p_id and organization_id = p_org;
  if nwid = 0 then raise exception 'adicione ao menos um widget antes de publicar' using errcode = '23514'; end if;
  select count(*) into restricted_n from public.datasets ds where ds.organization_id = p_org and ds.restricted and ds.id in (select w.dataset_id from public.dashboard_widgets w where w.dashboard_id = p_id and w.dataset_id is not null);
  if p_visibility = 'organization' and restricted_n > 0 then raise exception 'dashboard com dataset restrito não pode ficar visível a toda a empresa: compartilhe com pessoas específicas' using errcode = '23514'; end if;
  if exists (select 1 from public.dashboard_widgets w join public.datasets ds on ds.id = w.dataset_id where w.dashboard_id = p_id and ds.status = 'archived') then raise exception 'há widgets de datasets arquivados' using errcode = '23514'; end if;
  select coalesce(max(version_number), 0) + 1 into vnum from public.dashboard_versions where dashboard_id = p_id;
  insert into public.dashboard_versions (organization_id, dashboard_id, version_number, layout_snapshot_json, filters_snapshot_json, created_by)
    values (p_org, p_id, vnum, private.bi_dashboard_snapshot(p_org, p_id),
            coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'dataset_id', f.dataset_id, 'field_key', f.field_key, 'label', f.label, 'operator', f.operator, 'default_value_json', f.default_value_json) order by f.position) from public.dashboard_filters f where f.dashboard_id = p_id), '[]'::jsonb),
            (select auth.uid()));
  update public.dashboards set status = 'published', visibility = p_visibility, published_at = now(), row_version = row_version + 1 where id = p_id;
  perform private.bi_audit(p_org, 'dashboard_published', 'dashboards', p_id, jsonb_build_object('version', vnum, 'visibility', p_visibility));
  return jsonb_build_object('version', vnum, 'row_version', d.row_version + 1);
end $$;

create function public.bi_unpublish_dashboard(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'manager');
  perform private.bi_need_level(p_org, p_id, 'edit');
  update public.dashboards set status = 'draft', visibility = 'private', row_version = row_version + 1 where id = p_id and organization_id = p_org and status = 'published';
  perform private.bi_audit(p_org, 'dashboard_unpublished', 'dashboards', p_id, '{}'::jsonb);
end $$;

-- ----------------------------------------------------------------------- restaurar versão publicada (substitui widgets e filtros pelo instantâneo)
create function public.bi_restore_dashboard_version(p_org uuid, p_id uuid, p_version integer, p_expected integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d record; v record; w jsonb; f jsonb; n int := 0; keep uuid[] := '{}'; ds record;
begin
  perform private.bi_guard(p_org, 'analyst');
  perform private.bi_need_level(p_org, p_id, 'edit');
  select * into d from public.dashboards where id = p_id and organization_id = p_org for update;
  if d.row_version <> p_expected then raise exception 'conflito de edição: o dashboard mudou. Recarregue.' using errcode = '40001'; end if;
  if d.status = 'archived' then raise exception 'dashboard arquivado' using errcode = '55000'; end if;
  select * into v from public.dashboard_versions where dashboard_id = p_id and version_number = p_version and organization_id = p_org;
  if v.id is null then raise exception 'versão não encontrada' using errcode = 'P0002'; end if;
  for w in select * from jsonb_array_elements(v.layout_snapshot_json -> 'widgets') loop
    if (w ->> 'dataset_id') is not null then
      select * into ds from public.datasets where id = (w ->> 'dataset_id')::uuid and organization_id = p_org and status = 'active';
      if ds.id is null or not private.bi_dataset_visible(p_org, ds.id) then raise exception 'a versão usa um dataset indisponível ou sem permissão' using errcode = '42501'; end if;
    end if;
    insert into public.dashboard_widgets as x (id, organization_id, dashboard_id, widget_type, title, dataset_id, chart_id, metric_id, query_json, display_json, layout_json, metric_version)
      values ((w ->> 'id')::uuid, p_org, p_id, w ->> 'widget_type', w ->> 'title', nullif(w ->> 'dataset_id', '')::uuid, nullif(w ->> 'chart_id', '')::uuid, nullif(w ->> 'metric_id', '')::uuid,
              case when jsonb_typeof(w -> 'query_json') = 'object' then w -> 'query_json' else null end, w -> 'display_json', w -> 'layout_json', nullif(w ->> 'metric_version', '')::int)
    on conflict (id) do update set widget_type = excluded.widget_type, title = excluded.title, dataset_id = excluded.dataset_id, chart_id = excluded.chart_id, metric_id = excluded.metric_id,
      query_json = excluded.query_json, display_json = excluded.display_json, layout_json = excluded.layout_json, metric_version = excluded.metric_version where x.dashboard_id = p_id;
    keep := keep || (w ->> 'id')::uuid;
  end loop;
  delete from public.dashboard_widgets where dashboard_id = p_id and organization_id = p_org and not (id = any (keep));
  delete from public.dashboard_filters where dashboard_id = p_id and organization_id = p_org;
  for f in select * from jsonb_array_elements(v.filters_snapshot_json) loop
    insert into public.dashboard_filters (id, organization_id, dashboard_id, dataset_id, field_key, label, operator, default_value_json, position)
      values (gen_random_uuid(), p_org, p_id, (f ->> 'dataset_id')::uuid, f ->> 'field_key', f ->> 'label', f ->> 'operator', f -> 'default_value_json', n);
    n := n + 1;
  end loop;
  update public.dashboards set default_period = coalesce(v.layout_snapshot_json #>> '{settings,default_period}', default_period), comparison = coalesce(v.layout_snapshot_json #>> '{settings,comparison}', comparison),
         partial_basis = coalesce(v.layout_snapshot_json #>> '{settings,partial_basis}', partial_basis), row_version = row_version + 1 where id = p_id;
  perform private.bi_audit(p_org, 'dashboard_restored', 'dashboards', p_id, jsonb_build_object('version', p_version));
  return jsonb_build_object('row_version', d.row_version + 1);
end $$;

-- ----------------------------------------------------------------------- duplicar / arquivar / favoritar
create function public.bi_duplicate_dashboard(p_org uuid, p_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d record; nid uuid; w record; ds record; idmap jsonb := '{}'::jsonb; nw uuid;
begin
  perform private.bi_guard(p_org, 'analyst');
  perform private.bi_need_level(p_org, p_id, 'view');
  select * into d from public.dashboards where id = p_id and organization_id = p_org;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'informe o nome do novo dashboard (1 a 80 caracteres)' using errcode = '22023'; end if;
  for ds in select distinct dataset_id as id from public.dashboard_widgets where dashboard_id = p_id and dataset_id is not null loop
    if not private.bi_dataset_visible(p_org, ds.id) then raise exception 'você não tem acesso a um dos datasets deste dashboard' using errcode = '42501'; end if;
  end loop;
  begin
    insert into public.dashboards (organization_id, name, description, template_key, default_period, comparison, partial_basis, created_by)
      values (p_org, trim(p_name), d.description, d.template_key, d.default_period, d.comparison, d.partial_basis, (select auth.uid())) returning id into nid;
  exception when unique_violation then raise exception 'já existe um dashboard com este nome' using errcode = '23505';
  end;
  for w in select * from public.dashboard_widgets where dashboard_id = p_id and organization_id = p_org loop
    insert into public.dashboard_widgets (organization_id, dashboard_id, widget_type, title, dataset_id, chart_id, metric_id, query_json, display_json, layout_json, metric_version)
      values (p_org, nid, w.widget_type, w.title, w.dataset_id, w.chart_id, w.metric_id, w.query_json, w.display_json, w.layout_json, w.metric_version);
  end loop;
  insert into public.dashboard_filters (organization_id, dashboard_id, dataset_id, field_key, label, operator, default_value_json, configuration_json, position)
    select organization_id, nid, dataset_id, field_key, label, operator, default_value_json, configuration_json, position from public.dashboard_filters where dashboard_id = p_id and organization_id = p_org;
  perform private.bi_audit(p_org, 'dashboard_duplicated', 'dashboards', nid, jsonb_build_object('from', p_id));
  return nid;
end $$;

create function public.bi_archive_dashboard(p_org uuid, p_id uuid, p_archive boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'analyst');
  perform private.bi_need_level(p_org, p_id, 'admin');
  if p_archive then
    update public.dashboards set status = 'archived', visibility = 'private', row_version = row_version + 1 where id = p_id and organization_id = p_org and status <> 'archived';
  else
    update public.dashboards set status = 'draft', row_version = row_version + 1 where id = p_id and organization_id = p_org and status = 'archived';
  end if;
  perform private.bi_audit(p_org, case when p_archive then 'dashboard_archived' else 'dashboard_restored_from_archive' end, 'dashboards', p_id, '{}'::jsonb);
end $$;

create function public.bi_set_favorite(p_org uuid, p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'read');
  perform private.bi_need_level(p_org, p_id, 'view');
  if p_on then
    insert into public.dashboard_favorites (organization_id, dashboard_id, user_id) values (p_org, p_id, (select auth.uid())) on conflict do nothing;
  else
    delete from public.dashboard_favorites where dashboard_id = p_id and user_id = (select auth.uid()) and organization_id = p_org;
  end if;
end $$;

create function public.bi_touch_dashboard(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'read');
  perform private.bi_need_level(p_org, p_id, 'view');
  insert into public.dashboard_views (organization_id, dashboard_id, user_id) values (p_org, p_id, (select auth.uid()))
    on conflict (dashboard_id, user_id) do update set viewed_at = now();
end $$;

-- ----------------------------------------------------------------------- compartilhamento interno
create function public.bi_share_dashboard(p_org uuid, p_id uuid, p_user uuid, p_level text) returns void
language plpgsql security definer set search_path = '' as $$
declare role_ public.org_role; d record; ds record; is_creator boolean;
begin
  perform private.bi_guard(p_org, 'analyst');
  perform private.bi_need_level(p_org, p_id, 'admin');
  select * into d from public.dashboards where id = p_id and organization_id = p_org;
  if d.status = 'archived' then raise exception 'dashboard arquivado' using errcode = '55000'; end if;
  if p_level not in ('view', 'edit', 'admin') then raise exception 'nível de permissão inválido' using errcode = '22023'; end if;
  select role into role_ from public.organization_members where organization_id = p_org and user_id = p_user;
  if role_ is null then raise exception 'a pessoa não faz parte da empresa' using errcode = '22023'; end if;
  if p_user = d.created_by then raise exception 'o criador já tem controle total' using errcode = '22023'; end if;
  if p_level in ('edit', 'admin') and role_ = 'viewer' then raise exception 'visualizadores só podem receber o nível de visualização' using errcode = '22023'; end if;
  -- quem recebe precisa ter acesso aos datasets restritos usados (compartilhar o dashboard não abre dados em silêncio)
  for ds in select distinct x.id from public.datasets x join public.dashboard_widgets w on w.dataset_id = x.id where w.dashboard_id = p_id and x.restricted loop
    if not (role_ in ('owner', 'admin') or exists (select 1 from public.dataset_access a where a.dataset_id = ds.id and a.user_id = p_user)) then
      raise exception 'a pessoa não tem acesso a um dataset restrito usado neste dashboard' using errcode = '42501';
    end if;
  end loop;
  insert into public.dashboard_permissions (organization_id, dashboard_id, user_id, permission_level, granted_by) values (p_org, p_id, p_user, p_level, (select auth.uid()))
    on conflict (dashboard_id, user_id) do update set permission_level = excluded.permission_level, granted_by = excluded.granted_by;
  perform private.bi_notify_user(p_org, p_user, 'dashboard_shared', 'Dashboard compartilhado com você', 'Você recebeu acesso ao dashboard «' || d.name || '».', 'dashboards', p_id, 'share:' || p_id || ':' || p_user || ':' || p_level);
end $$;

create function public.bi_revoke_dashboard(p_org uuid, p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  perform private.bi_guard(p_org, 'analyst');
  perform private.bi_need_level(p_org, p_id, 'admin');
  select * into d from public.dashboards where id = p_id and organization_id = p_org;
  delete from public.dashboard_permissions where dashboard_id = p_id and user_id = p_user and organization_id = p_org;
  perform private.bi_notify_user(p_org, p_user, 'permission_revoked', 'Acesso removido', 'Seu acesso ao dashboard «' || d.name || '» foi removido.', 'dashboards', p_id, 'revoke:' || p_id || ':' || p_user || ':' || extract(epoch from now())::bigint);
end $$;

-- exportação do dashboard (CSV gerado no servidor a partir das consultas dos widgets): só registra o evento, sem valores
create function public.bi_log_export(p_org uuid, p_dashboard uuid, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'read');
  perform private.bi_need_level(p_org, p_dashboard, 'view');
  insert into public.report_exports (organization_id, dashboard_id, report_type, row_count, created_by) values (p_org, p_dashboard, 'dashboard_csv', greatest(least(p_rows, 1000000), 0), (select auth.uid()));
  perform private.bi_audit(p_org, 'dashboard_export', 'dashboards', p_dashboard, jsonb_build_object('rows', greatest(least(p_rows, 1000000), 0)));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.bi_create_dashboard(uuid, text, text, text)', 'public.bi_save_dashboard(uuid, uuid, integer, text, text, text, text, text, jsonb, jsonb)', 'public.bi_publish_dashboard(uuid, uuid, text)',
    'public.bi_unpublish_dashboard(uuid, uuid)', 'public.bi_restore_dashboard_version(uuid, uuid, integer, integer)', 'public.bi_duplicate_dashboard(uuid, uuid, text)',
    'public.bi_archive_dashboard(uuid, uuid, boolean)', 'public.bi_set_favorite(uuid, uuid, boolean)', 'public.bi_touch_dashboard(uuid, uuid)', 'public.bi_share_dashboard(uuid, uuid, uuid, text)',
    'public.bi_revoke_dashboard(uuid, uuid, uuid)', 'public.bi_log_export(uuid, uuid, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
