-- Dashboard Executivo — GUARDAS: helpers, bootstrap da empresa, guard de função, auditoria, avisos e imutabilidade.

begin;
set local check_function_bodies = off;

create function private.bi_tz(org uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce((select s.timezone from public.bi_settings s where s.organization_id = org), 'America/Sao_Paulo');
$$;
create function private.bi_today(org uuid) returns date
language sql stable set search_path = '' as $$ select (now() at time zone private.bi_tz(org))::date; $$;

-- ======================================================================= padrões por empresa
create function private.bi_bootstrap_org(org uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.bi_settings (organization_id) values (org) on conflict do nothing;
end $$;
revoke all on function private.bi_bootstrap_org(uuid) from public, anon, authenticated;
create function private.bi_on_org_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.bi_bootstrap_org(new.id); return null; end $$;
revoke all on function private.bi_on_org_created() from public, anon, authenticated;
create trigger bi_on_org_created after insert on public.organizations for each row execute function private.bi_on_org_created();
select private.bi_bootstrap_org(id) from public.organizations;

-- ======================================================================= guard: sessão + MFA + papel (toda função bi_* começa por aqui)
create function private.bi_guard(p_org uuid, p_level text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare ok boolean;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
  ok := case p_level when 'admin' then private.bi_is_admin(p_org) when 'manager' then private.bi_is_manager(p_org)
                     when 'analyst' then private.bi_is_analyst(p_org) else private.bi_can_read(p_org) end;
  if not ok then raise exception 'sem permissão' using errcode = '42501'; end if;
end $$;
revoke all on function private.bi_guard(uuid, text) from public, anon;
grant execute on function private.bi_guard(uuid, text) to authenticated;

create function private.bi_audit(p_org uuid, p_action text, p_entity text, p_entity_id uuid, p_changes jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes) values (p_org, (select auth.uid()), p_action, p_entity, p_entity_id::text, p_changes);
end $$;
revoke all on function private.bi_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- ======================================================================= avisos (sem dados restritos no texto; deduplicados)
create function private.bi_notify_user(p_org uuid, p_user uuid, p_type text, p_title text, p_body text, p_resource_type text, p_resource_id uuid, p_dedupe text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.bi_notifications (organization_id, user_id, type, title, body, resource_type, resource_id, dedupe_key)
  select m.organization_id, m.user_id, p_type, p_title, p_body, p_resource_type, p_resource_id, p_dedupe
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = p_user
    and coalesce((select pr.enabled from public.bi_notification_prefs pr where pr.organization_id = m.organization_id and pr.user_id = m.user_id and pr.type = p_type), true)
  on conflict do nothing;
end $$;
create function private.bi_notify_roles(p_org uuid, p_roles public.org_role[], p_type text, p_title text, p_body text, p_resource_type text, p_resource_id uuid, p_dedupe text) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.bi_notifications (organization_id, user_id, type, title, body, resource_type, resource_id, dedupe_key)
  select m.organization_id, m.user_id, p_type, p_title, p_body, p_resource_type, p_resource_id, p_dedupe
  from public.organization_members m
  where m.organization_id = p_org and m.role = any (p_roles)
    and coalesce((select pr.enabled from public.bi_notification_prefs pr where pr.organization_id = m.organization_id and pr.user_id = m.user_id and pr.type = p_type), true)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.bi_notify_user(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function private.bi_notify_roles(uuid, public.org_role[], text, text, text, text, uuid, text) from public, anon, authenticated;

-- ======================================================================= updated_at e auditoria (só metadados)
do $$
declare t text;
begin
  foreach t in array array['bi_settings', 'datasets', 'metric_definitions', 'chart_definitions', 'dashboards', 'dashboard_widgets'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', 'upd_' || t, t);
  end loop;
  foreach t in array array['bi_settings', 'datasets', 'dataset_access', 'dimension_definitions', 'metric_definitions', 'chart_definitions', 'dashboards', 'dashboard_permissions', 'goal_definitions'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)',
      'audit_' || t, t, 'organization_id', case t when 'bi_settings' then 'organization_id' when 'dataset_access' then 'dataset_id' when 'dashboard_permissions' then 'dashboard_id' else 'id' end);
  end loop;
end $$;

-- ======================================================================= imutabilidade (vale até para o dono do schema)
create function private.bi_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro não pode ser apagado (histórico preservado): %', tg_table_name using errcode = '23514'; end $$;
create function private.bi_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro imutável: % (crie uma nova versão)', tg_table_name using errcode = '23514'; end $$;
revoke all on function private.bi_no_delete() from public, anon, authenticated;
revoke all on function private.bi_append_only() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['datasets', 'dataset_versions', 'dataset_columns', 'import_jobs', 'metric_definitions', 'chart_definitions', 'dashboards', 'goal_definitions', 'report_exports', 'data_refresh_events'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.bi_no_delete()', 'nodel_' || t, t);
  end loop;
  foreach t in array array['metric_versions', 'dashboard_versions', 'import_row_errors'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.bi_append_only()', 'append_' || t, t);
  end loop;
end $$;

-- Linhas importadas: nunca alteradas; só removidas por rotinas autorizadas (limpeza de staging e retenção), que ligam `bi.allow_row_delete`.
create function private.bi_rows_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then raise exception 'linhas importadas não podem ser alteradas' using errcode = '23514'; end if;
  if coalesce(current_setting('bi.allow_row_delete', true), '') <> 'on' then raise exception 'linhas importadas só são removidas pela política de retenção' using errcode = '23514'; end if;
  return old;
end $$;
revoke all on function private.bi_rows_guard() from public, anon, authenticated;
create trigger rows_guard before update or delete on public.dataset_rows for each row execute function private.bi_rows_guard();

-- Versão de dataset: depois de publicada, esquema e mapeamento são imutáveis; só status, retenção e estatísticas mudam.
create function private.bi_version_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'staging' and (new.schema_json is distinct from old.schema_json or new.mapping_json is distinct from old.mapping_json or new.dataset_id <> old.dataset_id
      or new.organization_id <> old.organization_id or new.version_number <> old.version_number) then
    raise exception 'versão de dataset publicada é imutável (esquema e mapeamento)' using errcode = '23514';
  end if;
  if old.status = 'published' and new.status not in ('published', 'superseded') then raise exception 'versão publicada só pode ser substituída' using errcode = '23514'; end if;
  if old.status in ('superseded', 'failed') and new.status <> old.status then raise exception 'versão encerrada não volta a ser usada' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function private.bi_version_guard() from public, anon, authenticated;
create trigger version_guard before update on public.dataset_versions for each row execute function private.bi_version_guard();

-- A organização dona de um registro nunca muda.
create function private.bi_org_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then raise exception 'a organização do registro não pode mudar' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function private.bi_org_immutable() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['datasets', 'dashboards', 'metric_definitions', 'chart_definitions', 'goal_definitions', 'dashboard_widgets'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.bi_org_immutable()', 'orgimm_' || t, t);
  end loop;
end $$;

commit;
