import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { loadAllShares, loadDashboards, loadMembers } from '@/lib/bi/data';
import { isUuid, one, type SearchParams } from '@/lib/bi/filters';
import { PERMISSION_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { revokeDashboard } from '@/lib/bi/actions/dashboards';
import { ActionButton } from '@/components/bi/fields';
import { ShareForm } from '@/components/bi/forms';
import { DateTimeBR, Section, TD, TH, TableShell } from '@/components/bi/bits';

export const metadata: Metadata = { title: 'Compartilhamentos' };

export default async function SharingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const [dashboards, shares, members] = await Promise.all([loadDashboards(p.ctx), loadAllShares(p.ctx), loadMembers(p.ctx)]);
  const mine = dashboards.filter((d) => p.perms.admin || d.created_by === p.ctx.user.id || shares.some((s) => s.dashboard_id === d.id && s.user_id === p.ctx.user.id && s.permission_level === 'admin'));
  const person = new Map(members.map((m) => [m.user_id, m.name]));
  const dName = new Map(dashboards.map((d) => [d.id, d.name]));
  const pre = one(sp.dashboard);
  const preset = pre && isUuid(pre) && mine.some((d) => d.id === pre) ? pre : '';
  const visible = shares.filter((s) => mine.some((d) => d.id === s.dashboard_id));
  return (
    <>
      <PageHeader title="Compartilhamentos" description="Quem pode ver ou editar cada dashboard. Compartilhar um dashboard não abre o dataset: a pessoa vê apenas o que os widgets mostram, e datasets restritos exigem autorização própria. Revogar vale na próxima consulta." />
      <Section title="Acessos concedidos">
        <TableShell caption="Acessos" empty={visible.length === 0} emptyText="Nenhum compartilhamento individual. Dashboards publicados para «toda a empresa» não aparecem aqui.">
          <thead><tr><th scope="col" className={TH}>Dashboard</th><th scope="col" className={TH}>Pessoa</th><th scope="col" className={TH}>Permissão</th><th scope="col" className={TH}>Desde</th><th scope="col" className={TH}><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{visible.map((s) => (
            <tr key={`${s.dashboard_id}${s.user_id}`} className="border-t border-border"><td className={TD}><Link className="underline" href={`/dashboards/${s.dashboard_id}`}>{dName.get(s.dashboard_id)}</Link></td><td className={TD}>{person.get(s.user_id) ?? 'Pessoa da equipe'}</td><td className={TD}>{PERMISSION_LABELS[s.permission_level]}</td><td className={TD}><DateTimeBR value={s.created_at} tz={p.tz} /></td>
              <td className={TD}><ActionButton action={revokeDashboard} fields={{ dashboard_id: s.dashboard_id, user_id: s.user_id }} label="Revogar" variant="danger" confirm="Revogar o acesso?" /></td></tr>
          ))}</tbody>
        </TableShell>
      </Section>
      {mine.length ? (
        <Section title="Compartilhar" description="Visualizadores só podem receber «Visualização». Quem recebe é avisado.">
          <ShareForm preset={preset} dashboards={mine.map((d) => ({ value: d.id, label: d.name }))} members={members.filter((m) => m.user_id !== p.ctx.user.id).map((m) => ({ value: m.user_id, label: `${m.name} (${m.role === 'viewer' ? 'visualizador' : m.role === 'member' ? 'analista' : m.role === 'manager' ? 'gestor' : 'administrador'})` }))} />
        </Section>
      ) : <p className="text-sm text-muted">Você ainda não administra nenhum dashboard.</p>}
    </>
  );
}
