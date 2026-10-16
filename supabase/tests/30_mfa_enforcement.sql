-- MFA no banco: owner/admin só escrevem (e leem dados sensíveis) com sessão AAL2.
-- Usuários: A (owner org A), C (viewer org A), D (admin org A).

\set a1 'select set_config(''request.jwt.claims'', ''{"sub":"cccccccc-0000-4000-8000-00000000000a","aal":"aal1"}'', true); set local role authenticated;'
\set a2 'select set_config(''request.jwt.claims'', ''{"sub":"cccccccc-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'
\set d1 'select set_config(''request.jwt.claims'', ''{"sub":"cccccccc-0000-4000-8000-00000000000d","aal":"aal1"}'', true); set local role authenticated;'
\set c1 'select set_config(''request.jwt.claims'', ''{"sub":"cccccccc-0000-4000-8000-00000000000c","aal":"aal1"}'', true); set local role authenticated;'

begin;

insert into auth.users (id, email) values
  ('cccccccc-0000-4000-8000-00000000000a', 'a@mfa.invalid'),
  ('cccccccc-0000-4000-8000-00000000000c', 'c@mfa.invalid'),
  ('cccccccc-0000-4000-8000-00000000000d', 'd@mfa.invalid');

:a2
do $$ begin perform public.create_organization('MFA A', 'mfa-a'); end $$;
reset role;
insert into test.org select 'ma', id from public.organizations where slug = 'mfa-a';

:a2
do $$
declare a uuid := (select id from test.org where name = 'ma');
begin
  insert into public.organization_members (organization_id, user_id, role) values
    (a, 'cccccccc-0000-4000-8000-00000000000c', 'viewer'),
    (a, 'cccccccc-0000-4000-8000-00000000000d', 'admin');
  assert test.affected(format($q$update public.organization_settings set display_name = 'Com MFA' where organization_id = %L$q$, a)) = 1, 'owner AAL2 escreve';
  raise notice 'PASS: owner com AAL2 escreve normalmente';
end $$;
reset role;

-- Owner em AAL1 (sem segundo fator): leitura básica funciona; escrita e dados sensíveis, não.
:a1
do $$
declare a uuid := (select id from test.org where name = 'ma');
begin
  assert (select count(*) from public.organization_members where user_id = 'cccccccc-0000-4000-8000-00000000000a') = 1, 'owner AAL1 ainda lê a própria associação (para ser redirecionado ao MFA)';
  assert (select count(*) from public.organizations) = 1, 'owner AAL1 lê a organização';
  assert test.affected(format($q$update public.organization_settings set display_name = 'Sem MFA' where organization_id = %L$q$, a)) = 0, 'owner AAL1 NÃO altera configurações';
  assert test.affected(format($q$update public.organization_members set role = 'admin' where organization_id = %L and user_id = 'cccccccc-0000-4000-8000-00000000000c'$q$, a)) = 0, 'owner AAL1 NÃO altera papéis';
  assert test.affected(format($q$delete from public.organization_members where organization_id = %L and user_id = 'cccccccc-0000-4000-8000-00000000000c'$q$, a)) = 0, 'owner AAL1 NÃO remove membros';
  assert test.count('select 1 from public.audit_log') = 0, 'owner AAL1 NÃO lê auditoria';
  assert test.throws(format($q$insert into public.privacy_requests (organization_id, request_type, subject_reference) values (%L, 'access', 'x')$q$, a)), 'owner AAL1 NÃO cria solicitação LGPD';
  assert test.count('select 1 from public.privacy_requests') = 0, 'owner AAL1 NÃO lê solicitações LGPD';
  raise notice 'PASS: owner sem AAL2 é barrado no banco (escrita e leitura sensível)';
end $$;
reset role;

:d1
do $$
declare a uuid := (select id from test.org where name = 'ma');
begin
  assert test.affected(format($q$update public.organization_settings set display_name = 'Admin sem MFA' where organization_id = %L$q$, a)) = 0, 'admin AAL1 NÃO altera configurações';
  assert test.count('select 1 from public.audit_log') = 0, 'admin AAL1 NÃO lê auditoria';
  assert test.affected($q$update public.profiles set full_name = 'x' where id = 'cccccccc-0000-4000-8000-00000000000d'$q$) = 0, 'admin AAL1 NÃO edita o perfil';
  raise notice 'PASS: admin sem AAL2 é barrado no banco';
end $$;
reset role;

-- Não-admin não é afetado pela regra.
:c1
do $$
begin
  assert (select count(*) from public.organizations) = 1, 'viewer AAL1 lê a organização';
  assert test.affected($q$update public.profiles set full_name = 'Leitor' where id = 'cccccccc-0000-4000-8000-00000000000c'$q$) = 1, 'viewer AAL1 edita o próprio perfil (não é admin)';
  raise notice 'PASS: quem não é owner/admin não precisa de AAL2';
end $$;
reset role;

-- A política é restritiva: não amplia acesso (viewer AAL2 continua sem ver a auditoria).
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-00000000000c","aal":"aal2"}', true);
set local role authenticated;
do $$
begin
  assert test.count('select 1 from public.audit_log') = 0, 'AAL2 sozinho não concede acesso à auditoria';
  raise notice 'PASS: política restritiva não amplia acesso';
end $$;
reset role;

rollback;
