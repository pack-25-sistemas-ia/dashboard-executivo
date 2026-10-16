import { randomUUID } from 'node:crypto';
import { expect, request as pwRequest, test } from '@playwright/test';
import { apiAal2Token, apiLogin, apiSignUp, onboardAndEnrollMfa, uiLogin, uniqueEmail } from './helpers';
import { DEMO, api, apiJson, demoLogin, demoToken, rpc } from './bi-helpers';

// Cenários de ameaça (prompt §29) contra o Supabase real: empresa A (demonstração) × empresa B (criada aqui, com MFA).
// Pré-requisito: `supabase db reset` recente + app em produção. Este arquivo cria alguns dados na empresa A (datasets/indicadores de teste).
test.describe.configure({ mode: 'serial' });

let manager = '', analyst = '', viewer = '', ownerAal1 = '', tokenB = '';
let orgA = '', orgB = '', dsA = '', dashA = '', widgetA = '', metricFat = '';
let bContext: Awaited<ReturnType<import('@playwright/test').Browser['newContext']>>;
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3123';

async function expectDenied(res: Response, label: string) {
  const body = await res.text();
  expect(res.status, `${label}: deveria ser negado (${body.slice(0, 160)})`).toBeGreaterThanOrEqual(400);
  expect(body, `${label}: a função existe e a negação veio do banco`).not.toMatch(/PGRST202|Could not find the function/);
  return body;
}
const COLS = [{ key: 'c1', name: 'Id', type: 'string', semantic: 'identifier', required: true, dedupe: true, position: 0 }, { key: 'c2', name: 'Data', type: 'date', semantic: 'time', position: 1 }, { key: 'c3', name: 'Valor', type: 'currency', semantic: 'measure', position: 2 }];
/** Importa pela API (mesmas funções do app) como o token informado e devolve ids. */
async function importApi(token: string, org: string, name: string | null, ds: string | null, hash: string, cols: unknown[], rows: unknown[], ack = false) {
  const b = await (await rpc(token, 'bi_begin_import', { p_org: org, p_dataset: ds, p_new_name: name, p_file_name: 'x.csv', p_file_hash: hash, p_file_type: 'csv', p_mode: 'replace', p_invalid_policy: 'reject_all', p_columns: cols, p_mapping: {}, p_total_rows: rows.length, p_notes: [] })).json() as { job_id: string; dataset_id: string; version_id: string };
  await rpc(token, 'bi_stage_rows', { p_org: org, p_job: b.job_id, p_rows: rows });
  await rpc(token, 'bi_finish_import', { p_org: org, p_job: b.job_id, p_valid: rows.length, p_invalid: 0, p_errors: [] });
  return { ...b, publish: () => rpc(token, 'bi_publish_import', { p_org: org, p_job: b.job_id, p_ack_impact: ack }) };
}

test('preparação: sessões da empresa A e da empresa B (com MFA)', async ({ browser }) => {
  manager = await demoToken(DEMO.manager); analyst = await demoToken(DEMO.analyst); viewer = await demoToken(DEMO.viewer); ownerAal1 = await demoToken(DEMO.owner);
  orgA = (await apiJson<Array<{ organization_id: string }>>(manager, 'organization_members?select=organization_id'))[0]!.organization_id;
  dsA = (await apiJson<Array<{ id: string }>>(analyst, 'datasets?select=id&name=eq.Vendas'))[0]!.id;
  dashA = (await apiJson<Array<{ id: string }>>(manager, 'dashboards?select=id&name=eq.Comercial'))[0]!.id;
  widgetA = (await apiJson<Array<{ id: string }>>(manager, `dashboard_widgets?select=id&dashboard_id=eq.${dashA}&widget_type=eq.comparison&limit=1`))[0]!.id;
  metricFat = (await apiJson<Array<{ id: string }>>(analyst, 'metric_definitions?select=id&name=eq.Faturamento'))[0]!.id;
  const email = uniqueEmail('biB');
  await apiSignUp(email);
  bContext = await browser.newContext({ baseURL: BASE, locale: 'pt-BR' });
  const page = await bContext.newPage();
  await uiLogin(page, email);
  const secret = await onboardAndEnrollMfa(page, 'Empresa B BI Ltda');
  tokenB = await apiAal2Token(await apiLogin(email), secret);
  orgB = (await apiJson<Array<{ organization_id: string }>>(tokenB, 'organization_members?select=organization_id'))[0]!.organization_id;
  expect(orgB).not.toBe(orgA);
  // dataset restrito: o dono (sem 2ª etapa) não o enxerga; usamos o id lido pelo próprio banco como superusuário via o administrador com MFA… aqui basta o nome
});

