import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { loadCurrentVersions, loadDashboards, loadDatasets, loadFavoriteIds, loadGoals, loadImports, loadMetrics, loadRecent, loadDashboard } from '@/lib/bi/data';
import { loadDashView } from '@/lib/bi/dashboard-view';
import { resolvePeriodSel } from '@/lib/bi/filters';
import { IMPORT_STATUS_LABELS } from '@/lib/bi/labels';
import { pageCtx } from '@/lib/bi/page';
import { DateBR, DateTimeBR, Section, StatusBadge, TD, TH, TableShell } from '@/components/bi/bits';
import { WidgetCard } from '@/components/bi/widget-view';
import { checkFreshness } from '@/lib/bi/actions/misc';

export const metadata: Metadata = { title: 'Início' };

export default async function InicioPage() {
  const p = await pageCtx();
  if (p.perms.analyst) await checkFreshness();
  const [datasets, dashboards, favs, recent, imports, metrics, goals] = await Promise.all([
    loadDatasets(p.ctx), loadDashboards(p.ctx), loadFavoriteIds(p.ctx), loadRecent(p.ctx, 5), p.perms.analyst ? loadImports(p.ctx, undefined, 5) : Promise.resolve([]),
    p.perms.analyst ? loadMetrics(p.ctx) : Promise.resolve([]), p.perms.manager ? loadGoals(p.ctx) : Promise.resolve({ goals: [], periods: [] }),
  ]);
  const versions = await loadCurrentVersions(p.ctx, datasets.map((d) => d.current_version_id).filter((x): x is string => Boolean(x)));
  const dashById = new Map(dashboards.map((d) => [d.id, d]));
  const favList = dashboards.filter((d) => favs.has(d.id));
  const recentList = recent.map((r) => dashById.get(r.dashboard_id)).filter((d): d is NonNullable<typeof d> => Boolean(d));
  const staleMs = p.settings.stale_days * 86_400_000;
  const stale = datasets.filter((d) => d.status === 'active' && d.current_version_id && (() => { const v = versions.get(d.id); return v?.published_at ? Date.now() - new Date(v.published_at).getTime() > staleMs : false; })());
  const invalid = metrics.filter((m) => m.status === 'invalid');
  const failed = imports.filter((i) => i.status === 'failed');
  const empty = datasets.length === 0 && dashboards.length === 0;

  // indicadores em destaque: os cartões (KPI) do primeiro favorito ou do dashboard mais recente
  const featured = favList[0] ?? recentList[0] ?? dashboards.find((d) => d.status === 'published');
  let featuredView: { name: string; id: string; cards: React.ReactNode[] } | null = null;
  if (featured) {
    const full = await loadDashboard(p.ctx, featured.id);
    if (full) {
      const kpis = full.widgets.filter((w) => w.widget_type === 'kpi' || w.widget_type === 'comparison').slice(0, 4);
      if (kpis.length) {
        const sel = resolvePeriodSel({}, p.today, { preset: full.dashboard.default_period as never, comparison: full.dashboard.comparison as never });
        const view = await loadDashView(p.ctx, p.org, full.dashboard, kpis, { range: sel.range, preset: sel.preset, comparison: sel.comparison, today: p.today, filters: {} });
        featuredView = { name: full.dashboard.name, id: full.dashboard.id, cards: kpis.map((w) => <WidgetCard key={w.id} w={w} outcome={view.outcomes.get(w.id) ?? null} extras={view.extras} tz={p.tz} dashboardId={full.dashboard.id} />) };
      }
    }
  }

  return (
    <>
      <PageHeader title="Painel inicial" description="Seus dashboards, a situação dos dados e os alertas que merecem atenção. Tudo aqui vem dos arquivos que a sua empresa importou." />

      {empty ? (
        <EmptyState title="Vamos começar" description="O fluxo é sempre o mesmo: importar → validar → criar indicadores → montar dashboards → compartilhar.">
          <ol className="mx-auto mt-4 max-w-md list-decimal space-y-2 pl-6 text-left text-sm">
            <li>{p.perms.analyst ? <Link className="underline" href="/importacoes/nova">Importe uma planilha (CSV ou XLSX)</Link> : 'Peça a um analista para importar uma planilha'}.</li>
            <li>Confirme os tipos das colunas e a chave de deduplicação.</li>
            <li>{p.perms.analyst ? <Link className="underline" href="/indicadores/novo">Crie indicadores</Link> : 'Indicadores são criados por analistas'} (soma, média, razões…).</li>
            <li>{p.perms.analyst ? <Link className="underline" href="/dashboards/novo">Crie um dashboard</Link> : 'Dashboards compartilhados com você aparecem aqui'} a partir de um modelo ou do zero.</li>
          </ol>
        </EmptyState>
      ) : null}

      {stale.length || invalid.length || failed.length ? (
        <Section title="Atenção">
          <ul className="space-y-2">
            {stale.map((d) => <li key={d.id}><Alert tone="warning">O dataset <Link className="underline" href={`/datasets/${d.id}`}>{d.name}</Link> não recebe dados há mais de {p.settings.stale_days} dias: confira antes de decidir com base nele.</Alert></li>)}
            {invalid.map((m) => <li key={m.id}><Alert tone="error">O indicador <Link className="underline" href={`/indicadores/${m.id}`}>{m.name}</Link> está inválido{m.invalid_reason ? `: ${m.invalid_reason}` : ''}.</Alert></li>)}
            {failed.map((i) => <li key={i.id}><Alert tone="error">A importação de «{i.file_name}» não foi concluída. <Link className="underline" href={`/importacoes/${i.id}`}>Ver detalhes</Link>.</Alert></li>)}
          </ul>
        </Section>
      ) : null}

      {featuredView ? (
        <Section title="Indicadores em destaque" description={`Do dashboard «${featuredView.name}».`} actions={<Link className="text-sm underline" href={`/dashboards/${featuredView.id}`}>Abrir dashboard</Link>}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="featured">{featuredView.cards}</div>
        </Section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Dashboards favoritos">
          {favList.length ? <ul className="space-y-2">{favList.map((d) => <li key={d.id}><Link className="underline" href={`/dashboards/${d.id}`}>★ {d.name}</Link></li>)}</ul> : <p className="text-sm text-muted">Marque um dashboard com ☆ para encontrá-lo aqui.</p>}
        </Section>
        <Section title="Recentes">
          {recentList.length ? <ul className="space-y-2">{recentList.map((d) => <li key={d.id} className="flex items-center justify-between gap-2"><Link className="underline" href={`/dashboards/${d.id}`}>{d.name}</Link><StatusBadge status={d.status} label={d.status === 'published' ? 'Publicado' : 'Rascunho'} /></li>)}</ul> : <p className="text-sm text-muted">Você ainda não abriu nenhum dashboard.</p>}
        </Section>
      </div>

      <Section title="Datasets" description="Última atualização de cada fonte de dados." actions={p.perms.analyst ? <Link className="text-sm underline" href="/datasets">Todos os datasets</Link> : undefined}>
        {datasets.length ? (
          <TableShell caption="Datasets disponíveis">
            <thead><tr><th scope="col" className={TH}>Dataset</th><th scope="col" className={TH}>Versão</th><th scope="col" className={TH}>Linhas</th><th scope="col" className={TH}>Atualizado em</th><th scope="col" className={TH}>Situação</th></tr></thead>
            <tbody>{datasets.map((d) => { const v = versions.get(d.id); const isStale = stale.some((x) => x.id === d.id); return (
              <tr key={d.id} className="border-t border-border"><td className={TD}><Link className="underline" href={`/datasets/${d.id}`}>{d.name}</Link></td><td className={TD}>{v ? `v${v.version_number}` : '—'}</td><td className={TD}>{v ? v.row_count.toLocaleString('pt-BR') : '—'}</td><td className={TD}><DateTimeBR value={v?.published_at} tz={p.tz} /></td>
              <td className={TD}>{d.status === 'archived' ? <Badge>Arquivado</Badge> : !v ? <Badge tone="warning">Sem dados</Badge> : isStale ? <Badge tone="warning">Desatualizado</Badge> : <Badge tone="success">Em dia</Badge>}</td></tr>); })}</tbody>
          </TableShell>
        ) : <p className="text-sm text-muted">{p.perms.analyst ? 'Nenhum dataset ainda.' : 'Nenhum dataset disponível para você: você vê dados por meio dos dashboards compartilhados.'}</p>}
      </Section>

      {p.perms.analyst ? (
        <Section title="Últimas importações" actions={<Link className="text-sm underline" href="/importacoes">Ver todas</Link>}>
          {imports.length ? <ul className="space-y-2 text-sm">{imports.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2"><Link className="underline" href={`/importacoes/${i.id}`}>{i.file_name}</Link><StatusBadge status={i.status} label={IMPORT_STATUS_LABELS[i.status] ?? i.status} /><span className="text-muted">{i.valid_rows.toLocaleString('pt-BR')} válidas · {i.invalid_rows.toLocaleString('pt-BR')} com erro · <DateBR value={i.created_at} /></span></li>)}</ul> : <p className="text-sm text-muted">Nenhuma importação ainda.</p>}
        </Section>
      ) : null}
      {p.perms.manager && goals.goals.length ? (
        <Section title="Metas" actions={<Link className="text-sm underline" href="/metas">Acompanhar metas</Link>}>
          <p className="text-sm text-muted">{goals.goals.filter((g) => g.status === 'active').length} meta(s) ativa(s). Abra o painel de metas para ver o realizado de cada uma.</p>
        </Section>
      ) : null}
    </>
  );
}
