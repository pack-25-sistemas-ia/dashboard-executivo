import type { Metadata } from 'next';
import { PrivacyCreateForm, PrivacyStatusForm } from '@/components/forms/org-forms';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { requireContext } from '@/lib/auth/session';
import { nowMs } from '@/lib/time';
import { formatDateTime } from '@/lib/utils';
import { PRIVACY_STATUSES, PRIVACY_TYPE_LABELS, PRIVACY_TYPES } from '@/lib/validation/privacy';

export const metadata: Metadata = { title: 'Privacidade (LGPD)' };

type Row = { id: string; request_type: string; subject_reference: string; status: string; received_at: string; due_at: string; notes: string | null };

export default async function PrivacyPage() {
  const ctx = await requireContext(['owner', 'admin', 'manager']);
  const { data } = await ctx.supabase
    .from('privacy_requests')
    .select('id, request_type, subject_reference, status, received_at, due_at, notes')
    .eq('organization_id', ctx.membership.organization_id)
    .order('due_at', { ascending: true })
    .limit(200);
  const rows = (data ?? []) as Row[];
  const now = nowMs();

  return (
    <>
      <PageHeader title="Privacidade (LGPD)" description="Registre e acompanhe pedidos dos titulares de dados (art. 18). O prazo padrão para resposta completa é de 15 dias (art. 19, II)." />
      <div className="mb-4">
        <Alert tone="info">Este módulo organiza o atendimento. Ele não substitui a análise do encarregado nem de assessoria jurídica.</Alert>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card title="Nova solicitação">
          <PrivacyCreateForm />
        </Card>
        <div>
          {rows.length === 0 ? (
            <EmptyState title="Nenhuma solicitação registrada" description="Quando um titular exercer um direito, registre aqui para controlar o prazo." />
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => {
                const open = r.status === 'open' || r.status === 'in_progress';
                const overdue = open && new Date(r.due_at).getTime() < now;
                const type = (PRIVACY_TYPES as readonly string[]).includes(r.request_type) ? PRIVACY_TYPE_LABELS[r.request_type as (typeof PRIVACY_TYPES)[number]] : r.request_type;
                return (
                  <li key={r.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{type}</p>
                          <p className="text-sm text-muted">Referência: {r.subject_reference}</p>
                        </div>
                        {overdue ? <Badge tone="danger">Vencida</Badge> : open ? <Badge tone="warning">Em aberto</Badge> : <Badge tone="success">Encerrada</Badge>}
                      </div>
                      <p className="mt-2 text-xs text-muted">Recebida em {formatDateTime(r.received_at)} · Prazo {formatDateTime(r.due_at)}</p>
                      {r.notes ? <p className="mt-2 whitespace-pre-wrap text-sm">{r.notes}</p> : null}
                      <div className="mt-3">
                        <PrivacyStatusForm id={r.id} status={(PRIVACY_STATUSES as readonly string[]).includes(r.status) ? (r.status as (typeof PRIVACY_STATUSES)[number]) : 'open'} />
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
