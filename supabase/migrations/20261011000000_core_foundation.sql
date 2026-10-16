-- Pack 25 Sistemas IA — CORE FOUNDATION
-- Multiempresa, papéis, RLS, auditoria imutável e solicitações de titulares (LGPD art. 18).
-- Premissas: Supabase (schema auth, roles anon/authenticated). Aplicável a banco limpo.
-- Princípios: negar por padrão; nenhuma função SECURITY DEFINER sem search_path fixo;
-- o cliente nunca escreve em audit_log; nada de PII em logs de auditoria.

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.org_role as enum ('owner', 'admin', 'manager', 'member', 'viewer');
create type public.privacy_request_type as enum ('confirmation', 'access', 'correction', 'anonymization_or_deletion', 'portability', 'sharing_info', 'consent_revocation');
create type public.privacy_request_status as enum ('open', 'in_progress', 'answered', 'rejected');

-- ---------------------------------------------------------------- utilidades
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- tabelas
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 120),
  logo_path text check (logo_path is null or (char_length(logo_path) <= 300 and logo_path !~ '(^/|\.\.|\\)')),
  theme jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object' and pg_column_size(theme) <= 4096),
  locale text not null default 'pt-BR',
  currency text not null default 'BRL',
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  changes jsonb,            -- somente nomes de colunas alteradas, nunca valores (minimização LGPD)
  created_at timestamptz not null default now()
);
create index audit_log_org_created_idx on public.audit_log(organization_id, created_at desc);

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_type public.privacy_request_type not null,
  subject_reference text not null check (char_length(subject_reference) between 1 and 200),
  status public.privacy_request_status not null default 'open',
  received_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '15 days'),  -- LGPD art. 19, II
  answered_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index privacy_requests_org_status_idx on public.privacy_requests(organization_id, status, due_at);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger organization_settings_updated_at before update on public.organization_settings
  for each row execute function private.set_updated_at();
create trigger privacy_requests_updated_at before update on public.privacy_requests
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------- helpers de autorização
-- SECURITY DEFINER é necessário para consultar organization_members sem recursão de RLS.
create function private.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create function private.has_role(org uuid, roles public.org_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

revoke all on function private.is_member(uuid) from public;
revoke all on function private.has_role(uuid, public.org_role[]) from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, public.org_role[]) to authenticated;

-- ---------------------------------------------------------------- auditoria
-- Registra apenas metadados (quem, o quê, quais colunas). Nunca valores.
create function private.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  org_col text := tg_argv[0];
  pk_col  text := tg_argv[1];
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  src jsonb := coalesce(new_j, old_j);
  cols jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into cols
    from jsonb_object_keys(new_j) k where new_j -> k is distinct from old_j -> k and k <> 'updated_at';
  end if;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes)
  values ((src ->> org_col)::uuid, (select auth.uid()), lower(tg_op), tg_table_name, src ->> pk_col,
          case when cols is not null then jsonb_build_object('columns', cols) end);
  return coalesce(new, old);
end $$;
revoke all on function private.audit_trigger() from public;

create trigger audit_organizations after insert or update or delete on public.organizations
  for each row execute function private.audit_trigger('id', 'id');
create trigger audit_members after insert or update or delete on public.organization_members
  for each row execute function private.audit_trigger('organization_id', 'user_id');
create trigger audit_settings after insert or update or delete on public.organization_settings
  for each row execute function private.audit_trigger('organization_id', 'organization_id');
create trigger audit_privacy_requests after insert or update or delete on public.privacy_requests
  for each row execute function private.audit_trigger('organization_id', 'id');

-- audit_log é append-only mesmo para o dono do schema.
create function private.block_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log é imutável' using errcode = '42501';
end $$;
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function private.block_audit_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.block_audit_mutation();

-- ---------------------------------------------------------------- regra do último owner
create function private.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Exclusão em cascata de uma organização inteira é permitida.
  if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    return coalesce(new, old);
  end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (
      select 1 from public.organization_members m
      where m.organization_id = old.organization_id and m.role = 'owner' and m.user_id <> old.user_id
    ) then
      raise exception 'a organização precisa manter ao menos um owner' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.protect_last_owner() from public;
