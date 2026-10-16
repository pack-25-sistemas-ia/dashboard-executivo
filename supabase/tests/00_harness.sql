-- HARNESS DE TESTE — NÃO é migração e NUNCA deve ser aplicado em banco real.
-- Emula o mínimo do Supabase (schema auth, roles anon/authenticated, GUC de JWT)
-- para validar a migração do Core num Postgres puro. Em Supabase real, tudo isto já existe.

create role anon nologin;
create role authenticated nologin;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Supabase concede privilégios amplos por padrão em public; reproduzimos para provar que a migração os revoga.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- Utilitários de asserção (executam como o usuário corrente, logo sob RLS).
create schema test;
create table test.org (name text primary key, id uuid not null);

create function test.throws(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;

create function test.affected(q text) returns bigint language plpgsql as $$
declare n bigint;
begin execute q; get diagnostics n = row_count; return n; end $$;

create function test.count(q text) returns bigint language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from (' || q || ') s' into n; return n; end $$;

grant usage on schema test to anon, authenticated;
grant select on test.org to anon, authenticated;
grant execute on all functions in schema test to anon, authenticated;
