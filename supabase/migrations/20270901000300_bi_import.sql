-- Dashboard Executivo — IMPORTAÇÃO EM ETAPAS (docs/IMPORT_ENGINE.md): begin → stage (lotes) → finish → publish (atômico). Falha preserva a versão ativa.
-- O servidor da aplicação tipa e valida o arquivo; o banco REVALIDA tudo que recebe (quem chama a API direto não consegue gravar dado fora do tipo).

begin;
set local check_function_bodies = off;

create function private.bi_try_ts(p text) returns timestamptz language plpgsql immutable set search_path = '' as $$
begin
  if p !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$' then return null; end if;
  return p::timestamptz;
exception when others then return null;
end $$;

-- Valor gravado em values_json precisa estar na forma canônica do tipo da coluna.
create function private.bi_value_ok(v jsonb, t text) returns boolean language sql immutable set search_path = '' as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then true
    when t in ('integer') then jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?\d{1,15}$'
    when t in ('decimal', 'currency', 'percentage') then jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?\d{1,15}(\.\d{1,6})?$'
    when t = 'date' then jsonb_typeof(v) = 'string' and private.bi_try_date(v #>> '{}') is not null
    when t = 'timestamp' then jsonb_typeof(v) = 'string' and private.bi_try_ts(v #>> '{}') is not null
    when t = 'boolean' then jsonb_typeof(v) = 'boolean'
    else jsonb_typeof(v) = 'string' and char_length(v #>> '{}') <= 500 end;
$$;

-- Valida e normaliza a definição de colunas recebida (chaves internas únicas, tipos e papéis de listas fechadas).
create function private.bi_check_columns(p_columns jsonb, p_max int) returns void language plpgsql immutable set search_path = '' as $$
declare c jsonb; seen text[] := '{}'; names text[] := '{}'; k text;
begin
  if jsonb_typeof(p_columns) <> 'array' or jsonb_array_length(p_columns) not between 1 and p_max then raise exception 'o dataset precisa de 1 a % colunas', p_max using errcode = '22023'; end if;
  for c in select * from jsonb_array_elements(p_columns) loop
    k := c ->> 'key';
    if k is null or k !~ '^c[1-9][0-9]{0,2}$' or k = any (seen) then raise exception 'chave de coluna inválida ou repetida' using errcode = '22023'; end if;
    seen := seen || k;
    if jsonb_typeof(c -> 'name') <> 'string' or char_length(trim(c ->> 'name')) not between 1 and 80 then raise exception 'nome de coluna inválido (1 a 80 caracteres)' using errcode = '22023'; end if;
    if lower(trim(c ->> 'name')) = any (names) then raise exception 'nome de coluna repetido: %', c ->> 'name' using errcode = '22023'; end if;
    names := names || lower(trim(c ->> 'name'));
    if (c ->> 'type') not in ('string', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'currency', 'percentage') then raise exception 'tipo de coluna inválido' using errcode = '22023'; end if;
    if coalesce(c ->> 'semantic', 'dimension') not in ('dimension', 'measure', 'time', 'identifier') then raise exception 'papel de coluna inválido' using errcode = '22023'; end if;
    if coalesce(c ->> 'locale', 'br') not in ('br', 'us') then raise exception 'formato numérico inválido' using errcode = '22023'; end if;
  end loop;
end $$;
revoke all on function private.bi_check_columns(jsonb, int) from public, anon, authenticated;

-- Itens que usam colunas removidas ou com tipo alterado (métricas, dimensões, filtros e widgets).
create function private.bi_impact(p_org uuid, p_dataset uuid, p_columns jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cur uuid; lost jsonb := '[]'::jsonb; rec jsonb; c record; newt text; out jsonb := '[]'::jsonb; keyq text;
begin
  select current_version_id into cur from public.datasets where id = p_dataset and organization_id = p_org;
  if cur is null then return '[]'::jsonb; end if;
  for c in select column_key, data_type, display_name from public.dataset_columns where dataset_version_id = cur loop
    select x ->> 'type' into newt from jsonb_array_elements(p_columns) x where x ->> 'key' = c.column_key;
    if newt is null then lost := lost || jsonb_build_object('key', c.column_key, 'name', c.display_name, 'reason', 'coluna removida');
    elsif newt <> c.data_type then lost := lost || jsonb_build_object('key', c.column_key, 'name', c.display_name, 'reason', 'tipo alterado de ' || c.data_type || ' para ' || newt);
    end if;
  end loop;
  for rec in select value from jsonb_array_elements(lost) loop
    keyq := '"' || (rec ->> 'key') || '"';
    out := out || coalesce((select jsonb_agg(jsonb_build_object('kind', 'métrica', 'id', m.id, 'name', m.name, 'column', rec ->> 'name', 'reason', rec ->> 'reason'))
      from public.metric_definitions m where m.dataset_id = p_dataset and m.organization_id = p_org and m.status <> 'archived' and (m.field_key = rec ->> 'key' or position(keyq in m.filters_json::text) > 0)), '[]'::jsonb);
    out := out || coalesce((select jsonb_agg(jsonb_build_object('kind', 'dimensão', 'id', d.id, 'name', d.name, 'column', rec ->> 'name', 'reason', rec ->> 'reason'))
      from public.dimension_definitions d where d.dataset_id = p_dataset and d.organization_id = p_org and d.column_key = rec ->> 'key'), '[]'::jsonb);
    out := out || coalesce((select jsonb_agg(jsonb_build_object('kind', 'filtro de dashboard', 'id', f.id, 'name', f.label, 'column', rec ->> 'name', 'reason', rec ->> 'reason'))
      from public.dashboard_filters f where f.dataset_id = p_dataset and f.organization_id = p_org and f.field_key = rec ->> 'key'), '[]'::jsonb);
    out := out || coalesce((select jsonb_agg(jsonb_build_object('kind', 'widget', 'id', w.id, 'name', w.title, 'column', rec ->> 'name', 'reason', rec ->> 'reason'))
      from public.dashboard_widgets w where w.dataset_id = p_dataset and w.organization_id = p_org and position(keyq in coalesce(w.query_json::text, '')) > 0), '[]'::jsonb);
  end loop;
  return out;
end $$;
revoke all on function private.bi_impact(uuid, uuid, jsonb) from public, anon, authenticated;

create function public.bi_import_impact(p_org uuid, p_dataset uuid, p_columns jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bi_guard(p_org, 'analyst');
  if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
  perform private.bi_check_columns(p_columns, 100);
  return private.bi_impact(p_org, p_dataset, p_columns);
end $$;
revoke all on function public.bi_import_impact(uuid, uuid, jsonb) from public, anon;
grant execute on function public.bi_import_impact(uuid, uuid, jsonb) to authenticated;

-- Limpa importações abandonadas (processando há mais de 30 min): marca como falha e remove as linhas de staging.
create function private.bi_cleanup_stale(p_org uuid, p_dataset uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare j record; n int := 0;
begin
  for j in select * from public.import_jobs where organization_id = p_org and dataset_id = p_dataset and status = 'processing' and created_at < now() - interval '30 minutes' loop
    perform set_config('bi.allow_row_delete', 'on', true);
    delete from public.dataset_rows where dataset_version_id = j.dataset_version_id and organization_id = p_org;
    perform set_config('bi.allow_row_delete', 'off', true);
    update public.dataset_versions set status = 'failed' where id = j.dataset_version_id and status = 'staging';
    update public.import_jobs set status = 'failed', error_message = 'Importação abandonada (tempo esgotado).', completed_at = now() where id = j.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.bi_cleanup_stale(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------- 1) início
create function public.bi_begin_import(p_org uuid, p_dataset uuid, p_new_name text, p_file_name text, p_file_hash text, p_file_type text, p_mode text,
                                       p_invalid_policy text, p_columns jsonb, p_mapping jsonb, p_total_rows integer, p_notes jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record; ds record; ver_n int; ver uuid; job uuid; cur record; ncols jsonb := p_columns; c record; created boolean := false; dedupe_n int;
begin
  perform private.bi_guard(p_org, 'analyst');
  select * into s from public.bi_settings where organization_id = p_org;
  if p_mode not in ('replace', 'append') then raise exception 'modo de importação inválido' using errcode = '22023'; end if;
  if p_invalid_policy not in ('reject_all', 'skip_invalid') then raise exception 'política de linhas inválidas inválida' using errcode = '22023'; end if;
  if p_file_type not in ('csv', 'xlsx') then raise exception 'tipo de arquivo inválido' using errcode = '22023'; end if;
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then raise exception 'identificação do arquivo inválida' using errcode = '22023'; end if;
  if p_file_name is null or char_length(p_file_name) not between 1 and 200 then raise exception 'nome de arquivo inválido' using errcode = '22023'; end if;
  if p_total_rows is null or p_total_rows < 1 or p_total_rows > s.max_rows then raise exception 'o arquivo precisa ter de 1 a % linhas de dados', s.max_rows using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_notes, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_notes, '[]'::jsonb)) > 20 then raise exception 'observações demais' using errcode = '22023'; end if;

  if p_dataset is null then
    if p_mode <> 'replace' then raise exception 'um dataset novo só aceita a carga inicial' using errcode = '22023'; end if;
    if p_new_name is null or char_length(trim(p_new_name)) not between 1 and 80 then raise exception 'informe o nome do dataset (1 a 80 caracteres)' using errcode = '22023'; end if;
    begin
      insert into public.datasets (organization_id, name, created_by) values (p_org, trim(p_new_name), (select auth.uid())) returning * into ds;
    exception when unique_violation then raise exception 'já existe um dataset com este nome' using errcode = '23505';
    end;
    created := true;
  else
    if not private.bi_dataset_visible(p_org, p_dataset) then raise exception 'sem permissão' using errcode = '42501'; end if;
    select * into ds from public.datasets where id = p_dataset and organization_id = p_org for update;
    if ds.id is null then raise exception 'dataset não encontrado' using errcode = 'P0002'; end if;
    if ds.status = 'archived' then raise exception 'dataset arquivado não recebe importações' using errcode = '55000'; end if;
    perform private.bi_cleanup_stale(p_org, ds.id);
  end if;

  if exists (select 1 from public.import_jobs j where j.dataset_id = ds.id and j.status = 'processing') then raise exception 'já existe uma importação em andamento neste dataset' using errcode = '55000'; end if;
  if exists (select 1 from public.import_jobs j where j.dataset_id = ds.id and j.file_hash = p_file_hash and j.status = 'published') then
    raise exception 'este arquivo (mesmo conteúdo) já foi importado neste dataset' using errcode = '23505';
  end if;

  if p_mode = 'append' then
    if ds.current_version_id is null then raise exception 'não há dados para acrescentar: faça a carga inicial' using errcode = '55000'; end if;
    -- inclusão: o esquema é o da versão ativa (mesmas chaves e tipos) e precisa de chave de deduplicação
    select jsonb_agg(jsonb_build_object('key', column_key, 'name', display_name, 'type', data_type, 'semantic', semantic_type, 'required', not nullable, 'locale', locale, 'dedupe', dedupe, 'position', position) order by position)
      into ncols from public.dataset_columns where dataset_version_id = ds.current_version_id;
    select count(*) into dedupe_n from public.dataset_columns where dataset_version_id = ds.current_version_id and dedupe;
    if dedupe_n = 0 then raise exception 'defina uma chave de deduplicação no dataset antes de acrescentar registros (ou use substituição)' using errcode = '55000'; end if;
    -- o chamador envia as colunas do arquivo já mapeadas; elas precisam bater com o esquema ativo
    for c in select x ->> 'key' as k, x ->> 'type' as t from jsonb_array_elements(p_columns) x loop
      if not exists (select 1 from public.dataset_columns dc where dc.dataset_version_id = ds.current_version_id and dc.column_key = c.k and dc.data_type = c.t) then
        raise exception 'as colunas do arquivo não correspondem ao esquema atual do dataset' using errcode = '22023';
      end if;
    end loop;
  else
    perform private.bi_check_columns(p_columns, least(100, 100));
    if exists (select 1 from jsonb_array_elements(p_columns) x where coalesce((x ->> 'dedupe')::boolean, false) and (x ->> 'type') in ('decimal')) then
      raise exception 'coluna decimal não pode ser chave de deduplicação' using errcode = '22023';
    end if;
  end if;

  select coalesce(max(version_number), 0) + 1 into ver_n from public.dataset_versions where dataset_id = ds.id;
  insert into public.dataset_versions (organization_id, dataset_id, version_number, schema_json, mapping_json, status, created_by)
    values (p_org, ds.id, ver_n, ncols, coalesce(p_mapping, '{}'::jsonb), 'staging', (select auth.uid())) returning id into ver;
  insert into public.dataset_columns (organization_id, dataset_version_id, column_key, display_name, data_type, semantic_type, nullable, dedupe, locale, position)
    select p_org, ver, x ->> 'key', trim(x ->> 'name'), x ->> 'type', coalesce(x ->> 'semantic', 'dimension'), not coalesce((x ->> 'required')::boolean, false), coalesce((x ->> 'dedupe')::boolean, false),
           coalesce(x ->> 'locale', 'br'), coalesce((x ->> 'position')::int, ord - 1)
    from jsonb_array_elements(ncols) with ordinality t(x, ord);
  insert into public.import_jobs (organization_id, dataset_id, dataset_version_id, file_name, file_hash, file_type, import_mode, invalid_policy, total_rows, notes, created_by)
    values (p_org, ds.id, ver, p_file_name, p_file_hash, p_file_type, p_mode, p_invalid_policy, p_total_rows, coalesce(p_notes, '[]'::jsonb), (select auth.uid())) returning id into job;
  update public.dataset_versions set source_import_id = job where id = ver;
  insert into public.data_refresh_events (organization_id, dataset_id, dataset_version_id, import_job_id, refresh_type, status)
    values (p_org, ds.id, ver, job, case when ds.current_version_id is null then 'initial' else p_mode end, 'started');
  perform private.bi_audit(p_org, 'import_started', 'import_jobs', job, jsonb_build_object('mode', p_mode, 'file_type', p_file_type, 'rows', p_total_rows));
  return jsonb_build_object('job_id', job, 'version_id', ver, 'dataset_id', ds.id, 'version_number', ver_n, 'created_dataset', created);
end $$;
revoke all on function public.bi_begin_import(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, integer, jsonb) from public, anon;
grant execute on function public.bi_begin_import(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, integer, jsonb) to authenticated;

-- ----------------------------------------------------------------------- 2) lotes de linhas (≤ 2.000 por chamada)
create function public.bi_stage_rows(p_org uuid, p_job uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare j record; n int; bad int; staged int;
begin
  perform private.bi_guard(p_org, 'analyst');
  select * into j from public.import_jobs where id = p_job and organization_id = p_org for update;
  if j.id is null or j.created_by is distinct from (select auth.uid()) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if j.status <> 'processing' then raise exception 'a importação não está em andamento' using errcode = '55000'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'lote inválido' using errcode = '22023'; end if;
  n := jsonb_array_length(p_rows);
  if n = 0 or n > 2000 then raise exception 'cada lote tem de 1 a 2000 linhas' using errcode = '22023'; end if;
  select count(*) into staged from public.dataset_rows where dataset_version_id = j.dataset_version_id;
  if staged + n > j.total_rows then raise exception 'mais linhas do que o declarado no início da importação' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'v') <> 'object' or jsonb_typeof(r -> 'n') <> 'number') then raise exception 'linha em formato inválido' using errcode = '22023'; end if;
  -- chaves precisam existir no catálogo da versão; valores precisam estar na forma canônica do tipo
  select count(*) into bad from jsonb_array_elements(p_rows) r cross join lateral jsonb_each(r -> 'v') kv
    left join public.dataset_columns c on c.dataset_version_id = j.dataset_version_id and c.column_key = kv.key
    where c.id is null or not private.bi_value_ok(kv.value, c.data_type);
  if bad > 0 then raise exception 'valores fora do tipo da coluna em % célula(s)', bad using errcode = '22023'; end if;
  select count(*) into bad from jsonb_array_elements(p_rows) r cross join public.dataset_columns c
    where c.dataset_version_id = j.dataset_version_id and not c.nullable and (r -> 'v' -> c.column_key is null or jsonb_typeof(r -> 'v' -> c.column_key) = 'null');
  if bad > 0 then raise exception 'campo obrigatório vazio em % célula(s)', bad using errcode = '22023'; end if;
  begin
    insert into public.dataset_rows (organization_id, dataset_id, dataset_version_id, source_row_number, row_key, values_json)
      select p_org, j.dataset_id, j.dataset_version_id, (r ->> 'n')::int, nullif(r ->> 'k', ''), r -> 'v' from jsonb_array_elements(p_rows) r;
  exception when unique_violation then raise exception 'chave de deduplicação repetida no arquivo' using errcode = '23505';
  end;
  update public.import_jobs set processed_rows = staged + n where id = j.id;
  return staged + n;
end $$;
revoke all on function public.bi_stage_rows(uuid, uuid, jsonb) from public, anon;
grant execute on function public.bi_stage_rows(uuid, uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------- 3) fechamento da leitura: contagens e erros por linha
create function public.bi_finish_import(p_org uuid, p_job uuid, p_valid integer, p_invalid integer, p_errors jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j record; staged int;
begin
  perform private.bi_guard(p_org, 'analyst');
  select * into j from public.import_jobs where id = p_job and organization_id = p_org for update;
  if j.id is null or j.created_by is distinct from (select auth.uid()) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if j.status <> 'processing' then raise exception 'a importação não está em andamento' using errcode = '55000'; end if;
  if p_valid < 0 or p_invalid < 0 or p_valid + p_invalid <> j.total_rows then raise exception 'contagens inconsistentes com o total de linhas do arquivo' using errcode = '22023'; end if;
  select count(*) into staged from public.dataset_rows where dataset_version_id = j.dataset_version_id;
  if staged <> p_valid then raise exception 'envio incompleto: % de % linhas válidas chegaram', staged, p_valid using errcode = '55000'; end if;
  if jsonb_typeof(coalesce(p_errors, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_errors, '[]'::jsonb)) > 1000 then raise exception 'erros demais para registrar' using errcode = '22023'; end if;
  insert into public.import_row_errors (organization_id, import_job_id, row_number, column_key, error_code, error_message, rejected_value)
    select p_org, p_job, (e ->> 'row')::int, nullif(e ->> 'column', ''), left(e ->> 'code', 40), left(e ->> 'message', 300), left(e ->> 'value', 80) from jsonb_array_elements(coalesce(p_errors, '[]'::jsonb)) e;
  update public.import_jobs set status = 'ready', valid_rows = p_valid, invalid_rows = p_invalid, processed_rows = staged where id = j.id;
  return jsonb_build_object('job_id', j.id, 'valid_rows', p_valid, 'invalid_rows', p_invalid);
end $$;
revoke all on function public.bi_finish_import(uuid, uuid, integer, integer, jsonb) from public, anon;
grant execute on function public.bi_finish_import(uuid, uuid, integer, integer, jsonb) to authenticated;

-- ----------------------------------------------------------------------- estatísticas da versão (uma varredura)
create function private.bi_version_stats(p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare parts text[]; sql text; res jsonb;
begin
  select array_agg(format('count(*) filter (where r.values_json ->> %L is null) as %I', column_key, column_key) order by position) into parts from public.dataset_columns where dataset_version_id = p_version;
  sql := format('select to_jsonb(q) from (select count(*) as _rows, %s from public.dataset_rows r where r.dataset_version_id = %L) q', array_to_string(parts, ', '), p_version);
  execute sql into res;
  return jsonb_build_object('rows', (res ->> '_rows')::bigint, 'nulls', res - '_rows');
end $$;
revoke all on function private.bi_version_stats(uuid) from public, anon, authenticated;

-- Marca como inválidas as métricas que dependem de coluna que sumiu ou mudou de tipo (e reativa as que voltaram a valer).
create function private.bi_revalidate_metrics(p_org uuid, p_dataset uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare cols jsonb; ver uuid; m record; bad text; changed int := 0; pass int; ref text; f jsonb;
begin
  select current_version_id into ver from public.datasets where id = p_dataset and organization_id = p_org;
  cols := private.bi_cols(ver);
  for pass in 1..2 loop
    for m in select * from public.metric_definitions where dataset_id = p_dataset and organization_id = p_org and status <> 'archived' order by metric_type loop
      bad := null;
      if m.metric_type = 'aggregation' then
        if m.field_key is not null then
          if not (cols ? m.field_key) then bad := 'a coluna usada não existe mais';
          elsif m.aggregation in ('sum', 'avg') and not private.bi_is_numeric(cols ->> m.field_key) then bad := 'a coluna usada deixou de ser numérica';
          elsif m.aggregation in ('min', 'max') and not (private.bi_is_numeric(cols ->> m.field_key) or private.bi_is_temporal(cols ->> m.field_key)) then bad := 'a coluna usada mudou de tipo';
          end if;
        end if;
        if bad is null then
          for f in select * from jsonb_array_elements(m.filters_json) loop
            if not (cols ? (f ->> 'field')) then bad := 'um filtro da métrica usa uma coluna que não existe mais'; exit; end if;
          end loop;
        end if;
      else
        for ref in select distinct x ->> 'metric' from jsonb_path_query(m.formula_ast_json, 'strict $.**') y(x) where x ? 'metric' loop
          if exists (select 1 from public.metric_definitions r where r.id = ref::uuid and r.organization_id = p_org and r.status <> 'active') then bad := 'depende de uma métrica inválida ou arquivada'; exit; end if;
        end loop;
      end if;
      if bad is not null and m.status = 'active' then
        update public.metric_definitions set status = 'invalid', invalid_reason = bad where id = m.id; changed := changed + 1;
      elsif bad is null and m.status = 'invalid' then
        update public.metric_definitions set status = 'active', invalid_reason = null where id = m.id; changed := changed + 1;
      end if;
    end loop;
  end loop;
  return changed;
end $$;
revoke all on function private.bi_revalidate_metrics(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------- 4) publicação atômica
create function public.bi_publish_import(p_org uuid, p_job uuid, p_ack_impact boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j record; ds record; s record; prev uuid; impact jsonb := '[]'::jsonb; skipped int := 0; total int; stats jsonb; invalidated int; old_v record; kept int; new_cols jsonb;
begin
  perform private.bi_guard(p_org, 'analyst');
  select * into j from public.import_jobs where id = p_job and organization_id = p_org;
  if j.id is null or (j.created_by is distinct from (select auth.uid()) and not private.bi_is_admin(p_org)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into ds from public.datasets where id = j.dataset_id and organization_id = p_org for update;      -- serializa publicações do mesmo dataset
  select * into j from public.import_jobs where id = p_job and organization_id = p_org for update;
  if j.status = 'published' then raise exception 'importação já publicada' using errcode = '23514'; end if;
  if j.status <> 'ready' then raise exception 'a importação não está pronta para publicar' using errcode = '55000'; end if;
  if ds.status = 'archived' then raise exception 'dataset arquivado' using errcode = '55000'; end if;
  select * into s from public.bi_settings where organization_id = p_org;
  if j.invalid_rows > 0 and j.invalid_policy <> 'skip_invalid' then raise exception 'há % linha(s) com erro: corrija o arquivo ou escolha importar só as linhas válidas', j.invalid_rows using errcode = '23514'; end if;
  if j.valid_rows < 1 then raise exception 'nenhuma linha válida para publicar' using errcode = '23514'; end if;
  prev := ds.current_version_id;

  if j.import_mode = 'append' then
    if prev is null then raise exception 'não há versão ativa para acrescentar' using errcode = '55000'; end if;
    -- registros cuja chave já existe são ignorados (e contados); o restante entra junto com todas as linhas da versão ativa
    perform set_config('bi.allow_row_delete', 'on', true);
    with del as (
      delete from public.dataset_rows n using public.dataset_rows o
       where n.dataset_version_id = j.dataset_version_id and o.dataset_version_id = prev and n.row_key is not null and n.row_key = o.row_key returning n.id
    ) select count(*) into skipped from del;
    perform set_config('bi.allow_row_delete', 'off', true);
    select count(*) into kept from public.dataset_rows where dataset_version_id = j.dataset_version_id;
    total := kept + (select row_count from public.dataset_versions where id = prev);
    if total > s.max_rows then raise exception 'o resultado teria % linhas (limite % por dataset)', total, s.max_rows using errcode = '23514'; end if;
    insert into public.dataset_rows (organization_id, dataset_id, dataset_version_id, source_row_number, row_key, values_json, imported_at)
      select organization_id, dataset_id, j.dataset_version_id, source_row_number, row_key, values_json, imported_at from public.dataset_rows where dataset_version_id = prev;
  else
    total := j.valid_rows;
    if prev is not null then
      select coalesce(jsonb_agg(jsonb_build_object('key', column_key, 'type', data_type)), '[]'::jsonb) into new_cols from public.dataset_columns where dataset_version_id = j.dataset_version_id;
      impact := private.bi_impact(p_org, ds.id, new_cols);
      if jsonb_array_length(impact) > 0 and not p_ack_impact then
        raise exception 'a nova versão afeta % item(ns) existente(s) (indicadores, filtros ou gráficos): revise e confirme o impacto', jsonb_array_length(impact) using errcode = '23514';
      end if;
    end if;
  end if;

  if (select count(*) from public.dataset_rows where dataset_version_id = j.dataset_version_id) <> total then raise exception 'contagem de linhas inconsistente: a publicação foi cancelada' using errcode = '55000'; end if;
  stats := private.bi_version_stats(j.dataset_version_id);
  update public.dataset_versions set status = 'published', row_count = total, published_at = now(), stats_json = stats || jsonb_build_object('rejected', j.invalid_rows, 'skipped_existing', skipped) where id = j.dataset_version_id;
  if prev is not null then update public.dataset_versions set status = 'superseded' where id = prev and status = 'published'; end if;
  update public.datasets set current_version_id = j.dataset_version_id, updated_at = now() where id = ds.id;
  update public.import_jobs set status = 'published', skipped_existing = skipped, completed_at = now() where id = j.id;
  update public.data_refresh_events set status = 'completed', completed_at = now() where import_job_id = j.id and status = 'started';
  invalidated := private.bi_revalidate_metrics(p_org, ds.id);

  -- retenção explícita: mantém as N últimas versões COM linhas; as anteriores perdem as linhas (metadados, esquema e estatísticas permanecem)
  for old_v in select id from public.dataset_versions where dataset_id = ds.id and not rows_purged and status in ('superseded', 'failed')
      order by version_number desc offset greatest(s.retained_versions - 1, 1) loop
    perform set_config('bi.allow_row_delete', 'on', true);
    delete from public.dataset_rows where dataset_version_id = old_v.id and organization_id = p_org;
    perform set_config('bi.allow_row_delete', 'off', true);
    update public.dataset_versions set rows_purged = true where id = old_v.id;
  end loop;

  perform private.bi_audit(p_org, 'import_published', 'datasets', ds.id, jsonb_build_object('rows', total, 'mode', j.import_mode, 'rejected', j.invalid_rows, 'skipped_existing', skipped));
  perform private.bi_notify_user(p_org, j.created_by, 'import_done', 'Importação concluída', 'O dataset «' || ds.name || '» recebeu a versão ' || (select version_number from public.dataset_versions where id = j.dataset_version_id) || '.', 'datasets', ds.id, 'import:' || j.id);
  if invalidated > 0 then
    perform private.bi_notify_roles(p_org, array['owner', 'admin', 'manager', 'member']::public.org_role[], 'metric_invalid', 'Indicadores precisam de revisão', 'A atualização de «' || ds.name || '» alterou colunas usadas por indicadores.', 'datasets', ds.id, 'invalid:' || j.id);
  end if;
  return jsonb_build_object('version_id', j.dataset_version_id, 'row_count', total, 'skipped_existing', skipped, 'impact', impact, 'metrics_changed', invalidated);
end $$;
revoke all on function public.bi_publish_import(uuid, uuid, boolean) from public, anon;
grant execute on function public.bi_publish_import(uuid, uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------- cancelar / falhar (preserva a versão ativa)
create function public.bi_fail_import(p_org uuid, p_job uuid, p_message text default 'Importação cancelada.') returns void
language plpgsql security definer set search_path = '' as $$
declare j record;
begin
  perform private.bi_guard(p_org, 'analyst');
  select * into j from public.import_jobs where id = p_job and organization_id = p_org for update;
  if j.id is null or (j.created_by is distinct from (select auth.uid()) and not private.bi_is_admin(p_org)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if j.status not in ('processing', 'ready') then raise exception 'a importação já foi encerrada' using errcode = '55000'; end if;
  perform set_config('bi.allow_row_delete', 'on', true);
  delete from public.dataset_rows where dataset_version_id = j.dataset_version_id and organization_id = p_org;
  perform set_config('bi.allow_row_delete', 'off', true);
  update public.dataset_versions set status = 'failed' where id = j.dataset_version_id and status = 'staging';
  update public.import_jobs set status = 'failed', error_message = left(coalesce(p_message, 'Importação cancelada.'), 300), completed_at = now() where id = j.id;
  update public.data_refresh_events set status = 'failed', completed_at = now(), error_message = left(coalesce(p_message, 'Importação cancelada.'), 300) where import_job_id = j.id and status = 'started';
  perform private.bi_audit(p_org, 'import_failed', 'import_jobs', j.id, '{}'::jsonb);
  perform private.bi_notify_user(p_org, j.created_by, 'import_failed', 'Importação não concluída', left(coalesce(p_message, 'Importação cancelada.'), 200), 'import_jobs', j.id, 'importfail:' || j.id);
end $$;
revoke all on function public.bi_fail_import(uuid, uuid, text) from public, anon;
grant execute on function public.bi_fail_import(uuid, uuid, text) to authenticated;

commit;