revoke all on function private.block_audit_mutation() from public;
revoke all on function private.set_updated_at() from public;
create trigger members_protect_last_owner before update or delete on public.organization_members
  for each row execute function private.protect_last_owner();

-- ---------------------------------------------------------------- criação atômica de organização
create function public.create_organization(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  org uuid;
begin
  if uid is null then
    raise exception 'autenticação obrigatória' using errcode = '28000';
  end if;
  insert into public.organizations (name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into org;
  insert into public.organization_members (organization_id, user_id, role) values (org, uid, 'owner');
  insert into public.organization_settings (organization_id, display_name) values (org, trim(p_name));
  return org;
end $$;
revoke all on function public.create_organization(text, text) from public;
grant execute on function public.create_organization(text, text) to authenticated;

-- ---------------------------------------------------------------- RLS (negar por padrão)
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_settings enable row level security;
alter table public.audit_log enable row level security;
alter table public.privacy_requests enable row level security;
-- Sem FORCE RLS de propósito: o dono (role de migração) executa as funções SECURITY DEFINER
-- de autorização/auditoria. Clientes (anon/authenticated) nunca são donos das tabelas.

-- Privilégios mínimos por coluna: anon sem acesso; authenticated apenas o necessário.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
grant select on public.organizations to authenticated;
grant update (name, slug) on public.organizations to authenticated;
grant select, insert, delete on public.organization_members to authenticated;
grant update (role) on public.organization_members to authenticated;
grant select on public.organization_settings to authenticated;
grant update (display_name, logo_path, theme, locale, currency) on public.organization_settings to authenticated;
grant select on public.audit_log to authenticated;
grant select on public.privacy_requests to authenticated;
grant insert (organization_id, request_type, subject_reference, notes) on public.privacy_requests to authenticated;
grant update (status, notes, answered_at) on public.privacy_requests to authenticated;

-- organizations: sem INSERT/DELETE direto (use create_organization).
create policy organizations_select on public.organizations for select to authenticated
  using (private.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_role(id, array['owner','admin']::public.org_role[]))
  with check (private.has_role(id, array['owner','admin']::public.org_role[]));

-- membros: todos veem a equipe; admin gerencia; só owner cria/promove owner.
create policy members_select on public.organization_members for select to authenticated
  using (private.is_member(organization_id));
create policy members_insert on public.organization_members for insert to authenticated
  with check (
    private.has_role(organization_id, array['owner','admin']::public.org_role[])
    and (role <> 'owner' or private.has_role(organization_id, array['owner']::public.org_role[]))
  );
create policy members_update on public.organization_members for update to authenticated
  using (
    private.has_role(organization_id, array['owner','admin']::public.org_role[])
    and (role <> 'owner' or private.has_role(organization_id, array['owner']::public.org_role[]))
  )
  with check (
    private.has_role(organization_id, array['owner','admin']::public.org_role[])
    and (role <> 'owner' or private.has_role(organization_id, array['owner']::public.org_role[]))
  );
create policy members_delete on public.organization_members for delete to authenticated
  using (
    private.has_role(organization_id, array['owner','admin']::public.org_role[])
    and (role <> 'owner' or private.has_role(organization_id, array['owner']::public.org_role[]))
  );

create policy settings_select on public.organization_settings for select to authenticated
  using (private.is_member(organization_id));
create policy settings_update on public.organization_settings for update to authenticated
  using (private.has_role(organization_id, array['owner','admin']::public.org_role[]))
  with check (private.has_role(organization_id, array['owner','admin']::public.org_role[]));

-- audit_log: leitura só para owner/admin; nenhuma política de escrita (triggers escrevem).
create policy audit_select on public.audit_log for select to authenticated
  using (private.has_role(organization_id, array['owner','admin']::public.org_role[]));

-- solicitações de titulares: owner/admin/manager operam; demais não veem.
create policy privacy_select on public.privacy_requests for select to authenticated
  using (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]));
create policy privacy_insert on public.privacy_requests for insert to authenticated
  with check (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]));
create policy privacy_update on public.privacy_requests for update to authenticated
  using (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]))
  with check (private.has_role(organization_id, array['owner','admin','manager']::public.org_role[]));

commit;
