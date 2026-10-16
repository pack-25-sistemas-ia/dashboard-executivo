import type { Metadata } from 'next';
import { MemberActions } from '@/components/forms/org-forms';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { requireContext } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/utils';
import { isAdminRole, ORG_ROLES, ROLE_LABELS, type OrgRole } from '@/lib/validation/org';

export const metadata: Metadata = { title: 'Equipe' };

type MemberRow = { user_id: string; role: string; created_at: string };
type ProfileRow = { id: string; email: string; full_name: string | null };

export default async function MembersPage() {
  const ctx = await requireContext();
  const org = ctx.membership.organization_id;
  const canEdit = isAdminRole(ctx.membership.role);

  const { data } = await ctx.supabase.from('organization_members').select('user_id, role, created_at').eq('organization_id', org).order('created_at', { ascending: true });
  const members = ((data ?? []) as MemberRow[]).filter((m): m is MemberRow => (ORG_ROLES as readonly string[]).includes(m.role));

  // Pelo RLS, só owner/admin enxergam o e-mail dos colegas; os demais veem apenas o próprio.
  const { data: profileData } = await ctx.supabase.from('profiles').select('id, email, full_name').in('id', members.map((m) => m.user_id));
  const profiles = new Map(((profileData ?? []) as ProfileRow[]).map((p) => [p.id, p]));

  return (
    <>
      <PageHeader title="Equipe" description="Pessoas com acesso a esta organização e seus papéis." />
      {canEdit ? (
        <div className="mb-4">
          <Alert tone="info">Para adicionar novas pessoas, convide-as pelo painel do Supabase e associe-as à organização (passo a passo em docs/MEMBROS.md). Aqui você gerencia papéis e remove quem já faz parte.</Alert>
        </div>
      ) : null}
      {members.length === 0 ? (
        <EmptyState title="Nenhum membro encontrado" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Membros da organização</caption>
            <thead className="border-b border-border text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Pessoa</th>
                <th scope="col" className="px-4 py-3 font-medium">Papel</th>
                <th scope="col" className="px-4 py-3 font-medium">Desde</th>
                <th scope="col" className="px-4 py-3 font-medium">{canEdit ? 'Ações' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const p = profiles.get(m.user_id);
                const isSelf = m.user_id === ctx.user.id;
                return (
                  <tr key={m.user_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p?.full_name || p?.email || 'Membro'}</div>
                      {p?.full_name && p.email ? <div className="text-xs text-muted">{p.email}</div> : null}
                      {isSelf ? <Badge>Você</Badge> : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={m.role === 'owner' ? 'success' : 'neutral'}>{ROLE_LABELS[m.role as OrgRole]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDateTime(m.created_at)}</td>
                    <td className="px-4 py-3">
                      {canEdit ? <MemberActions userId={m.user_id} role={m.role as OrgRole} canEdit isSelf={isSelf} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
