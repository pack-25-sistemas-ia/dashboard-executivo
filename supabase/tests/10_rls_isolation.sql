-- Testes de isolamento multiempresa, papéis, auditoria e privilégios do Core.
-- Cada falha lança exceção (ON_ERROR_STOP). Cada bloco emite "PASS:" ao concluir.
-- Usuários: A (owner org A), B (owner org B), C viewer, D admin, E manager, F extra (todos na org A).

\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set as_b 'select set_config(''request.jwt.claims'', ''{"sub":"aaaaaaaa-0000-4000-8000-00000000000b","aal":"aal2"}'', true); set local role authenticated;'
\set as_c 'select set_config(''request.jwt.claims'', ''{"sub":"aaaaaaaa-0000-4000-8000-00000000000c","aal":"aal2"}'', true); set local role authenticated;'
\set as_d 'select set_config(''request.jwt.claims'', ''{"sub":"aaaaaaaa-0000-4000-8000-00000000000d","aal":"aal2"}'', true); set local role authenticated;'
\set as_e 'select set_config(''request.jwt.claims'', ''{"sub":"aaaaaaaa-0000-4000-8000-00000000000e","aal":"aal2"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'
\set as_nouid 'select set_config(''request.jwt.claims'', ''{}'', true); set local role authenticated;'

begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'a@teste.invalid'),
  ('aaaaaaaa-0000-4000-8000-00000000000b', 'b@teste.invalid'),
  ('aaaaaaaa-0000-4000-8000-00000000000c', 'c@teste.invalid'),
  ('aaaaaaaa-0000-4000-8000-00000000000d', 'd@teste.invalid'),
  ('aaaaaaaa-0000-4000-8000-00000000000e', 'e@teste.invalid'),
  ('aaaaaaaa-0000-4000-8000-00000000000f', 'f@teste.invalid');

-- ================= criação das organizações =================
:as_a
do $$ begin perform public.create_organization('Org A', 'org-a'); end $$;
reset role;
:as_b
do $$ begin perform public.create_organization('Org B', 'org-b'); end $$;
reset role;
insert into test.org select 'a', id from public.organizations where slug = 'org-a';
insert into test.org select 'b', id from public.organizations where slug = 'org-b';

-- A monta a equipe da org A
:as_a
do $$
declare a uuid := (select id from test.org where name = 'a');
begin
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'aaaaaaaa-0000-4000-8000-00000000000c', 'viewer'),
    (a, 'aaaaaaaa-0000-4000-8000-00000000000d', 'admin'),
    (a, 'aaaaaaaa-0000-4000-8000-00000000000e', 'manager');
  raise notice 'PASS: owner adiciona viewer, admin e manager';
end $$;
reset role;

-- ================= 1. isolamento A x B (owner) =================
:as_a
do $$
declare
  a uuid := (select id from test.org where name = 'a');
  b uuid := (select id from test.org where name = 'b');
begin
  assert (select count(*) from public.organizations) = 1, 'A deve ver só a própria organização';
  assert (select count(*) from public.organization_settings) = 1, 'A vê só as próprias configurações';
  assert test.count(format('select 1 from public.organization_members where organization_id = %L', b)) = 0, 'A não lê membros de B';
  assert test.count(format('select 1 from public.audit_log where organization_id = %L', b)) = 0, 'A não lê auditoria de B';
  assert test.throws(format($q$insert into public.organization_members (organization_id, user_id, role) values (%L, 'aaaaaaaa-0000-4000-8000-00000000000f', 'viewer')$q$, b)), 'A não insere membro em B';
  assert test.affected(format($q$update public.organizations set name = 'hack' where id = %L$q$, b)) = 0, 'A não altera org B';
  assert test.affected(format($q$update public.organization_settings set display_name = 'hack' where organization_id = %L$q$, b)) = 0, 'A não altera config de B';
  assert test.affected(format('delete from public.organization_members where organization_id = %L', b)) = 0, 'A não remove membros de B';
  assert test.throws(format($q$insert into public.privacy_requests (organization_id, request_type, subject_reference) values (%L, 'access', 'x')$q$, b)), 'A não cria solicitação em B';
  raise notice 'PASS: isolamento A x B (SELECT/INSERT/UPDATE/DELETE negados)';
end $$;
reset role;

