-- Dashboard Executivo — MOTOR DE CONSULTAS SEGURAS (docs/QUERY_SECURITY.md).
-- O navegador nunca envia SQL: envia uma ESPECIFICAÇÃO DECLARATIVA (JSON). Aqui ela é revalidada contra o catálogo de colunas da versão
-- e só então convertida em SQL. Identificadores = chaves internas c1..cn já conferidas; valores = literais tipados (format %L + cast).

begin;
set local check_function_bodies = off;

-- ----------------------------------------------------------------------- catálogo de colunas da versão: {"c1": "date", "c2": "string", ...}
create function private.bi_cols(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.column_key, c.data_type), '{}'::jsonb) from public.dataset_columns c where c.dataset_version_id = p_version;
$$;
revoke all on function private.bi_cols(uuid) from public, anon, authenticated;

create function private.bi_is_numeric(t text) returns boolean language sql immutable set search_path = '' as $$ select t in ('integer', 'decimal', 'currency', 'percentage'); $$;
create function private.bi_is_temporal(t text) returns boolean language sql immutable set search_path = '' as $$ select t in ('date', 'timestamp'); $$;

create function private.bi_try_date(p text) returns date language plpgsql immutable set search_path = '' as $$
begin
  if p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

-- Chave de coluna precisa existir no catálogo (nunca confiamos no texto recebido).
create function private.bi_key(p_cols jsonb, p_key text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_key is null or p_key !~ '^c[1-9][0-9]{0,2}$' or not (p_cols ? p_key) then raise exception 'coluna inválida na consulta' using errcode = '22023'; end if;
  return p_key;
end $$;

-- Expressão tipada do valor da coluna. Para filtros de data em timestamp compara-se o DIA CIVIL no fuso da empresa.
create function private.bi_expr(p_type text, p_key text, p_tz text, p_civil boolean default false) returns text
language plpgsql immutable set search_path = '' as $$
begin
  return case
    when private.bi_is_numeric(p_type) then format('(r.values_json ->> %L)::numeric', p_key)
    when p_type = 'date' then format('(r.values_json ->> %L)::date', p_key)
    when p_type = 'timestamp' then case when p_civil then format('((r.values_json ->> %L)::timestamptz at time zone %L)::date', p_key, p_tz) else format('(r.values_json ->> %L)::timestamptz', p_key) end
    when p_type = 'boolean' then format('(r.values_json ->> %L)::boolean', p_key)
    else format('(r.values_json ->> %L)', p_key) end;
end $$;

-- Literal tipado a partir de um jsonb escalar. Qualquer valor fora do formato esperado é recusado.
create function private.bi_lit(p_val jsonb, p_type text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  if p_val is null or jsonb_typeof(p_val) = 'null' then raise exception 'valor de filtro ausente' using errcode = '22023'; end if;
  if p_type = 'boolean' then
    if jsonb_typeof(p_val) <> 'boolean' then raise exception 'valor de filtro inválido' using errcode = '22023'; end if;
    return case when (p_val #>> '{}')::boolean then 'true' else 'false' end;
  end if;
  if jsonb_typeof(p_val) <> 'string' then raise exception 'valor de filtro inválido' using errcode = '22023'; end if;
  v := p_val #>> '{}';
  if char_length(v) > 200 then raise exception 'valor de filtro longo demais' using errcode = '22023'; end if;
  if private.bi_is_numeric(p_type) then
    if v !~ '^-?\d{1,15}(\.\d{1,6})?$' then raise exception 'valor numérico de filtro inválido' using errcode = '22023'; end if;
    return quote_literal(v) || '::numeric';
  elsif private.bi_is_temporal(p_type) then
    if private.bi_try_date(v) is null then raise exception 'data de filtro inválida' using errcode = '22023'; end if;
    return quote_literal(v) || '::date';
  end if;
  return quote_literal(v);
end $$;

create function private.bi_pred(p_f jsonb, p_cols jsonb, p_tz text) returns text
language plpgsql immutable set search_path = '' as $$
declare k text; t text; op text; e text; vals text; a text; b text;
begin
  if jsonb_typeof(p_f) <> 'object' then raise exception 'filtro inválido' using errcode = '22023'; end if;
  k := private.bi_key(p_cols, p_f ->> 'field');
  t := p_cols ->> k;
  op := p_f ->> 'op';
  e := private.bi_expr(t, k, p_tz, true);
  if op = 'empty' then return format('(r.values_json ->> %L) is null', k); end if;
  if op = 'not_empty' then return format('(r.values_json ->> %L) is not null', k); end if;
  if op = 'contains' then
    if t <> 'string' then raise exception 'operador "contém" só vale para texto' using errcode = '22023'; end if;
    return format('strpos(lower(%s), lower(%s)) > 0', e, private.bi_lit(p_f -> 'value', t));
  end if;
  if op in ('eq', 'neq') then
    if op = 'neq' then return format('%s is distinct from %s', e, private.bi_lit(p_f -> 'value', t)); end if;
    return format('%s = %s', e, private.bi_lit(p_f -> 'value', t));
  end if;
  if op = 'in' then
    if jsonb_typeof(p_f -> 'values') <> 'array' or jsonb_array_length(p_f -> 'values') not between 1 and 50 then raise exception 'lista de valores inválida' using errcode = '22023'; end if;
    select string_agg(private.bi_lit(x, t), ', ') into vals from jsonb_array_elements(p_f -> 'values') x;
    return format('%s in (%s)', e, vals);
  end if;
  if op in ('gt', 'gte', 'lt', 'lte', 'between') then
    if not (private.bi_is_numeric(t) or private.bi_is_temporal(t)) then raise exception 'operador de comparação só vale para número ou data' using errcode = '22023'; end if;
    if op = 'between' then
      a := private.bi_lit(p_f -> 'value', t); b := private.bi_lit(p_f -> 'to', t);
      return format('%s between %s and %s', e, a, b);
    end if;
    return format('%s %s %s', e, case op when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' else '<=' end, private.bi_lit(p_f -> 'value', t));
  end if;
  raise exception 'operador de filtro inválido' using errcode = '22023';
end $$;

-- Período [from, to] inclusivo, em dias civis no fuso da empresa (timestamp convertido para o dia civil).
create function private.bi_period_pred(p_period jsonb, p_cols jsonb, p_tz text) returns text
language plpgsql immutable set search_path = '' as $$
declare k text; t text; f date; tt date;
begin
  k := private.bi_key(p_cols, p_period ->> 'field');
  t := p_cols ->> k;
  if not private.bi_is_temporal(t) then raise exception 'o período precisa de uma coluna de data' using errcode = '22023'; end if;
  f := private.bi_try_date(p_period ->> 'from'); tt := private.bi_try_date(p_period ->> 'to');
  if f is null or tt is null or f > tt then raise exception 'período inválido' using errcode = '22023'; end if;
  return format('%s between %L::date and %L::date', private.bi_expr(t, k, p_tz, true), f, tt);
end $$;

-- ----------------------------------------------------------------------- agregação
create function private.bi_exec_query(p_org uuid, p_version uuid, p_spec jsonb, p_tz text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cols jsonb := private.bi_cols(p_version);
  m jsonb; d jsonb; f jsonb; o jsonb;
  k text; t text; agg text; alias text; grain text; mexpr text; expr text; cond text;
  sel text[] := '{}'; grp text[] := '{}'; wh text[] := '{}'; ord text[] := '{}';
  nd int := 0; nm int := 0; lim int; sql text; rows_ jsonb; n int; seen text[] := '{}';
begin
  perform set_config('statement_timeout', '10000', true);
  if jsonb_typeof(p_spec -> 'measures') <> 'array' or jsonb_array_length(p_spec -> 'measures') not between 1 and 12 then raise exception 'use de 1 a 12 medidas' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_spec -> 'dimensions', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_spec -> 'dimensions', '[]'::jsonb)) > 2 then raise exception 'use no máximo 2 dimensões' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_spec -> 'filters', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_spec -> 'filters', '[]'::jsonb)) > 20 then raise exception 'use no máximo 20 filtros' using errcode = '22023'; end if;

  for d in select * from jsonb_array_elements(coalesce(p_spec -> 'dimensions', '[]'::jsonb)) loop
    k := private.bi_key(cols, d ->> 'field');
    if k = any (seen) then raise exception 'dimensões repetidas' using errcode = '22023'; end if;
    seen := seen || k;
    t := cols ->> k;
    grain := d ->> 'grain';
    if grain is not null then
      if grain not in ('day', 'week', 'month', 'quarter', 'year') or not private.bi_is_temporal(t) then raise exception 'granularidade inválida' using errcode = '22023'; end if;
      expr := format('date_trunc(%L, %s)::date::text', grain, private.bi_expr(t, k, p_tz, true));
    elsif private.bi_is_temporal(t) then
      expr := format('%s::text', private.bi_expr(t, k, p_tz, true));
    else
      expr := format('(r.values_json ->> %L)', k);
    end if;
    sel := sel || format('%s as d%s', expr, nd);
    grp := grp || (nd + 1)::text;
    nd := nd + 1;
  end loop;

  seen := '{}';
  for m in select * from jsonb_array_elements(p_spec -> 'measures') loop
    alias := m ->> 'alias';
    agg := m ->> 'agg';
    if alias is null or alias !~ '^m[0-9]{1,2}$' or alias = any (seen) then raise exception 'apelido de medida inválido' using errcode = '22023'; end if;
    seen := seen || alias;
    if agg not in ('sum', 'count', 'count_distinct', 'avg', 'min', 'max') then raise exception 'agregação inválida' using errcode = '22023'; end if;
    if m ->> 'field' is null then
      if agg <> 'count' then raise exception 'esta agregação precisa de uma coluna' using errcode = '22023'; end if;
      mexpr := 'count(*)';
    else
      k := private.bi_key(cols, m ->> 'field');
      t := cols ->> k;
      if agg in ('sum', 'avg') and not private.bi_is_numeric(t) then raise exception 'soma e média exigem coluna numérica' using errcode = '22023'; end if;
      if agg in ('min', 'max') and not (private.bi_is_numeric(t) or private.bi_is_temporal(t)) then raise exception 'mínimo e máximo exigem número ou data' using errcode = '22023'; end if;
      expr := private.bi_expr(t, k, p_tz, false);
      mexpr := case agg
        when 'sum' then format('sum(%s)', expr)
        when 'avg' then format('avg(%s)', expr)
        when 'count' then format('count(r.values_json ->> %L)', k)
        when 'count_distinct' then format('count(distinct (r.values_json ->> %L))', k)
        when 'min' then format('min(%s)', expr)
        else format('max(%s)', expr) end;
    end if;
    if jsonb_typeof(coalesce(m -> 'filters', '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(m -> 'filters', '[]'::jsonb)) > 0 then
      if jsonb_array_length(m -> 'filters') > 20 then raise exception 'filtros demais na medida' using errcode = '22023'; end if;
      select string_agg(private.bi_pred(x, cols, p_tz), ' and ') into cond from jsonb_array_elements(m -> 'filters') x;
      mexpr := format('%s filter (where %s)', mexpr, cond);
    end if;
    sel := sel || format('%s::text as %s', mexpr, alias);
    nm := nm + 1;
  end loop;

  for f in select * from jsonb_array_elements(coalesce(p_spec -> 'filters', '[]'::jsonb)) loop
    wh := wh || private.bi_pred(f, cols, p_tz);
  end loop;
  if jsonb_typeof(p_spec -> 'period') = 'object' then wh := wh || private.bi_period_pred(p_spec -> 'period', cols, p_tz); end if;

  for o in select * from jsonb_array_elements(coalesce(p_spec -> 'order', '[]'::jsonb)) loop
    if (o ->> 'by') !~ '^(d[0-1]|m[0-9]{1,2})$' or (o ->> 'dir') not in ('asc', 'desc') then raise exception 'ordenação inválida' using errcode = '22023'; end if;
    if (o ->> 'by') ~ '^d' and substr(o ->> 'by', 2)::int >= nd then raise exception 'ordenação inválida' using errcode = '22023'; end if;
    if (o ->> 'by') ~ '^m' and not exists (select 1 from jsonb_array_elements(p_spec -> 'measures') x where x ->> 'alias' = o ->> 'by') then raise exception 'ordenação inválida' using errcode = '22023'; end if;
    ord := ord || format('%s %s nulls last', o ->> 'by', o ->> 'dir');
  end loop;
  if cardinality(ord) = 0 and nd > 0 then ord := array['d0 asc nulls last']; end if;

  lim := least(greatest(coalesce((p_spec ->> 'limit')::int, 500), 1), 1000);
  sql := format('select coalesce(jsonb_agg(to_jsonb(t)), %L::jsonb) from (select * from (select %s from public.dataset_rows r where r.dataset_version_id = %L and r.organization_id = %L%s%s) g %s limit %s) t',
    '[]', array_to_string(sel, ', '), p_version, p_org,
    case when cardinality(wh) > 0 then ' and ' || array_to_string(wh, ' and ') else '' end,
    case when cardinality(grp) > 0 then ' group by ' || array_to_string(grp, ', ') else '' end,
    case when cardinality(ord) > 0 then 'order by ' || array_to_string(ord, ', ') else '' end,
    lim + 1);
  execute sql into rows_;
  n := jsonb_array_length(rows_);
  if n > lim then rows_ := (select jsonb_agg(x) from (select x from jsonb_array_elements(rows_) with ordinality e(x, i) where i <= lim order by i) q); end if;
  return jsonb_build_object('rows', coalesce(rows_, '[]'::jsonb), 'truncated', n > lim, 'dimensions', nd, 'measures', nm);
end $$;
revoke all on function private.bi_exec_query(uuid, uuid, jsonb, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------- consulta livre declarativa (explorador): analista+ em dataset visível
create function public.bi_run_query(p_org uuid, p_spec jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ds uuid; v record; res jsonb;
begin
  perform private.bi_guard(p_org, 'analyst');
  if jsonb_typeof(p_spec) <> 'object' or (p_spec ->> 'dataset_id') !~ '^[0-9a-f-]{36}$' then raise exception 'consulta inválida' using errcode = '22023'; end if;
  ds := (p_spec ->> 'dataset_id')::uuid;
  if not private.bi_dataset_visible(p_org, ds) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select v2.* into v from public.dataset_versions v2 join public.datasets d on d.current_version_id = v2.id and d.organization_id = p_org where d.id = ds;
  if v.id is null then raise exception 'o dataset ainda não tem dados publicados' using errcode = '55000'; end if;
  res := private.bi_exec_query(p_org, v.id, p_spec, private.bi_tz(p_org));
  return res || jsonb_build_object('version_id', v.id, 'version_number', v.version_number, 'published_at', v.published_at, 'row_count', v.row_count);
end $$;
revoke all on function public.bi_run_query(uuid, jsonb) from public, anon;
grant execute on function public.bi_run_query(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------- consulta de widget: a especificação vem do BANCO (widget salvo); o chamador só ajusta período e filtros do dashboard
create function private.bi_widget_access(p_org uuid, p_dashboard uuid, p_dataset uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare lvl text; d record; ds record;
begin
  lvl := private.bi_dashboard_level(p_org, p_dashboard);
  if lvl is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select status into d from public.dashboards where id = p_dashboard and organization_id = p_org;
  if d.status = 'archived' then raise exception 'dashboard arquivado' using errcode = '55000'; end if;
  if d.status <> 'published' and lvl = 'view' then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into ds from public.datasets where id = p_dataset and organization_id = p_org;
  if ds.id is null then raise exception 'dataset não encontrado' using errcode = 'P0002'; end if;
  if ds.status = 'archived' then raise exception 'dataset arquivado' using errcode = '55000'; end if;
  -- dataset restrito: vale mesmo com o dashboard compartilhado (sem permissão explícita, nenhum dado sai)
  if ds.restricted and not (private.bi_is_admin(p_org) or exists (select 1 from public.dataset_access a where a.dataset_id = ds.id and a.user_id = (select auth.uid()))) then
    raise exception 'sem acesso ao dataset deste indicador' using errcode = '42501';
  end if;
  return lvl;
end $$;
revoke all on function private.bi_widget_access(uuid, uuid, uuid) from public, anon, authenticated;

create function public.bi_widget_query(p_org uuid, p_dashboard uuid, p_widget uuid, p_overrides jsonb default '{}'::jsonb, p_total boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w record; spec jsonb; ver record; per jsonb; fo jsonb; df record; extra jsonb := '[]'::jsonb; fv jsonb; res jsonb; cols jsonb;
begin
  perform private.bi_guard(p_org, 'read');
  select * into w from public.dashboard_widgets where id = p_widget and dashboard_id = p_dashboard and organization_id = p_org;
  if w.id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  if w.query_json is null or w.dataset_id is null then raise exception 'este widget não consulta dados' using errcode = '22023'; end if;
  perform private.bi_widget_access(p_org, p_dashboard, w.dataset_id);
  select v.* into ver from public.dataset_versions v join public.datasets d on d.current_version_id = v.id and d.organization_id = p_org where d.id = w.dataset_id;
  if ver.id is null then raise exception 'o dataset ainda não tem dados publicados' using errcode = '55000'; end if;
  cols := private.bi_cols(ver.id);
  spec := w.query_json;
  p_overrides := coalesce(p_overrides, '{}'::jsonb);
  -- período: só se o widget declara uma coluna de data e não está travado
  per := spec -> 'period';
  if jsonb_typeof(per) = 'object' and coalesce((per ->> 'locked')::boolean, false) = false and jsonb_typeof(p_overrides -> 'period') = 'object' then
    spec := jsonb_set(spec, '{period}', jsonb_build_object('field', per ->> 'field', 'from', p_overrides -> 'period' ->> 'from', 'to', p_overrides -> 'period' ->> 'to'));
  elsif jsonb_typeof(per) = 'object' and (per ->> 'from') is null then
    spec := spec - 'period';
  end if;
  -- filtros do dashboard (valores vindos do chamador; campo e operador vêm do banco)
  if jsonb_typeof(p_overrides -> 'filters') = 'object' then
    for df in select * from public.dashboard_filters f where f.dashboard_id = p_dashboard and f.organization_id = p_org and f.dataset_id = w.dataset_id loop
      fv := p_overrides -> 'filters' -> df.id::text;
      continue when fv is null or jsonb_typeof(fv) <> 'object';
      fo := jsonb_build_object('field', df.field_key, 'op', df.operator) || (fv - 'field' - 'op');
      extra := extra || fo;
    end loop;
    if jsonb_array_length(extra) > 0 then spec := jsonb_set(spec, '{filters}', coalesce(spec -> 'filters', '[]'::jsonb) || extra); end if;
  end if;
  -- total geral do mesmo recorte (sem dimensões): usado pelo «Outros» da pizza; só REDUZ a consulta salva
  if coalesce(p_total, false) then spec := (spec - 'dimensions' - 'order') || jsonb_build_object('limit', 1); end if;
  res := private.bi_exec_query(p_org, ver.id, spec, private.bi_tz(p_org));
  return res || jsonb_build_object('version_id', ver.id, 'version_number', ver.version_number, 'published_at', ver.published_at);
end $$;
revoke all on function public.bi_widget_query(uuid, uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.bi_widget_query(uuid, uuid, uuid, jsonb, boolean) to authenticated;

-- Fontes do dashboard (nome do dataset, versão, atualização): visível a quem vê o dashboard, sem expor linhas.
create function public.bi_dashboard_sources(p_org uuid, p_dashboard uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare st int;
begin
  perform private.bi_guard(p_org, 'read');
  if private.bi_dashboard_level(p_org, p_dashboard) is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  select stale_days into st from public.bi_settings where organization_id = p_org;
  return coalesce((
    select jsonb_agg(jsonb_build_object('dataset_id', d.id, 'name', d.name, 'status', d.status, 'version_number', v.version_number, 'published_at', v.published_at, 'row_count', v.row_count,
      'stale', v.published_at is null or v.published_at < now() - make_interval(days => st), 'restricted', d.restricted))
    from public.datasets d left join public.dataset_versions v on v.id = d.current_version_id
    where d.organization_id = p_org and d.id in (select w.dataset_id from public.dashboard_widgets w where w.dashboard_id = p_dashboard and w.dataset_id is not null)
  ), '[]'::jsonb);
end $$;
revoke all on function public.bi_dashboard_sources(uuid, uuid) from public, anon;
grant execute on function public.bi_dashboard_sources(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------- valores distintos para filtros (≤ 200), com a mesma autorização do widget/dataset
create function private.bi_distinct(p_org uuid, p_version uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cols jsonb := private.bi_cols(p_version); k text := private.bi_key(cols, p_key); out jsonb;
begin
  if cols ->> k not in ('string', 'boolean', 'integer') then raise exception 'lista de valores só para texto, sim/não ou inteiros' using errcode = '22023'; end if;
  perform set_config('statement_timeout', '5000', true);
  select coalesce(jsonb_agg(v), '[]'::jsonb) into out from (select distinct (r.values_json ->> k) v from public.dataset_rows r where r.dataset_version_id = p_version and r.organization_id = p_org and (r.values_json ->> k) is not null order by 1 limit 200) q;
  return out;
end $$;
revoke all on function private.bi_distinct(uuid, uuid, text) from public, anon, authenticated;

create function public.bi_dashboard_filter_values(p_org uuid, p_dashboard uuid, p_filter uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f record; ver uuid;
begin
  perform private.bi_guard(p_org, 'read');
  select * into f from public.dashboard_filters where id = p_filter and dashboard_id = p_dashboard and organization_id = p_org;
  if f.id is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  perform private.bi_widget_access(p_org, p_dashboard, f.dataset_id);
  select current_version_id into ver from public.datasets where id = f.dataset_id and organization_id = p_org;
  if ver is null then return '[]'::jsonb; end if;
  return private.bi_distinct(p_org, ver, f.field_key);
end $$;
revoke all on function public.bi_dashboard_filter_values(uuid, uuid, uuid) from public, anon;
grant execute on function public.bi_dashboard_filter_values(uuid, uuid, uuid) to authenticated;

create function public.bi_filter_values(p_org uuid, p_dataset uuid, p_field text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ver uuid;
begin
  perform private.bi_guard(p_org, 'analyst');
  if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select current_version_id into ver from public.datasets where id = p_dataset and organization_id = p_org;
  if ver is null then return '[]'::jsonb; end if;
  return private.bi_distinct(p_org, ver, p_field);
end $$;
revoke all on function public.bi_filter_values(uuid, uuid, text) from public, anon;
grant execute on function public.bi_filter_values(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------- linhas paginadas (explorador / detalhe do indicador): analista+; exportação bruta: gestor+
create function public.bi_dataset_rows(p_org uuid, p_dataset uuid, p_filters jsonb default '[]'::jsonb, p_period jsonb default null, p_sort text default null, p_dir text default 'asc',
                                       p_page integer default 1, p_size integer default 50, p_for_export boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ver record; cols jsonb; wh text[] := '{}'; f jsonb; sql text; rows_ jsonb; total bigint; ord text := 'r.id'; size int; tz text := private.bi_tz(p_org); k text;
begin
  perform private.bi_guard(p_org, case when p_for_export then 'manager' else 'analyst' end);
  if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select v.* into ver from public.dataset_versions v join public.datasets d on d.current_version_id = v.id and d.organization_id = p_org where d.id = p_dataset;
  if ver.id is null then raise exception 'o dataset ainda não tem dados publicados' using errcode = '55000'; end if;
  if ver.rows_purged then raise exception 'as linhas desta versão foram removidas pela política de retenção' using errcode = '55000'; end if;
  cols := private.bi_cols(ver.id);
  if jsonb_typeof(coalesce(p_filters, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_filters, '[]'::jsonb)) > 20 then raise exception 'use no máximo 20 filtros' using errcode = '22023'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) loop wh := wh || private.bi_pred(f, cols, tz); end loop;
  if jsonb_typeof(p_period) = 'object' then wh := wh || private.bi_period_pred(p_period, cols, tz); end if;
  size := case when p_for_export then least(greatest(p_size, 1), 5000) else least(greatest(p_size, 1), 100) end;
  if p_sort is not null then
    k := private.bi_key(cols, p_sort);
    if p_dir not in ('asc', 'desc') then raise exception 'ordenação inválida' using errcode = '22023'; end if;
    ord := format('%s %s nulls last, r.id', private.bi_expr(cols ->> k, k, tz, false), p_dir);
  end if;
  perform set_config('statement_timeout', '10000', true);
  sql := format('select count(*) from public.dataset_rows r where r.dataset_version_id = %L and r.organization_id = %L%s', ver.id, p_org, case when cardinality(wh) > 0 then ' and ' || array_to_string(wh, ' and ') else '' end);
  execute sql into total;
  sql := format('select coalesce(jsonb_agg(jsonb_build_object(''n'', t.source_row_number, ''v'', t.values_json)), %L::jsonb) from (select r.source_row_number, r.values_json from public.dataset_rows r where r.dataset_version_id = %L and r.organization_id = %L%s order by %s limit %s offset %s) t',
    '[]', ver.id, p_org, case when cardinality(wh) > 0 then ' and ' || array_to_string(wh, ' and ') else '' end, ord, size, (greatest(p_page, 1) - 1) * size);
  execute sql into rows_;
  if p_for_export then
    insert into public.report_exports (organization_id, dataset_id, report_type, row_count, filters_json, created_by)
    select p_org, p_dataset, 'dataset_csv', jsonb_array_length(rows_), jsonb_build_object('filters', coalesce(p_filters, '[]'::jsonb)), (select auth.uid()) where greatest(p_page, 1) = 1;
    if greatest(p_page, 1) = 1 then perform private.bi_audit(p_org, 'dataset_export', 'datasets', p_dataset, jsonb_build_object('rows', total)); end if;
  end if;
  return jsonb_build_object('rows', rows_, 'total', total, 'page', greatest(p_page, 1), 'size', size, 'version_id', ver.id, 'version_number', ver.version_number);
end $$;
revoke all on function public.bi_dataset_rows(uuid, uuid, jsonb, jsonb, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.bi_dataset_rows(uuid, uuid, jsonb, jsonb, text, text, integer, integer, boolean) to authenticated;

commit;
