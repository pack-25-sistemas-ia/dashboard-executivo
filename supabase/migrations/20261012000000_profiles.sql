-- Pack 25 Sistemas IA — PROFILES
-- Perfil mínimo por usuário (e-mail + nome opcional), sincronizado de auth.users.
-- Privacidade: o e-mail de um usuário só é visível a ele mesmo e a owner/admin de uma
-- organização da qual ele participa (minimização, LGPD art. 6º, III).

begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '' check (char_length(email) <= 254),
  full_name text check (full_name is null or char_length(full_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- True quando o usuário corrente é owner/admin de alguma organização em que `other` é membro.
create function private.admin_sees_user(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members me
    join public.organization_members them on them.organization_id = me.organization_id
    where me.user_id = (select auth.uid())
      and me.role in ('owner', 'admin')
      and them.user_id = other
  );
$$;
revoke all on function private.admin_sees_user(uuid) from public;
grant execute on function private.admin_sees_user(uuid) to authenticated;

-- Sincronização a partir de auth.users (inclusão e troca de e-mail).
create function private.sync_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
revoke all on function private.sync_profile() from public;

create trigger on_auth_user_sync after insert or update of email on auth.users
  for each row execute function private.sync_profile();

insert into public.profiles (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

-- Cada migração revoga e concede explicitamente: o Supabase concede privilégios amplos
-- por padrão a tabelas novas em public (ver teste de higiene em 20_profiles.sql).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.admin_sees_user(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

commit;