:as_b
do $$
declare a uuid := (select id from test.org where name = 'a');
begin
  assert (select count(*) from public.organizations) = 1, 'B deve ver só a própria organização';
  assert test.count(format('select 1 from public.organization_members where organization_id = %L', a)) = 0, 'B não lê membros de A';
  assert test.affected(format($q$update public.organizations set name = 'hack' where id = %L$q$, a)) = 0, 'B não altera org A';
  raise notice 'PASS: isolamento B x A';
end $$;
reset role;

-- ================= 2. anon e usuário sem uid =================
:as_anon
do $$
begin
  assert test.throws('select * from public.organizations'), 'anon não lê organizations';
  assert test.throws('select * from public.audit_log'), 'anon não lê audit_log';
  assert test.throws($q$select public.create_organization('Anon Org', 'anon-org')$q$), 'anon não cria organização';
  raise notice 'PASS: anon sem acesso';
end $$;
reset role;

:as_nouid
do $$
begin
  assert test.throws($q$select public.create_organization('Sem Uid', 'sem-uid')$q$), 'sem auth.uid() não cria organização';
  assert test.count('select 1 from public.organizations') = 0, 'sem uid não enxerga nada';
  raise notice 'PASS: authenticated sem uid não cria nem lê';
end $$;
reset role;

-- ================= 3. privilégios e colunas =================
:as_a
do $$
declare a uuid := (select id from test.org where name = 'a'); b uuid := (select id from test.org where name = 'b');
begin
  assert test.throws($q$insert into public.organizations (name, slug) values ('Direta', 'direta')$q$), 'sem INSERT direto em organizations';
  assert test.throws('delete from public.organizations'), 'sem DELETE em organizations';
  assert test.throws(format($q$update public.organizations set id = %L where id = %L$q$, gen_random_uuid(), a)), 'id de organização é imutável (grant por coluna)';
  assert test.throws(format($q$update public.organization_members set organization_id = %L where organization_id = %L$q$, b, a)), 'membro não migra de organização';
  assert test.throws($q$select public.create_organization('Duplicada', 'org-a')$q$), 'slug único';
  assert test.throws($q$select public.create_organization('Slug Ruim', 'SLUG RUIM!')$q$), 'slug validado';
  raise notice 'PASS: privilégios mínimos e colunas imutáveis';
end $$;
reset role;

