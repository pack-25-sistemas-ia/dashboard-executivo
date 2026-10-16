-- Garante que o SQL documentado em docs/MEMBROS.md funciona (executado como administrador do banco,
-- como no SQL Editor do Supabase) e que a ação fica na auditoria.
\set as_a 'select set_config(''request.jwt.claims'', ''{"sub":"dddddddd-0000-4000-8000-00000000000a","aal":"aal2"}'', true); set local role authenticated;'

begin;
insert into auth.users (id, email) values
  ('dddddddd-0000-4000-8000-00000000000a', 'dono@membros.invalid'),
  ('dddddddd-0000-4000-8000-00000000000b', 'Vendedor@Membros.Invalid');

:as_a
do $$ begin perform public.create_organization('Loja da Maria', 'loja-da-maria'); end $$;
reset role;

-- >>> SQL EXATO da documentação (trocar slug, e-mail e papel)
insert into public.organization_members (organization_id, user_id, role)
select o.id, u.id, 'member'
from public.organizations o
join auth.users u on lower(u.email) = lower('vendedor@membros.invalid')
where o.slug = 'loja-da-maria';
-- <<<

do $$
begin
  assert (select count(*) from public.organization_members m join public.organizations o on o.id = m.organization_id
          where o.slug = 'loja-da-maria') = 2, 'membro associado pelo SQL documentado';
  assert exists (select 1 from public.audit_log where entity = 'organization_members' and action = 'insert'
                 and entity_id = 'dddddddd-0000-4000-8000-00000000000b'), 'associação registrada na auditoria';
  raise notice 'PASS: SQL de adicionar membro (docs/MEMBROS.md) funciona e é auditado';
end $$;
rollback;