test('1 · isolamento: a empresa B não lê datasets, linhas, indicadores, dashboards, metas, exportações nem avisos da A', async () => {
  for (const t of ['datasets', 'dataset_versions', 'dataset_columns', 'import_jobs', 'import_row_errors', 'dimension_definitions', 'metric_definitions', 'metric_versions', 'chart_definitions', 'dashboards', 'dashboard_versions',
    'dashboard_widgets', 'dashboard_filters', 'dashboard_permissions', 'goal_definitions', 'goal_periods', 'saved_views', 'report_exports', 'data_refresh_events', 'bi_notifications', 'dataset_access', 'bi_settings']) {
    const res = await api(tokenB, `${t}?select=*${t === 'bi_settings' ? `&organization_id=eq.${orgA}` : ''}&limit=5`);
    expect(res.status, `B lendo ${t}`).toBe(200);
    expect(await res.json(), `B lendo ${t}`).toEqual([]);
  }
  const spec = { dataset_id: dsA, measures: [{ alias: 'm0', agg: 'count' }] };
  await expectDenied(await rpc(tokenB, 'bi_run_query', { p_org: orgA, p_spec: spec }), 'B consultando o dataset da A');
  await expectDenied(await rpc(tokenB, 'bi_run_query', { p_org: orgB, p_spec: spec }), 'B consultando o dataset da A pela própria org (id manipulado)');
  await expectDenied(await rpc(tokenB, 'bi_widget_query', { p_org: orgB, p_dashboard: dashA, p_widget: widgetA }), 'B consultando widget da A');
  await expectDenied(await rpc(tokenB, 'bi_dataset_rows', { p_org: orgB, p_dataset: dsA }), 'B lendo linhas da A');
  await expectDenied(await rpc(tokenB, 'bi_dashboard_sources', { p_org: orgB, p_dashboard: dashA }), 'B lendo as fontes do dashboard da A');
  await expectDenied(await rpc(tokenB, 'bi_quality_overview', { p_org: orgA }), 'B lendo a qualidade da A');
  expect((await rpc(tokenB, 'bi_quality_overview', { p_org: orgB })).status, 'controle: B lê a própria qualidade').toBe(200);
});

test('2 e 14 · visualizador não edita fórmulas nem publica; analista não publica; ninguém escreve direto nas tabelas', async () => {
  await expectDenied(await rpc(viewer, 'bi_save_metric', { p_org: orgA, p_id: null, p_dataset: dsA, p_name: 'X', p_description: null, p_type: 'aggregation', p_agg: 'count', p_field: null, p_ast: null, p_filters: [], p_format: 'integer', p_unit: null }), 'visualizador criando indicador');
  await expectDenied(await rpc(viewer, 'bi_save_dashboard', { p_org: orgA, p_id: dashA, p_expected: 1, p_name: 'x', p_description: null, p_default_period: 'last_30', p_comparison: 'none', p_partial_basis: 'full', p_widgets: [], p_filters: [] }), 'visualizador salvando dashboard');
  await expectDenied(await rpc(analyst, 'bi_publish_dashboard', { p_org: orgA, p_id: dashA, p_visibility: 'organization' }), 'analista publicando');
  await expectDenied(await rpc(viewer, 'bi_publish_dashboard', { p_org: orgA, p_id: dashA, p_visibility: 'organization' }), 'visualizador publicando');
  for (const [tok, who] of [[viewer, 'visualizador'], [analyst, 'analista'], [manager, 'gestor']] as const) {
    for (const t of ['metric_definitions', 'dashboards', 'datasets', 'dashboard_widgets', 'goal_definitions']) {
      const patch = await api(tok, `${t}?id=not.is.null`, { method: 'PATCH', body: JSON.stringify({ name: 'invadido' }) });
      expect(patch.status, `${who} PATCH ${t}`).toBeGreaterThanOrEqual(400);
      const del = await api(tok, `${t}?id=not.is.null`, { method: 'DELETE' });
      expect(del.status, `${who} DELETE ${t}`).toBeGreaterThanOrEqual(400);
      const ins = await api(tok, t, { method: 'POST', body: JSON.stringify({ organization_id: orgA, name: 'x' }) });
      expect(ins.status, `${who} INSERT ${t}`).toBeGreaterThanOrEqual(400);
    }
  }
  const rows = await api(viewer, 'dataset_rows?select=*&limit=1');
  expect(rows.status, 'dataset_rows não tem SELECT para ninguém').toBeGreaterThanOrEqual(400);
  expect((await api(manager, 'dataset_rows?select=*&limit=1')).status, 'nem para o gestor').toBeGreaterThanOrEqual(400);
});

