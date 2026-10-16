-- Pack 25 Sistemas IA — MFA obrigatório no BANCO para owner/admin
-- Sem isto, quem tivesse a senha de um administrador poderia chamar a API REST do Supabase diretamente
-- e escrever sem segundo fator (o app exige MFA, mas o app não é a única porta de entrada).
-- Regra: quem é owner/admin em QUALQUER organização precisa de sessão AAL2 para escrever,
-- e para ler dados sensíveis (auditoria e solicitações de titulares).
-- A leitura de associações/perfil próprios segue liberada em AAL1 para o app saber para onde redirecionar (cadastro de MFA).

begin;

create function private.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
      or not exists (
        select 1 from public.organization_members m
        where m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
      );
$$;
revoke all on function private.mfa_ok() from public;
grant execute on function private.mfa_ok() to authenticated;

-- Políticas RESTRICTIVE são combinadas com AND às permissivas: só podem restringir, nunca ampliar.
do $$
declare t text;
begin
  foreach t in array array['organizations', 'organization_members', 'organization_settings', 'privacy_requests', 'profiles']
  loop
    execute format('create policy mfa_insert on public.%I as restrictive for insert to authenticated with check (private.mfa_ok())', t);
    execute format('create policy mfa_update on public.%I as restrictive for update to authenticated using (private.mfa_ok()) with check (private.mfa_ok())', t);
    execute format('create policy mfa_delete on public.%I as restrictive for delete to authenticated using (private.mfa_ok())', t);
  end loop;
end $$;

-- Leitura sensível exige AAL2 para administradores.
create policy mfa_select on public.audit_log as restrictive for select to authenticated using (private.mfa_ok());
create policy mfa_select on public.privacy_requests as restrictive for select to authenticated using (private.mfa_ok());

commit;
