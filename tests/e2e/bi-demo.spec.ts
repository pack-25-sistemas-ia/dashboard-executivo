import { expect, test } from '@playwright/test';
import { DEMO, apiJson, brl, demoLogin, demoToken, expectNoServerError, norm, rpc } from './bi-helpers';

// Dados de demonstração (supabase/seed.sql). Pré-requisito: `supabase db reset` recém-executado e o app em produção.
test.describe.configure({ mode: 'serial' });

const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const PAGES = [
  ['/inicio', 'Painel inicial'], ['/dashboards', 'Dashboards'], ['/metas', 'Metas'], ['/datasets', 'Datasets'], ['/importacoes', 'Importações'], ['/importacoes/nova', 'Nova importação'], ['/explorador', 'Explorador de dados'],
  ['/indicadores', 'Indicadores'], ['/indicadores/novo', 'Novo indicador'], ['/relatorios', 'Central de relatórios'], ['/compartilhamentos', 'Compartilhamentos'], ['/qualidade', 'Qualidade dos dados'],
  ['/notificacoes', 'Avisos'], ['/configuracoes', 'Configurações do BI'], ['/dashboards/novo', 'Novo dashboard a partir de um modelo'],
] as const;

test('gestor: todas as telas abrem com dados reais e sem erro', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  for (const [path, heading] of PAGES) {
    if (path === '/configuracoes') continue; // só administrador
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { name: heading, level: 1 }).first(), path).toBeVisible();
    await expectNoServerError(page, path);
  }
});

test('configurações do BI são só do administrador: o gestor é redirecionado', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/configuracoes');
  await expect(page).toHaveURL(/\/inicio|\/dashboard/);
});

test('dashboard Comercial: widgets, fonte e valores batem com a consulta direta ao banco', async ({ page }) => {
  const analystToken = await demoToken(DEMO.analyst);
  const orgs = await apiJson<Array<{ organization_id: string }>>(analystToken, 'organization_members?select=organization_id');
  const org = orgs[0]!.organization_id;
  const ds = (await apiJson<Array<{ id: string }>>(analystToken, 'datasets?select=id&name=eq.Vendas'))[0]!.id;
  const today = todayBR();
  const res = await rpc(analystToken, 'bi_run_query', { p_org: org, p_spec: { dataset_id: ds, measures: [{ alias: 'm0', agg: 'sum', field: 'c6' }, { alias: 'm1', agg: 'count' }], period: { field: 'c2', from: addDays(today, -29), to: today } } });
  expect(res.status).toBe(200);
  const row = ((await res.json()) as { rows: Array<{ m0: string; m1: string }> }).rows[0]!;
  const fat = brl(Number(row.m0));
  const ticket = brl(Number(row.m0) / Number(row.m1));

  await demoLogin(page, DEMO.manager);
  await page.goto('/dashboards');
  await page.getByRole('link', { name: /Comercial/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Comercial', level: 1 })).toBeVisible();
  await expect(page.getByTestId('dashboard-grid')).toBeVisible();
  const kpi = (title: string) => page.getByRole('region', { name: title }).first();
  await expect(kpi('Faturamento').getByTestId('kpi-value')).toHaveText(norm(fat));
  await expect(kpi('Pedidos').getByTestId('kpi-value')).toHaveText(Number(row.m1).toLocaleString('pt-BR'));
  await expect(kpi('Ticket médio').getByTestId('kpi-value')).toHaveText(norm(ticket));
  await expect(kpi('Faturamento').getByTestId('variation')).toContainText('vs. período de comparação');
  await expect(kpi('Faturamento')).toContainText('Fonte: Vendas · versão 1');
  for (const g of ['Faturamento por mês', 'Faturamento por canal', 'Faturamento por vendedor']) {
    await expect(page.getByRole('region', { name: g })).toBeVisible();
    await expect(page.getByRole('region', { name: g }).getByText('Ver dados em tabela')).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'Atualização dos dados' })).toContainText('Vendas');
  await expect(page.getByRole('region', { name: 'Atualização dos dados' })).toContainText('Em dia');
  await expectNoServerError(page, 'dashboard');
});

test('período personalizado e comparação: o texto informa as datas e o critério; mês parcial declara a base', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/dashboards');
  await page.getByRole('link', { name: /Comercial/ }).first().click();
  await page.getByLabel('Período', { exact: true }).selectOption('this_month');
  await page.getByLabel('Comparar com').selectOption('previous_month');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByTestId('period-note')).toContainText('Mês atual');
  await expect(page.getByRole('region', { name: 'Faturamento' }).first().getByTestId('variation')).toContainText(/mesmo número de dias|mês anterior/);
});

test('visualizador: vê o dashboard publicado, não vê dados brutos e não tem ferramentas de edição', async ({ page }) => {
  await demoLogin(page, DEMO.viewer);
  await page.goto('/dashboards');
  await page.getByRole('link', { name: /Comercial/ }).first().click();
  await expect(page.getByRole('region', { name: 'Faturamento' }).first().getByTestId('kpi-value')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Editar layout' })).toHaveCount(0);
  for (const path of ['/datasets', '/importacoes', '/indicadores', '/explorador', '/qualidade', '/configuracoes']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/inicio|\/dashboard/);
  }
  const tok = await demoToken(DEMO.viewer);
  const rows = await apiJson<unknown[]>(tok, 'datasets?select=id');
  expect(rows).toEqual([]);
});

test('metas: o painel mostra alvo, realizado e situação respeitando a direção', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/metas');
  const rows = page.getByTestId('goal-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Despesas do mês (teto)' })).toContainText(/Atingida|Não atingida|Sem dados/);
  await expect(rows.filter({ hasText: 'Faturamento do mês' })).toContainText('Meta mínima');
});

test('qualidade: aponta o dataset desatualizado e o dataset restrito não aparece para o gestor', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/qualidade');
  await expect(page.getByRole('table', { name: 'Qualidade por dataset' }).getByRole('row', { name: /Despesas/ })).toContainText('Desatualizado');
  await expect(page.getByRole('row', { name: /Folha de pagamento/ })).toHaveCount(0);
  await page.goto('/datasets');
  await expect(page.getByRole('link', { name: 'Folha de pagamento (restrito)' })).toHaveCount(0);
});

test('explorador: paginação, filtro e ordenação no servidor', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await page.goto('/datasets');
  await page.getByRole('link', { name: 'Vendas', exact: true }).click();
  await page.getByRole('link', { name: 'Explorar dados' }).click();
  await expect(page.getByRole('heading', { name: 'Explorador de dados', level: 1 })).toBeVisible();
  await expect(page.locator('main')).toContainText('3.600 linha(s)');
  await page.getByLabel('Filtro 1: coluna').selectOption({ label: 'Canal' });
  await page.getByLabel('Valor', { exact: true }).first().fill('Site próprio');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(25);
  const body = norm(await page.locator('tbody').innerText());
  expect(body.match(/Loja física/g)).toBeNull();
  await page.getByRole('link', { name: /^Valor/ }).click();
  await expect(page).toHaveURL(/sort=c6/);
});
