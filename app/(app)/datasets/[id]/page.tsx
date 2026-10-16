import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Alert, Badge, PageHeader } from '@/components/ui/primitives';
import { loadColumns, loadDataset, loadDimensions, loadImports, loadMembers, loadMetrics, loadVersions } from '@/lib/bi/data';
import { DATASET_STATUS_LABELS, IMPORT_MODE_LABELS, IMPORT_STATUS_LABELS, VERSION_STATUS_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { archiveDataset, setDatasetAccess } from '@/lib/bi/actions/datasets';
import { deleteDimension } from '@/lib/bi/actions/models';
import { ActionButton } from '@/components/bi/fields';
import { DimensionForm, DatasetEditForm } from '@/components/bi/forms';
import { DateTimeBR, Disclosure, Section, StatusBadge, TD, TDR, TH, THR, TableShell } from '@/components/bi/bits';
import { ColumnsEditor } from '@/components/bi/columns-editor';

export const metadata: Metadata = { title: 'Dataset' };

export default async function DatasetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await pageCtx();
  if (!p.perms.analyst) redirect('/inicio');
  const ds = await loadDataset(p.ctx, id);
  if (!ds) notFound();
  const [versions, columns, imports, dims, metrics, members] = await Promise.all([
    loadVersions(p.ctx, id), loadColumns(p.ctx, ds.current_version_id), loadImports(p.ctx, id, 15), loadDimensions(p.ctx, id), loadMetrics(p.ctx, id), p.perms.admin && ds.restricted ? loadMembers(p.ctx) : Promise.resolve([]),
  ]);
  const cur = versions.find((v) => v.id === ds.current_version_id) ?? null;
  const nulls = cur?.stats_json?.nulls ?? null;
  const { data: access } = p.perms.admin && ds.restricted ? await p.ctx.supabase.from('dataset_access').select('user_id').eq('dataset_id', id) : { data: [] };
  const granted = new Set(((access ?? []) as Array<{ user_id: string }>).map((a) => a.user_id));

  return (
    <>
      <PageHeader title={ds.name} description={ds.description ?? undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={ds.status} label={DATASET_STATUS_LABELS[ds.status]} />
          {ds.restricted ? <Badge tone="warning">Restrito</Badge> : null}
          {ds.source_type === 'demo' ? <Badge>Dados de demonstração</Badge> : null}
          {ds.status === 'active' ? <Link className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" href={`/importacoes/nova?dataset=${id}`}>Importar / atualizar</Link> : null}
          {cur ? <Link className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-medium" href={`/explorador?dataset=${id}`}>Explorar dados</Link> : null}
        </div>
      </PageHeader>
      {ds.status === 'archived' ? <Alert tone="warning">Dataset arquivado: não recebe importações e os dashboards que o usam deixam de responder.</Alert> : null}
      {!cur ? <Alert tone="info">Este dataset ainda não tem dados publicados. <Link className="underline" href={`/importacoes/nova?dataset=${id}`}>Importe um arquivo</Link>.</Alert> : null}

      {cur ? (
        <Section title="Versão ativa" description="Todas as consultas usam esta versão. Estatísticas calculadas no momento da publicação.">
          <dl className="grid gap-3 sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Versão</dt><dd className="text-xl font-semibold">v{cur.version_number}</dd></div>
            <div><dt className="text-xs text-muted">Linhas</dt><dd className="text-xl font-semibold tabular-nums">{cur.row_count.toLocaleString('pt-BR')}</dd></div>
            <div><dt className="text-xs text-muted">Colunas</dt><dd className="text-xl font-semibold">{columns.length}</dd></div>
            <div><dt className="text-xs text-muted">Publicada em</dt><dd className="text-base font-semibold"><DateTimeBR value={cur.published_at} tz={p.tz} /></dd></div>
          </dl>
          {cur.stats_json?.rejected ? <p className="mt-2 text-sm text-muted">{cur.stats_json.rejected} linha(s) rejeitada(s) na última importação{cur.stats_json.skipped_existing ? ` · ${cur.stats_json.skipped_existing} ignorada(s) por já existirem` : ''}.</p> : null}
        </Section>
      ) : null}

      {columns.length ? (
        <Section title="Colunas" description="O nome é só um rótulo: as consultas usam chaves internas, nunca o texto do arquivo.">
          <ColumnsEditor datasetId={id} rows={cur?.row_count ?? 0} canEdit={ds.status === 'active'} columns={columns.map((c) => ({ key: c.column_key, name: c.display_name, type: c.data_type, semantic: c.semantic_type, description: c.metadata_json?.description ?? '', dedupe: c.dedupe, nulls: nulls ? (nulls as Record<string, number>)[c.column_key] ?? null : null }))} />
        </Section>
      ) : null}

      <Section title="Histórico de versões" description={`Mantemos as linhas das ${p.settings.retained_versions} versões mais recentes (configurável); as anteriores ficam só com metadados.`}>
        <TableShell caption="Versões do dataset" empty={versions.length === 0} emptyText="Nenhuma versão ainda.">
          <thead><tr><th scope="col" className={TH}>Versão</th><th scope="col" className={TH}>Situação</th><th scope="col" className={THR}>Linhas</th><th scope="col" className={TH}>Publicada em</th><th scope="col" className={TH}>Linhas disponíveis</th></tr></thead>
          <tbody>{versions.map((v) => <tr key={v.id} className="border-t border-border"><td className={TD}>v{v.version_number}</td><td className={TD}><StatusBadge status={v.status} label={VERSION_STATUS_LABELS[v.status] ?? v.status} /></td><td className={TDR}>{v.row_count.toLocaleString('pt-BR')}</td><td className={TD}><DateTimeBR value={v.published_at} tz={p.tz} /></td><td className={TD}>{v.status === 'failed' ? '—' : v.rows_purged ? 'Removidas (retenção)' : 'Sim'}</td></tr>)}</tbody>
        </TableShell>
      </Section>

      <Section title="Importações deste dataset">
        <TableShell caption="Importações" empty={imports.length === 0} emptyText="Nenhuma importação.">
          <thead><tr><th scope="col" className={TH}>Arquivo</th><th scope="col" className={TH}>Modo</th><th scope="col" className={TH}>Situação</th><th scope="col" className={THR}>Válidas</th><th scope="col" className={THR}>Com erro</th><th scope="col" className={TH}>Em</th></tr></thead>
          <tbody>{imports.map((i) => <tr key={i.id} className="border-t border-border"><td className={TD}><Link className="underline" href={`/importacoes/${i.id}`}>{i.file_name}</Link></td><td className={TD}>{IMPORT_MODE_LABELS[i.import_mode]}</td><td className={TD}><StatusBadge status={i.status} label={IMPORT_STATUS_LABELS[i.status] ?? i.status} /></td><td className={TDR}>{i.valid_rows.toLocaleString('pt-BR')}</td><td className={TDR}>{i.invalid_rows.toLocaleString('pt-BR')}</td><td className={TD}><DateTimeBR value={i.created_at} tz={p.tz} /></td></tr>)}</tbody>
        </TableShell>
      </Section>

      <Section title="Dimensões e indicadores" description="Dimensões são os recortes (canal, mês, região…); indicadores são as contas sobre os valores.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Dimensões ({dims.length})</h3>
            <ul className="mb-3 space-y-1 text-sm">{dims.map((d) => <li key={d.id} className="flex items-center justify-between gap-2"><span>{d.name} <span className="text-muted">({columns.find((c) => c.column_key === d.column_key)?.display_name ?? d.column_key} · {d.dimension_type === 'time' ? 'tempo' : 'categoria'})</span></span>
              <ActionButton action={deleteDimension} fields={{ id: d.id }} label="Remover" confirm="Remover a dimensão?" variant="danger" /></li>)}{dims.length === 0 ? <li className="text-muted">Nenhuma dimensão cadastrada.</li> : null}</ul>
            {columns.length ? (
              <Disclosure summary="Nova dimensão">
                <DimensionForm datasetId={id} columns={columns.map((c) => ({ value: c.column_key, label: c.display_name }))} />
              </Disclosure>
            ) : null}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Indicadores ({metrics.length})</h3>
            <ul className="mb-3 space-y-1 text-sm">{metrics.map((m) => <li key={m.id} className="flex items-center justify-between gap-2"><Link className="underline" href={`/indicadores/${m.id}`}>{m.name}</Link><StatusBadge status={m.status} label={m.status === 'active' ? 'Ativo' : m.status === 'invalid' ? 'Inválido' : 'Arquivado'} /></li>)}{metrics.length === 0 ? <li className="text-muted">Nenhum indicador.</li> : null}</ul>
            <Link className="text-sm underline" href={`/indicadores/novo?dataset=${id}`}>Criar indicador neste dataset</Link>
          </div>
        </div>
      </Section>

      {p.perms.admin && ds.restricted ? (
        <Section title="Acesso ao dataset restrito" description="Administradores sempre têm acesso. As demais pessoas só veem os dados (direto ou por dashboards) com autorização explícita; remover vale na consulta seguinte.">
          <ul className="space-y-2 text-sm">
            {members.filter((m) => m.role !== 'owner' && m.role !== 'admin').map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2"><span>{m.name} <span className="text-muted">({m.role === 'manager' ? 'Gestor' : m.role === 'member' ? 'Analista' : 'Visualizador'})</span></span>
                <ActionButton action={setDatasetAccess} fields={{ dataset_id: id, user_id: m.user_id, grant: granted.has(m.user_id) ? 'false' : 'true' }} label={granted.has(m.user_id) ? 'Remover acesso' : 'Conceder acesso'} variant={granted.has(m.user_id) ? 'danger' : 'secondary'} /></li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Configurações do dataset">
        <div className="grid gap-4 lg:grid-cols-2">
          <Disclosure summary="Renomear / descrição / restrição">
            <DatasetEditForm id={id} name={ds.name} description={ds.description} restricted={ds.restricted} canRestrict={p.perms.admin} />
          </Disclosure>
          {p.perms.manager ? (
            <div className="rounded-lg border border-border bg-card p-4">
              {ds.status === 'active' ? <ActionButton action={archiveDataset} fields={{ id }} label="Arquivar dataset" variant="danger" confirm="Arquivar? Dashboards que usam este dataset deixam de responder." /> : <ActionButton action={archiveDataset} fields={{ id, restore: 'true' }} label="Restaurar dataset" />}
            </div>
          ) : null}
        </div>
      </Section>
    </>
  );
}
