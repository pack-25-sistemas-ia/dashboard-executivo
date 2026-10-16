import Link from 'next/link';
import { signOut } from '@/app/(auth)/actions';
import { switchOrganization } from '@/app/(app)/actions';
import { NavLink } from '@/components/ui/client';
import { Button, Select } from '@/components/ui/primitives';
import { requireContext } from '@/lib/auth/session';
import { systemConfig } from '@/lib/system.config';
import { themeParam } from '@/lib/theme';
import { safePrimary } from '@/lib/utils';
import { countUnread } from '@/lib/bi/data';
import { FlashHost } from '@/components/bi/flash';
import { isAdminRole, isPrivacyRole, ROLE_LABELS } from '@/lib/validation/org';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const { role, organization_id } = ctx.membership;

  const { data: settings } = await ctx.supabase
    .from('organization_settings')
    .select('display_name, theme')
    .eq('organization_id', organization_id)
    .maybeSingle();
  const primary = safePrimary((settings?.theme as { primary?: unknown } | null)?.primary);
  const { data: bi } = await ctx.supabase.from('bi_settings').select('portal_name').eq('organization_id', organization_id).maybeSingle();
  const displayName = (bi as { portal_name?: string | null } | null)?.portal_name || (settings?.display_name as string | undefined) || ctx.membership.name;

  const unread = await countUnread(ctx);
  const nav = [
    ...systemConfig.primaryNav.map((i) => ({ ...i, show: !i.roles || i.roles.includes(role) })),
    { href: '/members', label: 'Equipe', show: true },
    { href: '/privacy', label: 'Privacidade (LGPD)', show: isPrivacyRole(role) },
    { href: '/audit', label: 'Auditoria', show: isAdminRole(role) },
    { href: '/settings', label: 'Configurações', show: isAdminRole(role) },
  ].filter((i) => i.show);

  const links = (
    <nav aria-label="Principal" className="flex flex-col gap-1">
      {nav.map((i) => (
        <NavLink key={i.href} href={i.href}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <>
      {/* Tema da organização como folha de estilo do próprio domínio (ver lib/theme.ts): funciona em qualquer navegação sob a CSP. */}
      <link rel="stylesheet" href={`/theme.css?c=${themeParam(primary)}`} precedence="theme" />
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2 print:hidden">
        Ir para o conteúdo
      </a>
      <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr] print:block">
        <aside className="hidden border-r border-border bg-card p-4 md:block print:hidden">
          <Link href="/inicio" className="mb-6 flex items-center gap-2 px-3 text-base font-semibold">
            {/* Logotipo trocável: substitua public/brand/logo.svg (ou ajuste lib/system.config.ts). */}
            {/* <img> e não next/image: o next/image injeta style="color:transparent", bloqueado pela CSP estrita. É um SVG estático. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={systemConfig.logo} alt="" width={28} height={28} className="size-7 shrink-0 rounded" />
            <span className="truncate">{displayName}</span>
          </Link>
          {links}
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-3 sm:gap-3 sm:px-4 print:hidden">
            <details className="relative md:hidden">
              <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-md border border-border px-3 text-sm font-medium">Menu</summary>
              <div className="absolute left-0 top-12 z-40 w-64 rounded-lg border border-border bg-card p-3 shadow-lg">{links}</div>
            </details>

            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              {ctx.memberships.length > 1 ? (
                <form action={switchOrganization} className="flex items-center gap-2">
                  <label htmlFor="organization_id" className="sr-only">Organização</label>
                  <Select id="organization_id" name="organization_id" defaultValue={organization_id} className="w-36 sm:w-52">
                    {ctx.memberships.map((m) => (
                      <option key={m.organization_id} value={m.organization_id}>{m.name}</option>
                    ))}
                  </Select>
                  <Button type="submit" variant="secondary">Trocar</Button>
                </form>
              ) : (
                <span className="truncate text-sm font-medium">{ctx.membership.name}</span>
              )}
              <span className="hidden rounded-full border border-border px-2 py-0.5 text-xs text-muted sm:inline-flex">{ROLE_LABELS[role]}</span>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <Link href="/notificacoes" className="relative inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5" aria-label={unread > 0 ? `Notificações: ${unread} não lida(s)` : 'Notificações'}>
                Avisos{unread > 0 ? <span className="ml-1.5 rounded-full bg-danger px-1.5 text-xs font-semibold text-white">{unread > 99 ? '99+' : unread}</span> : null}
              </Link>
              <span className="hidden max-w-56 truncate text-sm text-muted sm:block">{ctx.user.email}</span>
              <form action={signOut}>
                <Button type="submit" variant="secondary">Sair</Button>
              </form>
            </div>
          </header>

          <FlashHost />
          <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
