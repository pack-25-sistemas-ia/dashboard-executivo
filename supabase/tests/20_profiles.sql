-- Testes de perfis: sincronização, visibilidade mínima de e-mail e higiene de privilégios.
-- Usuários: A (owner org A), B (owner org B), C (viewer org A), D (admin org A).

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"bbbbbbbb-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'
\set as_c 'select set_config(''request.jwt.claims'', ''{"sub":"bbbbbbbb-0000-4000-8000-00000000000c","aal":"aal2"}'', true); set local role authenticated;'
\set as_d 'select set_config(''request.jwt.claims'', ''{"sub":"bbbbbbbb-0000-4000-8000-00000000000d","aal":"aal2"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

insert into auth.users (id, email) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'a@perfil.invalid'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'b@perfil.invalid'),
  ('bbbbbbbb-0000-4000-8000-00000000000c', 'c@perfil.invalid'),
  ('bbbbbbbb-0000-4000-8000-00000000000d', 'd@perfil.invalid');

do $$
begin
  assert (select count(*) from public.profiles where email like '%@perfil.invalid') = 4, 'perfil criado automaticamente por usuário';
  update auth.users set email = 'a2@perfil.invalid' where id = 'bbbbbbbb-0000-4000-8000-00000000000a';
  assert (select email from public.profiles where id = 'bbbbbbbb-0000-4000-8000-00000000000a') = 'a2@perfil.invalid', 'troca de e-mail sincroniza';
  raise notice 'PASS: perfis sincronizados com auth.users';
end $$;

:as_a
do $$ begin perform public.create_organization('Perfil A', 'perfil-a'); end $$;
reset role;
:as_b
do $$ begin perform public.create_organization('Perfil B', 'perfil-b'); end $$;
reset role;
insert into test.org select 'pa', id from public.organizations where slug = 'perfil-a';
insert into test.org select 'pb', id from public.organizations where slug = 'perfil-b';

:as_a
do $$
declare a uuid := (select id from test.org where name = 'pa');
begin
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'bbbbbbbb-0000-4000-8000-00000000000c', 'viewer'),
    (a, 'bbbbbbbb-0000-4000-8000-00000000000d', 'admin');
end $$;
reset role;

:as_a
do $$
begin
  assert test.count($q$select 1 from public.profiles where id = 'bbbbbbbb-0000-4000-8000-00000000000c'$q$) = 1, 'owner vê o perfil de membro da própria org';
  assert test.count($q$select 1 from public.profiles where id = 'bbbbbbbb-0000-4000-8000-00000000000b'$q$) = 0, 'owner NÃO vê perfil de outra organização';
  assert test.affected($q$update public.profiles set full_name = 'Dono A' where id = 'bbbbbbbb-0000-4000-8000-00000000000a'$q$) = 1, 'usuário edita o próprio nome';
  assert test.affected($q$update public.profiles set full_name = 'Hack' where id = 'bbbbbbbb-0000-4000-8000-00000000000c'$q$) = 0, 'owner não edita perfil alheio';
  assert test.throws($q$update public.profiles set email = 'x@x.invalid' where id = 'bbbbbbbb-0000-4000-8000-00000000000a'$q$), 'e-mail do perfil não é editável pelo cliente';
  assert test.throws($q$insert into public.profiles (id, email) values (gen_random_uuid(), 'forjado@x.invalid')$q$), 'cliente não cria perfil';
  assert test.throws('delete from public.profiles'), 'cliente não apaga perfil';
  raise notice 'PASS: owner/admin veem só perfis da própria organização';
end $$;
reset role;

:as_c
do $$
begin
  assert (select count(*) from public.profiles) = 1, 'viewer vê apenas o próprio perfil';
  assert test.count($q$select 1 from public.profiles where id = 'bbbbbbbb-0000-4000-8000-00000000000a'$q$) = 0, 'viewer NÃO vê e-mail do owner';
  raise notice 'PASS: não-admin vê só o próprio perfil (minimização)';
end $$;
reset role;

:as_d
do $$
begin
  assert test.count($q$select 1 from public.profiles where id = 'bbbbbbbb-0000-4000-8000-00000000000c'$q$) = 1, 'admin vê perfil de membro';
  assert test.count($q$select 1 from public.profiles where id = 'bbbbbbbb-0000-4000-8000-00000000000b'$q$) = 0, 'admin não vê perfil de outra org';
  raise notice 'PASS: admin vê perfis da própria organização';
end $$;
reset role;

:as_anon
do $$
begin
  assert test.throws('select * from public.profiles'), 'anon não lê perfis';
  raise notice 'PASS: anon sem acesso a perfis';
end $$;
reset role;

-- Higiene para TODAS as tabelas de public, atuais e futuras: anon nunca tem privilégio de tabela.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
    and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger');
  assert bad is null, 'anon com privilégio em: ' || coalesce(bad, '');

  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and (has_table_privilege('authenticated', c.oid, 'truncate') or has_table_privilege('authenticated', c.oid, 'references') or has_table_privilege('authenticated', c.oid, 'trigger'));
  assert bad is null, 'authenticated com TRUNCATE/REFERENCES/TRIGGER em: ' || coalesce(bad, '');

  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef
    and has_function_privilege('anon', p.oid, 'execute')
    -- Exceção explícita e documentada: endpoints públicos (ex.: link de proposta, formulário público) levam o
    -- comentário 'PUBLIC_ENDPOINT: ...' e têm testes próprios no sistema que os cria.
    and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'PUBLIC_ENDPOINT:%';
  assert bad is null, 'anon pode executar SECURITY DEFINER sem marca PUBLIC_ENDPOINT: ' || coalesce(bad, '');

  select string_agg(tablename, ', ') into bad from pg_tables where schemaname = 'public' and not rowsecurity;
  assert bad is null, 'tabelas sem RLS: ' || coalesce(bad, '');
  raise notice 'PASS: higiene global (anon sem privilégios, sem TRUNCATE/REFERENCES/TRIGGER, RLS em tudo)';
end $$;

rollback;
