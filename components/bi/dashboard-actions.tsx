'use client';

import Link from 'next/link';
import { archiveDashboard, duplicateDashboard, publishDashboard, restoreDashboardVersion, setFavorite, unpublishDashboard } from '@/lib/bi/actions/dashboards';
import { VISIBILITY_LABELS } from '@/lib/bi/labels';
import { ActionButton, BiForm, SelectF, TextF } from './fields';
import { Disclosure } from './bits';

/** Barra de ações do dashboard (a autorização de verdade é do banco; aqui só mostramos o que a pessoa pode tentar). */
export function DashboardActions({ dashboardId, name, status, visibility, canEdit, canPublish, canShare, canArchive, isFavorite, rowVersion, versions, canRestore, tz, exportHref }: {
  dashboardId: string; name: string; status: string; visibility: string; canEdit: boolean; canPublish: boolean; canShare: boolean; canArchive: boolean; isFavorite: boolean; rowVersion: number;
  versions: Array<{ number: number; createdAt: string }>; canRestore: boolean; tz: string; exportHref: string;
}) {
  const btn = 'inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5';
  return (
    <div className="mb-4 space-y-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? <Link className={`${btn} bg-primary text-primary-foreground hover:opacity-90`} href={`/dashboards/${dashboardId}/editar`}>Editar layout</Link> : null}
        <ActionButton action={setFavorite} fields={{ id: dashboardId, on: isFavorite ? 'false' : 'true' }} label={isFavorite ? '★ Favorito' : '☆ Favoritar'} pending="Salvando…" />
        <a className={btn} href={exportHref} download>Exportar CSV</a>
        <PrintButton className={btn} />
        {canShare ? <Link className={btn} href={`/compartilhamentos?dashboard=${dashboardId}`}>Compartilhar</Link> : null}
        {canPublish && status === 'published' ? <ActionButton action={unpublishDashboard} fields={{ id: dashboardId }} label="Despublicar" confirm="Voltar a rascunho privado?" /> : null}
        {canArchive ? <ActionButton action={archiveDashboard} fields={{ id: dashboardId }} label="Arquivar" variant="danger" confirm="Arquivar este dashboard?" /> : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {canPublish ? (
          <Disclosure summary={status === 'published' ? 'Publicar nova versão' : 'Publicar dashboard'}>
            <BiForm action={publishDashboard} submit="Publicar" className="grid gap-3" hidden={{ id: dashboardId }}>
              {(f) => <SelectF f={f} name="visibility" label="Quem pode ver" def={visibility} opts={Object.entries(VISIBILITY_LABELS).map(([value, label]) => ({ value, label }))} hint="«Toda a empresa» não é permitido quando algum widget usa dataset restrito." />}
            </BiForm>
          </Disclosure>
        ) : null}
        {canEdit ? (
          <Disclosure summary="Duplicar dashboard">
            <BiForm action={duplicateDashboard} submit="Duplicar" className="grid gap-3" hidden={{ id: dashboardId }}>
              {(f) => <TextF f={f} name="name" label="Nome da cópia" def={`${name} (cópia)`} max={80} required />}
            </BiForm>
          </Disclosure>
        ) : null}
        {canRestore && versions.length ? (
          <Disclosure summary={`Versões publicadas (${versions.length})`}>
            <ul className="mb-3 space-y-1 text-sm">
              {versions.map((v) => <li key={v.number}>Versão {v.number} · {new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(v.createdAt))}</li>)}
            </ul>
            <BiForm action={restoreDashboardVersion} submit="Restaurar layout" className="grid gap-3" hidden={{ id: dashboardId, expected: String(rowVersion) }}>
              {(f) => <SelectF f={f} name="version" label="Restaurar a versão" opts={versions.map((v) => ({ value: String(v.number), label: `Versão ${v.number}` }))} hint="Substitui widgets e filtros do rascunho atual pelo instantâneo escolhido." />}
            </BiForm>
          </Disclosure>
        ) : null}
      </div>
    </div>
  );
}

function PrintButton({ className }: { className: string }) {
  return <button type="button" className={className} onClick={() => window.print()}>Imprimir / salvar em PDF</button>;
}