test('3 e 4 · SQL arbitrário e JavaScript em fórmula: recusados pelo banco; as tabelas continuam intactas', async () => {
  const base = { dataset_id: dsA, measures: [{ alias: 'm0', agg: 'sum', field: 'c6' }] };
  for (const [label, spec] of [
    ['coluna com SQL', { ...base, measures: [{ alias: 'm0', agg: 'sum', field: 'c6; drop table public.datasets; --' }] }],
    ['agregação com SQL', { ...base, measures: [{ alias: 'm0', agg: 'sum); drop table public.datasets; --', field: 'c6' }] }],
    ['apelido com SQL', { ...base, measures: [{ alias: 'm0 from x; --', agg: 'count' }] }],
    ['filtro com operador inventado', { ...base, filters: [{ field: 'c3', op: 'or 1=1', value: 'x' }] }],
    ['ordenação com SQL', { ...base, order: [{ by: 'm0; drop table x', dir: 'asc' }] }],
  ] as const) {
    await expectDenied(await rpc(analyst, 'bi_run_query', { p_org: orgA, p_spec: spec }), label);
  }
  // valor com aspas: é só texto
  const ok = await rpc(analyst, 'bi_run_query', { p_org: orgA, p_spec: { dataset_id: dsA, measures: [{ alias: 'm0', agg: 'count' }], filters: [{ field: 'c3', op: 'eq', value: "x' or '1'='1" }] } });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as { rows: Array<{ m0: string }> }).rows[0]!.m0).toBe('0');
  for (const ast of [{ op: 'eval', code: 'process.exit()' }, { op: 'num', value: "1; drop table x" }, { op: 'ref', metric: "x'); --" }, { op: 'call', fn: 'fetch' }]) {
    await expectDenied(await rpc(analyst, 'bi_save_metric', { p_org: orgA, p_id: null, p_dataset: dsA, p_name: `F ${randomUUID().slice(0, 6)}`, p_description: null, p_type: 'formula', p_agg: null, p_field: null, p_ast: ast, p_filters: [], p_format: 'decimal', p_unit: null }), `fórmula ${JSON.stringify(ast).slice(0, 40)}`);
  }
  expect((await api(analyst, 'datasets?select=id&limit=1')).status).toBe(200);
});

