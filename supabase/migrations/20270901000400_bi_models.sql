-- Dashboard Executivo — MODELO ANALÍTICO: datasets, acesso, colunas, dimensões, métricas (com fórmula em árvore e versões) e gráficos.

begin;
set local check_function_bodies = off;

-- ======================================================================= datasets
create function public.bi_create_dataset(p_org uuid, p_name text, p_description text default null, p_restricted boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  perform private.bi_guard(p_org, 'analyst');
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'informe o nome do dataset (1 a 80 caracteres)' using errcode = '22023'; end if;
  if p_restricted and not private.bi_is_admin(p_org) then raise exception 'só o administrador cria datasets restritos' using errcode = '42501'; end if;
  begin
    insert into public.datasets (organization_id, name, description, restricted, created_by) values (p_org, trim(p_name), nullif(trim(p_description), ''), coalesce(p_restricted, false), (select auth.uid())) returning datasets.id into id;
  exception when unique_violation then raise exception 'já existe um dataset com este nome' using errcode = '23505';
  end;
  return id;
end $$;

create function public.bi_update_dataset(p_org uuid, p_dataset uuid, p_name text, p_description text, p_restricted boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare ds record;
begin
  perform private.bi_guard(p_org, 'analyst');
  if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into ds from public.datasets where id = p_dataset and organization_id = p_org for update;
  if ds.id is null then raise exception 'dataset não encontrado' using errcode = 'P0002'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'informe o nome do dataset (1 a 80 caracteres)' using errcode = '22023'; end if;
  if p_restricted is distinct from ds.restricted and not private.bi_is_admin(p_org) then raise exception 'só o administrador altera a restrição de acesso' using errcode = '42501'; end if;
  begin
    update public.datasets set name = trim(p_name), description = nullif(trim(p_description), ''), restricted = coalesce(p_restricted, ds.restricted) where id = p_dataset;
  exception when unique_violation then raise exception 'já existe um dataset com este nome' using errcode = '23505';
  end;
end $$;

create function public.bi_archive_dataset(p_org uuid, p_dataset uuid, p_archive boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'manager');
  if not exists (select 1 from public.datasets where id = p_dataset and organization_id = p_org) then raise exception 'dataset não encontrado' using errcode = 'P0002'; end if;
  if p_archive then
    if exists (select 1 from public.import_jobs where dataset_id = p_dataset and status = 'processing') then raise exception 'há uma importação em andamento neste dataset' using errcode = '55000'; end if;
    update public.datasets set status = 'archived', archived_at = now() where id = p_dataset and organization_id = p_org and status = 'active';
  else
    update public.datasets set status = 'active', archived_at = null where id = p_dataset and organization_id = p_org and status = 'archived';
  end if;
  perform private.bi_audit(p_org, case when p_archive then 'dataset_archived' else 'dataset_restored' end, 'datasets', p_dataset, '{}'::jsonb);
end $$;

create function public.bi_set_dataset_access(p_org uuid, p_dataset uuid, p_user uuid, p_grant boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'admin');
  if not exists (select 1 from public.datasets where id = p_dataset and organization_id = p_org) then raise exception 'dataset não encontrado' using errcode = 'P0002'; end if;
  if p_grant then
    if not exists (select 1 from public.organization_members where organization_id = p_org and user_id = p_user) then raise exception 'a pessoa não faz parte da empresa' using errcode = '22023'; end if;
    insert into public.dataset_access (organization_id, dataset_id, user_id, granted_by) values (p_org, p_dataset, p_user, (select auth.uid())) on conflict do nothing;
  else
    delete from public.dataset_access where dataset_id = p_dataset and user_id = p_user and organization_id = p_org;
  end if;
end $$;

-- Rótulos, descrição e papel semântico da versão ativa (tipos e chaves não mudam aqui: isso é uma nova importação).
create function public.bi_update_columns(p_org uuid, p_dataset uuid, p_columns jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare ver uuid; c jsonb; names text[] := '{}';
begin
  perform private.bi_guard(p_org, 'analyst');
  if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select current_version_id into ver from public.datasets where id = p_dataset and organization_id = p_org;
  if ver is null then raise exception 'o dataset ainda não tem dados publicados' using errcode = '55000'; end if;
  if jsonb_typeof(p_columns) <> 'array' or jsonb_array_length(p_columns) > 100 then raise exception 'colunas inválidas' using errcode = '22023'; end if;
  for c in select * from jsonb_array_elements(p_columns) loop
    if char_length(trim(coalesce(c ->> 'name', ''))) not between 1 and 80 then raise exception 'nome de coluna inválido (1 a 80 caracteres)' using errcode = '22023'; end if;
    if coalesce(c ->> 'semantic', 'dimension') not in ('dimension', 'measure', 'time', 'identifier') then raise exception 'papel de coluna inválido' using errcode = '22023'; end if;
    update public.dataset_columns set display_name = trim(c ->> 'name'), semantic_type = coalesce(c ->> 'semantic', semantic_type),
           metadata_json = case when char_length(coalesce(c ->> 'description', '')) between 1 and 300 then jsonb_build_object('description', c ->> 'description') else '{}'::jsonb end
     where dataset_version_id = ver and column_key = c ->> 'key' and organization_id = p_org;
  end loop;
  if (select count(distinct lower(display_name)) <> count(*) from public.dataset_columns where dataset_version_id = ver) then raise exception 'há nomes de coluna repetidos' using errcode = '23505'; end if;
  perform private.bi_audit(p_org, 'columns_updated', 'datasets', p_dataset, jsonb_build_object('columns', jsonb_array_length(p_columns)));
end $$;

-- ======================================================================= dimensões
create function public.bi_save_dimension(p_org uuid, p_id uuid, p_dataset uuid, p_name text, p_column text, p_type text default 'category') returns uuid
language plpgsql security definer set search_path = '' as $$
declare ver uuid; cols jsonb; k text; out uuid;
begin
  perform private.bi_guard(p_org, 'analyst');
  if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select current_version_id into ver from public.datasets where id = p_dataset and organization_id = p_org;
  if ver is null then raise exception 'o dataset ainda não tem dados publicados' using errcode = '55000'; end if;
  cols := private.bi_cols(ver);
  k := private.bi_key(cols, p_column);
  if p_type not in ('category', 'time') or (p_type = 'time') <> private.bi_is_temporal(cols ->> k) then raise exception 'o tipo da dimensão não combina com a coluna' using errcode = '22023'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'nome inválido (1 a 80 caracteres)' using errcode = '22023'; end if;
  begin
    if p_id is null then
      insert into public.dimension_definitions (organization_id, dataset_id, name, column_key, dimension_type, created_by) values (p_org, p_dataset, trim(p_name), k, p_type, (select auth.uid())) returning id into out;
    else
      update public.dimension_definitions set name = trim(p_name), column_key = k, dimension_type = p_type where id = p_id and organization_id = p_org and dataset_id = p_dataset returning id into out;
      if out is null then raise exception 'dimensão não encontrada' using errcode = 'P0002'; end if;
    end if;
  exception when unique_violation then raise exception 'já existe uma dimensão com este nome' using errcode = '23505';
  end;
  return out;
end $$;

create function public.bi_delete_dimension(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'analyst');
  delete from public.dimension_definitions d where d.id = p_id and d.organization_id = p_org and private.bi_dataset_visible(p_org, d.dataset_id);
end $$;

-- ======================================================================= métricas
-- Valida a árvore de fórmula: operações permitidas, números canônicos, ids de métrica, profundidade e tamanho. Devolve {nodes, refs}.
create function private.bi_ast_check(node jsonb, depth int) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare op text; l jsonb; r jsonb; refs jsonb := '[]'::jsonb;
begin
  if depth > 6 then raise exception 'fórmula profunda demais (máximo de 6 níveis)' using errcode = '22023'; end if;
  if node is null or jsonb_typeof(node) is distinct from 'object' then raise exception 'fórmula inválida' using errcode = '22023'; end if;
  op := node ->> 'op';
  if op = 'ref' then
    if jsonb_typeof(node -> 'metric') <> 'string' or (node ->> 'metric') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'referência de métrica inválida' using errcode = '22023'; end if;
    return jsonb_build_object('nodes', 1, 'refs', jsonb_build_array(node ->> 'metric'));
  elsif op = 'num' then
    if jsonb_typeof(node -> 'value') <> 'string' or (node ->> 'value') !~ '^-?\d{1,15}(\.\d{1,6})?$' then raise exception 'número inválido na fórmula' using errcode = '22023'; end if;
    return jsonb_build_object('nodes', 1, 'refs', '[]'::jsonb);
  elsif op in ('add', 'sub', 'mul', 'div') then
    l := private.bi_ast_check(node -> 'l', depth + 1);
    r := private.bi_ast_check(node -> 'r', depth + 1);
    return jsonb_build_object('nodes', (l ->> 'nodes')::int + (r ->> 'nodes')::int + 1, 'refs', (l -> 'refs') || (r -> 'refs'));
  end if;
  raise exception 'operação não permitida na fórmula' using errcode = '22023';
end $$;

-- A partir de `start`, alguma fórmula alcança `target`? (detecção de ciclo; pilha limitada)
create function private.bi_metric_reaches(p_org uuid, p_start uuid, p_target uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare stack uuid[] := array[p_start]; seen uuid[] := '{}'; cur uuid; ref text; steps int := 0;
begin
  while cardinality(stack) > 0 loop
    cur := stack[cardinality(stack)];
    stack := stack[1:cardinality(stack) - 1];
    steps := steps + 1;
    if steps > 500 then return true; end if;
    if cur = p_target then return true; end if;
    continue when cur = any (seen);
    seen := seen || cur;
    for ref in select distinct x ->> 'metric' from public.metric_definitions m, jsonb_path_query(m.formula_ast_json, 'strict $.**') y(x)
               where m.id = cur and m.organization_id = p_org and m.metric_type = 'formula' and jsonb_typeof(x) = 'object' and x ? 'metric' loop
      stack := stack || ref::uuid;
    end loop;
  end loop;
  return false;
end $$;
revoke all on function private.bi_metric_reaches(uuid, uuid, uuid) from public, anon, authenticated;

create function public.bi_save_metric(p_org uuid, p_id uuid, p_dataset uuid, p_name text, p_description text, p_type text, p_agg text, p_field text, p_ast jsonb,
                                      p_filters jsonb, p_format text, p_unit text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ver uuid; cols jsonb; k text; t text; old record; mid uuid; vnum int; chk jsonb; ref text; f jsonb; ds record; tz text := private.bi_tz(p_org); snapshot jsonb; cnt int;
begin
  perform private.bi_guard(p_org, 'analyst');
  if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into ds from public.datasets where id = p_dataset and organization_id = p_org;
  if ds.status <> 'active' then raise exception 'dataset arquivado' using errcode = '55000'; end if;
  ver := ds.current_version_id;
  if ver is null then raise exception 'importe dados no dataset antes de criar indicadores' using errcode = '55000'; end if;
  cols := private.bi_cols(ver);
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'nome inválido (1 a 80 caracteres)' using errcode = '22023'; end if;
  if p_type not in ('aggregation', 'formula') then raise exception 'tipo de indicador inválido' using errcode = '22023'; end if;
  if p_format not in ('integer', 'decimal', 'currency', 'percentage') then raise exception 'formato inválido' using errcode = '22023'; end if;
  if p_unit is not null and char_length(p_unit) > 20 then raise exception 'unidade longa demais (máximo 20 caracteres)' using errcode = '22023'; end if;
  p_filters := coalesce(p_filters, '[]'::jsonb);
  if jsonb_typeof(p_filters) <> 'array' or jsonb_array_length(p_filters) > 20 then raise exception 'use no máximo 20 filtros' using errcode = '22023'; end if;
  for f in select * from jsonb_array_elements(p_filters) loop perform private.bi_pred(f, cols, tz); end loop;  -- valida campo, operador e valor tipado

  if p_id is not null then
    select * into old from public.metric_definitions where id = p_id and organization_id = p_org for update;
    if old.id is null then raise exception 'indicador não encontrado' using errcode = 'P0002'; end if;
    if old.dataset_id <> p_dataset then raise exception 'o dataset de um indicador não pode mudar' using errcode = '22023'; end if;
  end if;

  if p_type = 'aggregation' then
    if p_agg is null or p_agg not in ('sum', 'count', 'count_distinct', 'avg', 'min', 'max') then raise exception 'agregação inválida' using errcode = '22023'; end if;
    if p_field is null or p_field = '' then
      if p_agg <> 'count' then raise exception 'esta agregação precisa de uma coluna' using errcode = '22023'; end if;
      k := null;
    else
      k := private.bi_key(cols, p_field);
      t := cols ->> k;
      if p_agg in ('sum', 'avg') and not private.bi_is_numeric(t) then raise exception 'soma e média exigem coluna numérica' using errcode = '22023'; end if;
      if p_agg in ('min', 'max') and not (private.bi_is_numeric(t) or private.bi_is_temporal(t)) then raise exception 'mínimo e máximo exigem número ou data' using errcode = '22023'; end if;
    end if;
    p_ast := null;
  else
    chk := private.bi_ast_check(p_ast, 1);
    if (chk ->> 'nodes')::int > 40 then raise exception 'fórmula grande demais (máximo de 40 elementos)' using errcode = '22023'; end if;
    if jsonb_array_length(chk -> 'refs') > 20 then raise exception 'referências demais na fórmula' using errcode = '22023'; end if;
    for ref in select distinct jsonb_array_elements_text(chk -> 'refs') loop
      if p_id is not null and ref::uuid = p_id then raise exception 'uma fórmula não pode usar a si mesma' using errcode = '22023'; end if;
      select count(*) into cnt from public.metric_definitions m where m.id = ref::uuid and m.organization_id = p_org and m.dataset_id = p_dataset and m.status = 'active';
      if cnt = 0 then raise exception 'a fórmula usa um indicador inexistente, inválido, arquivado ou de outro dataset' using errcode = '22023'; end if;
      if p_id is not null and private.bi_metric_reaches(p_org, ref::uuid, p_id) then raise exception 'referência circular entre indicadores' using errcode = '22023'; end if;
    end loop;
    p_agg := null; k := null;
  end if;

  begin
    if p_id is null then
      insert into public.metric_definitions (organization_id, dataset_id, name, description, metric_type, aggregation, field_key, formula_ast_json, filters_json, format_type, unit, created_by)
        values (p_org, p_dataset, trim(p_name), nullif(trim(p_description), ''), p_type, p_agg, k, p_ast, p_filters, p_format, nullif(trim(p_unit), ''), (select auth.uid())) returning id into mid;
      vnum := 1;
    else
      vnum := old.current_version + 1;
      update public.metric_definitions set name = trim(p_name), description = nullif(trim(p_description), ''), metric_type = p_type, aggregation = p_agg, field_key = k, formula_ast_json = p_ast,
             filters_json = p_filters, format_type = p_format, unit = nullif(trim(p_unit), ''), current_version = vnum, status = 'active', invalid_reason = null where id = p_id;
      mid := p_id;
    end if;
  exception when unique_violation then raise exception 'já existe um indicador com este nome neste dataset' using errcode = '23505';
  end;
  snapshot := jsonb_build_object('name', trim(p_name), 'type', p_type, 'aggregation', p_agg, 'field', k, 'ast', p_ast, 'filters', p_filters, 'format', p_format, 'unit', nullif(trim(p_unit), ''), 'dataset_id', p_dataset);
  insert into public.metric_versions (organization_id, metric_id, version_number, definition_snapshot_json, created_by) values (p_org, mid, vnum, snapshot, (select auth.uid()));
  if p_id is not null then perform private.bi_revalidate_metrics(p_org, p_dataset); end if;
  return jsonb_build_object('id', mid, 'version', vnum);
end $$;

create function public.bi_archive_metric(p_org uuid, p_id uuid, p_archive boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  perform private.bi_guard(p_org, 'analyst');
  select * into m from public.metric_definitions where id = p_id and organization_id = p_org for update;
  if m.id is null or not private.bi_dataset_visible(p_org, m.dataset_id) then raise exception 'indicador não encontrado' using errcode = 'P0002'; end if;
  if p_archive then
    if exists (select 1 from public.metric_definitions f, jsonb_path_query(f.formula_ast_json, 'strict $.**') y(x) where f.organization_id = p_org and f.status = 'active' and f.metric_type = 'formula' and jsonb_typeof(x) = 'object' and x ->> 'metric' = p_id::text) then
      raise exception 'outra fórmula usa este indicador: arquive ou altere a fórmula primeiro' using errcode = '23514';
    end if;
    if exists (select 1 from public.goal_definitions g where g.metric_id = p_id and g.status = 'active') then raise exception 'há metas ativas para este indicador' using errcode = '23514'; end if;
    update public.metric_definitions set status = 'archived' where id = p_id;
  else
    update public.metric_definitions set status = 'active', invalid_reason = null where id = p_id and status = 'archived';
    perform private.bi_revalidate_metrics(p_org, m.dataset_id);
  end if;
  perform private.bi_audit(p_org, case when p_archive then 'metric_archived' else 'metric_restored' end, 'metric_definitions', p_id, '{}'::jsonb);
end $$;

-- ======================================================================= gráficos (biblioteca reutilizável)
create function public.bi_save_chart(p_org uuid, p_id uuid, p_dataset uuid, p_name text, p_type text, p_config jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cols jsonb; ver uuid; mid text; out uuid; f jsonb;
begin
  perform private.bi_guard(p_org, 'analyst');
  if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select current_version_id into ver from public.datasets where id = p_dataset and organization_id = p_org and status = 'active';
  if ver is null then raise exception 'o dataset precisa estar ativo e ter dados publicados' using errcode = '55000'; end if;
  cols := private.bi_cols(ver);
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then raise exception 'nome inválido (1 a 80 caracteres)' using errcode = '22023'; end if;
  if p_type not in ('kpi', 'bar', 'line', 'area', 'pie', 'donut', 'table', 'stacked_bar', 'combo') then raise exception 'tipo de gráfico inválido' using errcode = '22023'; end if;
  if jsonb_typeof(p_config) <> 'object' or char_length(p_config::text) > 8000 then raise exception 'configuração do gráfico inválida' using errcode = '22023'; end if;
  if jsonb_typeof(p_config -> 'metric_ids') <> 'array' or jsonb_array_length(p_config -> 'metric_ids') not between 1 and 12 then raise exception 'escolha de 1 a 12 indicadores' using errcode = '22023'; end if;
  for mid in select jsonb_array_elements_text(p_config -> 'metric_ids') loop
    if mid !~ '^[0-9a-f-]{36}$' or not exists (select 1 from public.metric_definitions m where m.id = mid::uuid and m.organization_id = p_org and m.dataset_id = p_dataset and m.status = 'active') then
      raise exception 'o gráfico usa um indicador inexistente, inválido ou de outro dataset' using errcode = '22023';
    end if;
  end loop;
  for mid in select x ->> 'field' from jsonb_array_elements(coalesce(p_config -> 'dimensions', '[]'::jsonb)) x loop perform private.bi_key(cols, mid); end loop;
  for f in select * from jsonb_array_elements(coalesce(p_config -> 'filters', '[]'::jsonb)) loop perform private.bi_pred(f, cols, private.bi_tz(p_org)); end loop;
  if p_id is null then
    insert into public.chart_definitions (organization_id, dataset_id, name, chart_type, configuration_json, created_by) values (p_org, p_dataset, trim(p_name), p_type, p_config, (select auth.uid())) returning id into out;
  else
    update public.chart_definitions set name = trim(p_name), chart_type = p_type, configuration_json = p_config where id = p_id and organization_id = p_org and dataset_id = p_dataset returning id into out;
    if out is null then raise exception 'gráfico não encontrado' using errcode = 'P0002'; end if;
  end if;
  return out;
end $$;

create function public.bi_archive_chart(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'analyst');
  update public.chart_definitions c set status = 'archived' where c.id = p_id and c.organization_id = p_org and private.bi_dataset_visible(p_org, c.dataset_id);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.bi_create_dataset(uuid, text, text, boolean)', 'public.bi_update_dataset(uuid, uuid, text, text, boolean)', 'public.bi_archive_dataset(uuid, uuid, boolean)',
    'public.bi_set_dataset_access(uuid, uuid, uuid, boolean)', 'public.bi_update_columns(uuid, uuid, jsonb)', 'public.bi_save_dimension(uuid, uuid, uuid, text, text, text)',
    'public.bi_delete_dimension(uuid, uuid)', 'public.bi_save_metric(uuid, uuid, uuid, text, text, text, text, text, jsonb, jsonb, text, text)', 'public.bi_archive_metric(uuid, uuid, boolean)',
    'public.bi_save_chart(uuid, uuid, uuid, text, text, jsonb)', 'public.bi_archive_chart(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