-- ================= 4. último owner =================
:as_a
do $$
declare a uuid := (select id from test.org where name = 'a');
begin
  assert test.throws(format($q$delete from public.organization_members where organization_id = %L and user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'$q$, a)), 'último owner não pode sair';
  assert test.throws(format($q$update public.organization_members set role = 'viewer' where organization_id = %L and user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'$q$, a)), 'último owner não pode ser rebaixado';
  raise notice 'PASS: proteção do último owner';
end $$;
reset role;

-- ================= 5. papéis na org A =================
:as_c
do $$
declare a uuid := (select id from test.org where name = 'a');
begin
  assert (select count(*) from public.organizations) = 1, 'viewer vê a organização';
  assert test.count('select 1 from public.audit_log') = 0, 'viewer não lê auditoria';
  assert test.count('select 1 from public.privacy_requests') = 0, 'viewer não lê solicitações LGPD';
  assert test.affected(format($q$update public.organization_settings set display_name = 'x' where organization_id = %L$q$, a)) = 0, 'viewer não altera configurações';
  assert test.throws(format($q$insert into public.organization_members (organization_id, user_id, role) values (%L, 'aaaaaaaa-0000-4000-8000-00000000000f', 'viewer')$q$, a)), 'viewer não convida';
  assert test.affected(format($q$update public.organization_members set role = 'owner' where organization_id = %L and user_id = 'aaaaaaaa-0000-4000-8000-00000000000c'$q$, a)) = 0, 'viewer não se promove';
  assert test.throws(format($q$insert into public.privacy_requests (organization_id, request_type, subject_reference) values (%L, 'access', 'x')$q$, a)), 'viewer não cria solicitação LGPD';
  raise notice 'PASS: viewer somente leitura';
end $$;
reset role;

:as_d
do $$
declare a uuid := (select id from test.org where name = 'a');
begin
  assert test.throws(format($q$insert into public.organization_members (organization_id, user_id, role) values (%L, 'aaaaaaaa-0000-4000-8000-00000000000f', 'owner')$q$, a)), 'admin não cria owner';
  assert test.throws(format($q$update public.organization_members set role = 'owner' where organization_id = %L and user_id = 'aaaaaaaa-0000-4000-8000-00000000000d'$q$, a)), 'admin não se promove a owner';
  assert test.affected(format($q$update public.organization_members set role = 'viewer' where organization_id = %L and user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'$q$, a)) = 0, 'admin não rebaixa owner';
  assert test.affected(format($q$delete from public.organization_members where organization_id = %L and user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'$q$, a)) = 0, 'admin não remove owner';
  assert not test.throws(format($q$insert into public.organization_members (organization_id, user_id, role) values (%L, 'aaaaaaaa-0000-4000-8000-00000000000f', 'member')$q$, a)), 'admin convida membro';
  assert test.affected(format($q$update public.organization_settings set display_name = 'Nome Secreto XYZ' where organization_id = %L$q$, a)) = 1, 'admin altera configurações';
  assert test.count('select 1 from public.audit_log') > 0, 'admin lê auditoria';
  raise notice 'PASS: admin gerencia sem escalar para owner';
end $$;
reset role;

:as_e
do $$
declare a uuid := (select id from test.org where name = 'a');
begin
  assert test.count('select 1 from public.audit_log') = 0, 'manager não lê auditoria';
  assert not test.throws(format($q$insert into public.privacy_requests (organization_id, request_type, subject_reference) values (%L, 'access', 'titular-123')$q$, a)), 'manager registra solicitação LGPD';
  assert test.count('select 1 from public.privacy_requests') = 1, 'manager lê solicitações da própria org';
  assert test.affected($q$update public.privacy_requests set status = 'in_progress'$q$) = 1, 'manager atualiza status';
  assert test.throws($q$update public.privacy_requests set due_at = now() + interval '999 days'$q$), 'prazo legal não é editável pelo cliente';
  raise notice 'PASS: manager opera solicitações LGPD, sem ver auditoria';
end $$;
reset role;

:as_b
do $$
begin
  assert test.count('select 1 from public.privacy_requests') = 0, 'B não lê solicitações LGPD de A';
  raise notice 'PASS: solicitações LGPD isoladas por organização';
end $$;
reset role;

-- ================= 6. auditoria =================
do $$
begin
  assert exists (select 1 from public.audit_log where entity = 'organizations' and action = 'insert'), 'criação de org auditada';
  assert exists (select 1 from public.audit_log where entity = 'organization_settings' and action = 'update' and changes -> 'columns' ? 'display_name'), 'alteração auditada com nome da coluna';
  assert not exists (select 1 from public.audit_log where changes::text like '%Secreto%'), 'auditoria NÃO guarda valores (minimização LGPD)';
  assert test.throws($q$update public.audit_log set action = 'x'$q$), 'audit_log imutável (UPDATE) até para o dono';
  assert test.throws('delete from public.audit_log'), 'audit_log imutável (DELETE) até para o dono';
  assert test.throws('truncate public.audit_log'), 'audit_log imutável (TRUNCATE)';
  raise notice 'PASS: auditoria imutável e sem PII';
end $$;

:as_a
do $$
begin
  assert test.throws($q$update public.audit_log set action = 'x'$q$), 'authenticated não atualiza audit_log';
  assert test.throws('delete from public.audit_log'), 'authenticated não apaga audit_log';
  assert test.throws($q$insert into public.audit_log (organization_id, action, entity) values (gen_random_uuid(), 'forjado', 'x')$q$), 'authenticated não forja auditoria';
  raise notice 'PASS: cliente não escreve em audit_log';
end $$;
reset role;

-- ================= 7. higiene estrutural (vale para todo sistema) =================
do $$
declare bad text;
begin
  select string_agg(tablename, ', ') into bad from pg_tables where schemaname = 'public' and not rowsecurity;
  assert bad is null, 'tabelas em public sem RLS: ' || coalesce(bad, '');

  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  assert bad is null, 'SECURITY DEFINER sem search_path fixo: ' || coalesce(bad, '');

  assert not has_table_privilege('anon', 'public.organizations', 'select'), 'anon sem privilégio de tabela';
  assert not has_function_privilege('anon', 'public.create_organization(text,text)', 'execute'), 'anon sem EXECUTE em create_organization';
  raise notice 'PASS: toda tabela com RLS; SECURITY DEFINER com search_path; anon sem privilégios';
end $$;

rollback;
