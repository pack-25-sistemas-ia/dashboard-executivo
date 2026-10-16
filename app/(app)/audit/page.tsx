import type { Metadata } from 'next';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { requireContext } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Auditoria' };

type AuditRow = { id: number; actor_id: string | null; action: string; entity: string; entity_id: string | null; changes: { columns?: string[] } | null; created_at: string };

const ACTIONS: Record<string, string> = { insert: 'Criou', update: 'Alterou', delete: 'Removeu' };
const ENTITIES: Record<string, string> = {
  organizations: 'organização',
  organization_members: 'membro',
  organization_settings: 'configurações',
  privacy_requests: 'solicitação LGPD',
};

export default async function AuditPage() {
  const ctx = await requireContext(['owner', 'admin']);
  const { data } = await ctx.supabase
    .from('audit_log')
    .select('id, actor_id, action, entity, entity_id, changes, created_at')
    .eq('organization_id', ctx.membership.organization_id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100);
  const rows = (data ?? []) as AuditRow[];

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => Boolean(v)))];
  const { data: profileData } = actorIds.length ? await ctx.supabase.from('profiles').select('id, email').in('id', actorIds) : { data: [] };
  const emails = new Map(((profileData ?? []) as Array<{ id: string; email: string }>).map((p) => [p.id, p.email]));

  return (
    <>
      <PageHeader title="Auditoria" description="Registro imutável de alterações. Guarda quem, quando e quais campos mudaram, nunca os valores." />
      {rows.length === 0 ? (
        <EmptyState title="Nenhum evento registrado" description="As alterações da organização aparecerão aqui." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Eventos de auditoria mais recentes</caption>
            <thead className="border-b border-border text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Quando</th>
                <th scope="col" className="px-4 py-3 font-medium">Quem</th>
                <th scope="col" className="px-4 py-3 font-medium">O quê</th>
                <th scope="col" className="px-4 py-3 font-medium">Campos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-3">{r.actor_id ? (emails.get(r.actor_id) ?? 'Usuário') : 'Sistema'}</td>
                  <td className="px-4 py-3">{ACTIONS[r.action] ?? r.action} {ENTITIES[r.entity] ?? r.entity}</td>
                  <td className="px-4 py-3">
                    {r.changes?.columns?.length ? r.changes.columns.map((c) => <Badge key={c}>{c}</Badge>) : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-3 text-xs text-muted">Exibindo os 100 eventos mais recentes.</p>
    </>
  );
}