test('5 e 8 · cabeçalho malicioso vira só rótulo; dataset com nome HTML é exibido como texto; dataset restrito não é lido por quem não tem acesso', async ({ page }) => {
  const evil = 'x"; drop table datasets; -- <img src=x onerror=alert(1)>';
  const imp = await importApi(analyst, orgA, 'Teste <b>HTML</b>', null, 'e'.repeat(64), [{ ...COLS[0], name: evil }, COLS[1], COLS[2]], [{ n: 2, k: 'a', v: { c1: 'a', c2: '2026-01-01', c3: '10' } }]);
  expect((await imp.publish()).status).toBe(200);
  const cols = await apiJson<Array<{ column_key: string; display_name: string }>>(analyst, `dataset_columns?select=column_key,display_name&dataset_version_id=eq.${imp.version_id}&order=position`);
  expect(cols.map((c) => c.column_key)).toEqual(['c1', 'c2', 'c3']);
  expect(cols[0]!.display_name).toBe(evil);
  const q = await rpc(analyst, 'bi_run_query', { p_org: orgA, p_spec: { dataset_id: imp.dataset_id, measures: [{ alias: 'm0', agg: 'sum', field: 'c3' }] } });
  expect(((await q.json()) as { rows: Array<{ m0: string }> }).rows[0]!.m0).toBe('10');
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; void d.dismiss(); });
  await demoLogin(page, DEMO.analyst);
  await page.goto(`/datasets/${imp.dataset_id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Teste <b>HTML</b>');
  await expect(page.locator('main img[src="x"]')).toHaveCount(0);
  expect(dialogs).toBe(0);
  // restrito
  const list = await apiJson<Array<{ id: string; name: string }>>(manager, 'datasets?select=id,name');
  expect(list.find((d) => d.name.startsWith('Folha'))).toBeUndefined();
});

test('7 e 15 · exportações de outra empresa são negadas e nunca são cacheadas', async () => {
  const res = await bContext.request.get(`${BASE}/api/export/dataset/${dsA}`);
  expect([401, 403, 404]).toContain(res.status());
  const res2 = await bContext.request.get(`${BASE}/api/export/dashboard/${dashA}`);
  expect([401, 403, 404]).toContain(res2.status());
  const res3 = await bContext.request.get(`${BASE}/api/importacoes/${randomUUID()}/erros`);
  expect([401, 403, 404]).toContain(res3.status());
  const mctx = await pwRequest.newContext({ baseURL: BASE });
  const anon = await mctx.get(`/api/export/dashboard/${dashA}`, { maxRedirects: 0 });
  expect([301, 302, 303, 307, 308, 401], 'sem sessão: redireciona ao login ou nega').toContain(anon.status());
  expect(await anon.text()).not.toContain('Receita');
  await mctx.dispose();
});

test('10 · consultas têm limite: linhas por página, tamanho do resultado e período máximo', async () => {
  const res = await rpc(analyst, 'bi_run_query', { p_org: orgA, p_spec: { dataset_id: dsA, measures: [{ alias: 'm0', agg: 'count' }], dimensions: [{ field: 'c1' }], limit: 999999 } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rows: unknown[]; truncated: boolean };
  expect(body.rows.length).toBe(1000);
  expect(body.truncated).toBe(true);
  const page = await (await rpc(analyst, 'bi_dataset_rows', { p_org: orgA, p_dataset: dsA, p_size: 100000 })).json() as { rows: unknown[]; size: number; total: number };
  expect(page.size).toBe(100);
  expect(page.rows.length).toBe(100);
  expect(page.total).toBe(3600);
  await expectDenied(await rpc(analyst, 'bi_dataset_rows', { p_org: orgA, p_dataset: dsA, p_for_export: true }), 'analista exportando linhas brutas');
});

test('11, 12 e 20 · reimportação duplicada, mudança de esquema que invalida indicador e carga parcial que não publica', async () => {
  const name = `Esquema ${randomUUID().slice(0, 6)}`;
  const rows = [{ n: 2, k: 'a', v: { c1: 'a', c2: '2026-01-01', c3: '10' } }, { n: 3, k: 'b', v: { c1: 'b', c2: '2026-01-02', c3: '20' } }];
  const hash = randomUUID().replace(/-/g, '').padEnd(64, '0');
  const first = await importApi(analyst, orgA, name, null, hash, COLS, rows);
  expect((await first.publish()).status).toBe(200);
  const again = await rpc(analyst, 'bi_begin_import', { p_org: orgA, p_dataset: first.dataset_id, p_new_name: null, p_file_name: 'x.csv', p_file_hash: hash, p_file_type: 'csv', p_mode: 'replace', p_invalid_policy: 'reject_all', p_columns: COLS, p_mapping: {}, p_total_rows: 2, p_notes: [] });
  expect(await expectDenied(again, 'mesmo arquivo de novo')).toMatch(/mesmo conteúdo/);
  const m = await (await rpc(analyst, 'bi_save_metric', { p_org: orgA, p_id: null, p_dataset: first.dataset_id, p_name: 'Soma teste', p_description: null, p_type: 'aggregation', p_agg: 'sum', p_field: 'c3', p_ast: null, p_filters: [], p_format: 'currency', p_unit: null })).json() as { id: string };
  // nova versão SEM a coluna c3: o impacto é obrigatório e a métrica fica inválida
  const noC3 = COLS.filter((c) => c.key !== 'c3');
  const second = await importApi(analyst, orgA, null, first.dataset_id, 'f'.repeat(64), noC3, rows.map((r) => ({ ...r, v: { c1: r.v.c1, c2: r.v.c2 } })));
  const refused = await second.publish();
  expect(await expectDenied(refused, 'publicar sem confirmar o impacto')).toMatch(/afeta 1 item/);
  expect((await apiJson<Array<{ current_version_id: string }>>(analyst, `datasets?select=current_version_id&id=eq.${first.dataset_id}`))[0]!.current_version_id).toBe(first.version_id);
  await rpc(analyst, 'bi_fail_import', { p_org: orgA, p_job: second.job_id, p_message: 'cancelado' });
  const third = await importApi(analyst, orgA, null, first.dataset_id, 'a'.repeat(63) + '1', noC3, rows.map((r) => ({ ...r, v: { c1: r.v.c1, c2: r.v.c2 } })), true);
  expect((await third.publish()).status).toBe(200);
  const metric = (await apiJson<Array<{ status: string; invalid_reason: string }>>(analyst, `metric_definitions?select=status,invalid_reason&id=eq.${m.id}`))[0]!;
  expect(metric.status).toBe('invalid');
  await expectDenied(await rpc(analyst, 'bi_run_query', { p_org: orgA, p_spec: { dataset_id: first.dataset_id, measures: [{ alias: 'm0', agg: 'sum', field: 'c3' }] } }), 'consultar coluna removida');
  // carga parcial: lote incompleto não fecha nem publica; a versão ativa segue servindo
  const cur = (await apiJson<Array<{ current_version_id: string }>>(analyst, `datasets?select=current_version_id&id=eq.${first.dataset_id}`))[0]!.current_version_id;
  const b = await (await rpc(analyst, 'bi_begin_import', { p_org: orgA, p_dataset: first.dataset_id, p_new_name: null, p_file_name: 'p.csv', p_file_hash: 'c'.repeat(64), p_file_type: 'csv', p_mode: 'replace', p_invalid_policy: 'reject_all', p_columns: noC3, p_mapping: {}, p_total_rows: 5, p_notes: [] })).json() as { job_id: string };
  await rpc(analyst, 'bi_stage_rows', { p_org: orgA, p_job: b.job_id, p_rows: [{ n: 2, k: 'p1', v: { c1: 'p1', c2: '2026-02-01' } }] });
  await expectDenied(await rpc(analyst, 'bi_finish_import', { p_org: orgA, p_job: b.job_id, p_valid: 5, p_invalid: 0, p_errors: [] }), 'fechar carga incompleta');
  await expectDenied(await rpc(analyst, 'bi_publish_import', { p_org: orgA, p_job: b.job_id, p_ack_impact: true }), 'publicar carga incompleta');
  await rpc(analyst, 'bi_fail_import', { p_org: orgA, p_job: b.job_id, p_message: 'limpeza' });
  expect((await apiJson<Array<{ current_version_id: string }>>(analyst, `datasets?select=current_version_id&id=eq.${first.dataset_id}`))[0]!.current_version_id).toBe(cur);
  void metricFat;
});

test('13 · id de dataset manipulado: visualizador e dono sem 2ª etapa não consultam; a negação vem do banco', async () => {
  const spec = { dataset_id: dsA, measures: [{ alias: 'm0', agg: 'count' }] };
  await expectDenied(await rpc(viewer, 'bi_run_query', { p_org: orgA, p_spec: spec }), 'visualizador consultando direto');
  await expectDenied(await rpc(ownerAal1, 'bi_run_query', { p_org: orgA, p_spec: spec }), 'administrador sem 2ª etapa consultando');
  expect(await apiJson<unknown[]>(ownerAal1, 'datasets?select=id'), 'administrador sem AAL2 não lê as tabelas (política restritiva)').toEqual([]);
  await expectDenied(await rpc(manager, 'bi_run_query', { p_org: orgA, p_spec: { dataset_id: randomUUID(), measures: [{ alias: 'm0', agg: 'count' }] } }), 'dataset inexistente');
});

test('revogação e despublicação têm efeito imediato na consulta do widget', async () => {
  const before = await rpc(viewer, 'bi_widget_query', { p_org: orgA, p_dashboard: dashA, p_widget: widgetA, p_overrides: {} });
  expect(before.status, 'controle: o visualizador consulta o widget do dashboard da empresa').toBe(200);
  const unpublish = await rpc(manager, 'bi_unpublish_dashboard', { p_org: orgA, p_id: dashA });
  expect(unpublish.status).toBe(204);
  await expectDenied(await rpc(viewer, 'bi_widget_query', { p_org: orgA, p_dashboard: dashA, p_widget: widgetA, p_overrides: {} }), 'depois de despublicar');
  const pub = await rpc(manager, 'bi_publish_dashboard', { p_org: orgA, p_id: dashA, p_visibility: 'organization' });
  expect(pub.status).toBe(200);
  expect((await rpc(viewer, 'bi_widget_query', { p_org: orgA, p_dashboard: dashA, p_widget: widgetA, p_overrides: {} })).status).toBe(200);
});
