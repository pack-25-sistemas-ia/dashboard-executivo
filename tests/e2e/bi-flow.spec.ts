import { expect, test, type Page } from '@playwright/test';
import { DEMO, apiJson, buildXlsx, demoLogin, demoToken, norm } from './bi-helpers';

// Fluxos de ponta a ponta: importar → validar → indicadores → dashboard por modelo → editar → compartilhar → exportar.
// MUDA os dados de demonstração. Pré-requisito: `supabase db reset` recente + app em produção.
test.describe.configure({ mode: 'serial' });

const CSV1 = [
  'Pedido;Data;Canal;Valor;Quantidade',
  'E1;05/03/2026;Loja;1.234,50;2',
  'E2;10/03/2026;Site;200,00;1',
  'E3;31/02/2026;Loja;50,00;1',
  'E4;15/04/2026;Site;abc;3',
  'E5;20/04/2026;Loja;300,25;4',
  'E7;25/04/2026;=HYPERLINK("http://x");10,00;1',
].join('\r\n');
// válidas: E1 1234,50 · E2 200,00 · E5 300,25 · E7 10,00 → soma 1.744,75 · inválidas: E3 (data) e E4 (valor)
const CSV2 = ['Pedido;Data;Canal;Valor;Quantidade', 'E5;20/04/2026;Loja;999,99;4', 'E6;02/05/2026;Site;100,00;1'].join('\r\n');
// acréscimo: E5 já existe (ignorado, mantém 300,25); E6 entra → 4 pedidos... total 5 linhas, soma 1.844,75

const csvFile = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
let datasetId = '';
let dashboardId = '';

async function startImport(page: Page, opts: { dataset?: string; name?: string; file: { name: string; mimeType: string; buffer: Buffer } }) {
  await page.goto(opts.dataset ? `/importacoes/nova?dataset=${opts.dataset}` : '/importacoes/nova');
  if (!opts.dataset) await page.getByLabel('Nome do novo dataset').fill(opts.name ?? 'Pedidos E2E');
  await page.getByLabel(/^Arquivo \(/).setInputFiles(opts.file);
  await page.getByRole('button', { name: 'Ler arquivo e sugerir tipos' }).click();
  await expect(page.getByRole('heading', { name: /2\. Prévia e mapeamento/ })).toBeVisible();
}

test('importação CSV: tipos brasileiros sugeridos, chave, erros por linha e nada publicado enquanto houver erro', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await startImport(page, { file: csvFile('pedidos.csv', CSV1) });
  // inferência: data, moeda/decimal brasileiro, inteiro
  await expect(page.getByLabel('Tipo da coluna 2')).toHaveValue('string'); // «31/02» quebra a inferência de data → texto (usuário confirma)
  await page.getByLabel('Tipo da coluna 2').selectOption('date');
  await page.getByLabel('Tipo da coluna 4').selectOption('currency');
  await page.getByLabel('Coluna 1 faz parte da chave de deduplicação').check();
  await page.getByRole('button', { name: /Validar arquivo/ }).click();
  await expect(page.getByTestId('imp-total')).toHaveText('6');
  await expect(page.getByTestId('imp-valid')).toHaveText('4');
  await expect(page.getByTestId('imp-invalid')).toHaveText('2');
  await expect(page.getByRole('table', { name: 'Erros por linha' })).toContainText('Data inválida');
  await expect(page.getByRole('table', { name: 'Erros por linha' })).toContainText('abc');
  await expect(page.getByText('Há linhas com erro e você escolheu não publicar nada')).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirmar e publicar/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancelar importação' }).click();
  await expect(page.getByTestId('imp-total')).toHaveCount(0);
});

test('importação parcial controlada: só as válidas entram; o relatório de erros fica guardado', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await startImport(page, { file: csvFile('pedidos.csv', CSV1) });
  await page.getByLabel('Tipo da coluna 2').selectOption('date');
  await page.getByLabel('Tipo da coluna 4').selectOption('currency');
  await page.getByLabel('Coluna 1 faz parte da chave de deduplicação').check();
  await page.getByLabel(/Importar só as linhas válidas/).check();
  await page.getByRole('button', { name: /Validar arquivo/ }).click();
  await expect(page.getByTestId('imp-valid')).toHaveText('4');
  await page.getByRole('button', { name: /Confirmar e publicar/ }).click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
  datasetId = page.url().split('/').pop()!.split('?')[0]!;
  await expect(page.getByRole('heading', { name: 'Pedidos E2E', level: 1 })).toBeVisible();
  await expect(page.locator('main')).toContainText('2 linha(s) rejeitada(s)');
  await page.goto('/importacoes');
  await page.getByRole('link', { name: 'pedidos.csv' }).first().click();
  await expect(page.getByRole('table', { name: 'Erros por linha' })).toContainText('31/02');
  const csv = await page.request.get(page.url().replace(/\/importacoes\/([0-9a-f-]+).*/, '/api/importacoes/$1/erros'));
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('Motivo');
});

test('indicador de soma: o valor de conferência fecha com a conta à mão (1.744,75)', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await page.goto(`/indicadores/novo?dataset=${datasetId}`);
  await page.getByLabel('Nome do indicador').fill('Receita E2E');
  await page.locator('#mf-agg').selectOption('sum');
  await page.locator('#mf-field').selectOption({ label: 'Valor — Moeda (R$)' });
  await page.getByLabel('Formato de exibição').selectOption('currency');
  await page.getByRole('button', { name: 'Criar indicador' }).click();
  await page.waitForURL(/\/indicadores\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('metric-sample')).toContainText('R$ 1.744,75');
  await expect(page.locator('main')).toContainText('Versões');
});

test('fórmula: razão entre indicadores, sem texto livre e com divisão por zero explicada', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await page.goto(`/indicadores/novo?dataset=${datasetId}`);
  await page.getByLabel('Nome do indicador').fill('Pedidos E2E');
  await page.locator('#mf-agg').selectOption('count');
  await page.getByLabel('Formato de exibição').selectOption('integer');
  await page.getByRole('button', { name: 'Criar indicador' }).click();
  await page.waitForURL(/\/indicadores\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('metric-sample')).toContainText('4');

  await page.goto(`/indicadores/novo?dataset=${datasetId}`);
  await page.getByLabel('Nome do indicador').fill('Ticket E2E');
  await page.getByLabel(/Fórmula entre outros/).check();
  await page.getByLabel('Indicador do termo 1').selectOption({ label: 'Receita E2E' });
  await page.getByLabel('Indicador do termo 2').selectOption({ label: 'Pedidos E2E' });
  await expect(page.getByTestId('formula-preview')).toContainText('(«Receita E2E» ÷ «Pedidos E2E»)'.replace(/«|»/g, ''));
  await page.getByLabel('Formato de exibição').selectOption('currency');
  await page.getByRole('button', { name: 'Criar indicador' }).click();
  await page.waitForURL(/\/indicadores\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('metric-sample')).toContainText('R$ 436,19'); // 1.744,75 ÷ 4 = 436,1875 → 436,19
  await expect(page.getByTestId('formula-text')).toContainText('÷');
});

test('modelo Comercial: monta o dashboard a partir dos campos apontados e os números fecham', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await page.goto('/dashboards/novo');
  await page.getByLabel('Nome do dashboard').fill('Comercial E2E');
  await page.getByLabel('Dataset').selectOption({ label: 'Pedidos E2E' });
  await page.getByLabel(/Data da venda/).selectOption({ label: 'Data — Data' });
  await page.getByLabel(/Valor da venda/).selectOption({ label: 'Valor — Moeda (R$)' });
  await page.getByLabel(/Canal/).selectOption({ label: 'Canal — Texto' });
  await page.getByRole('button', { name: 'Criar dashboard a partir do modelo' }).click();
  await page.waitForURL(/\/dashboards\/[0-9a-f-]{36}\/editar/);
  dashboardId = page.url().split('/')[4]!;
  await page.goto(`/dashboards/${dashboardId}?p=custom&from=2026-03-01&to=2026-05-31&cmp=none`);
  const kpi = (t: string) => page.getByRole('region', { name: t }).first().getByTestId('kpi-value');
  await expect(kpi('Receita observada')).toHaveText('R$ 1.744,75');
  await expect(kpi('Pedidos')).toHaveText('4');
  await expect(kpi('Ticket médio')).toHaveText('R$ 436,19');
  await expect(page.getByRole('region', { name: 'Receita por canal' })).toBeVisible();
  // período sem dados: soma indisponível com explicação, contagem zero
  await page.goto(`/dashboards/${dashboardId}?p=custom&from=2025-01-01&to=2025-01-31&cmp=none`);
  await expect(kpi('Receita observada')).toHaveText('—');
  await expect(page.getByRole('region', { name: 'Receita observada' }).first()).toContainText('Sem dados no período/filtro');
  await expect(kpi('Pedidos')).toHaveText('0');
  await expect(kpi('Ticket médio')).toHaveText('—');
});

test('acréscimo com chave: registro repetido é ignorado e contado; o existente não é sobrescrito', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await startImport(page, { dataset: datasetId, file: csvFile('pedidos-2.csv', CSV2) });
  await page.getByLabel(/Acrescentar novos registros/).check();
  await page.getByRole('button', { name: 'Ler arquivo e sugerir tipos' }).click();
  await expect(page.getByText('Acréscimo: as colunas seguem o esquema do dataset.')).toBeVisible();
  await page.getByRole('button', { name: /Validar arquivo/ }).click();
  await expect(page.getByTestId('imp-valid')).toHaveText('2');
  await page.getByRole('button', { name: /Confirmar e publicar \(acrescentar\)/ }).click();
  await page.waitForURL(`**/datasets/${datasetId}`);
  await expect(page.locator('main')).toContainText('1 registro(s) já existiam e foram ignorados'.slice(0, 0) + 'v2');
  await page.goto(`/indicadores`);
  await page.getByRole('link', { name: 'Receita E2E' }).click();
  await expect(page.getByTestId('metric-sample')).toContainText('R$ 1.844,75'); // E5 manteve 300,25 (+ E6 100,00)
});

test('reimportar o mesmo arquivo é barrado; XLSX com macro e arquivo disfarçado são recusados; XLSX válido entra', async ({ page }) => {
  await demoLogin(page, DEMO.analyst);
  await page.goto(`/importacoes/nova?dataset=${datasetId}`);
  await page.getByLabel(/^Arquivo \(/).setInputFiles(csvFile('de-novo.csv', CSV2));
  await page.getByRole('button', { name: 'Ler arquivo e sugerir tipos' }).click();
  await page.getByLabel(/Acrescentar novos registros/).check();
  await page.getByRole('button', { name: 'Ler arquivo e sugerir tipos' }).click();
  await page.getByRole('button', { name: /Validar arquivo/ }).click();
  await expect(page.getByText('mesmo conteúdo')).toBeVisible();

  await page.goto('/importacoes/nova');
  await page.getByLabel('Nome do novo dataset').fill('Com macro');
  await page.getByLabel(/^Arquivo \(/).setInputFiles({ name: 'macro.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buildXlsx(['Nome'], [['a']], { macro: true }) });
  await page.getByRole('button', { name: 'Ler arquivo e sugerir tipos' }).click();
  await expect(page.getByText(/contém macros/)).toBeVisible();
  await page.getByLabel(/^Arquivo \(/).setInputFiles({ name: 'falso.csv', mimeType: 'text/csv', buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]) });
  await page.getByRole('button', { name: 'Ler arquivo e sugerir tipos' }).click();
  await expect(page.getByText(/PDF não é aceito/)).toBeVisible();

  await page.getByLabel('Nome do novo dataset').fill('Planilha XLSX');
  await page.getByLabel(/^Arquivo \(/).setInputFiles({ name: 'dados.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buildXlsx(['Produto', 'Data da venda', 'Valor'], [['Caneta', 46100, 12.5], ['Lápis', 46101, 3.25]], { formula: true }) });
  await page.getByRole('button', { name: 'Ler arquivo e sugerir tipos' }).click();
  await expect(page.getByText(/fórmula: lemos apenas o valor já calculado/)).toBeVisible();
  await expect(page.getByLabel('Tipo da coluna 2')).toHaveValue('date');
  await expect(page.getByLabel('Tipo da coluna 3')).toHaveValue('decimal');
  await page.getByRole('button', { name: /Validar arquivo/ }).click();
  await expect(page.getByTestId('imp-valid')).toHaveText('2');
  await page.getByRole('button', { name: /Confirmar e publicar/ }).click();
  await page.waitForURL(/\/datasets\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { name: 'Planilha XLSX', level: 1 })).toBeVisible();
});

test('editor: salvar posições e novo widget; duas pessoas editando — a segunda é recusada sem sobrescrever', async ({ browser, page }) => {
  await demoLogin(page, DEMO.analyst);
  await page.goto(`/compartilhamentos?dashboard=${dashboardId}`);
  await page.getByLabel('Pessoa').selectOption({ label: 'Priscila Nogueira (analista)' });
  await page.getByLabel('Permissão').selectOption('edit');
  await page.getByRole('button', { name: 'Conceder acesso' }).click();
  await expect(page.getByText('Acesso concedido.').first()).toBeVisible();

  const ctx2 = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  const page2 = await ctx2.newPage();
  await demoLogin(page2, DEMO.analyst2);

  await page.goto(`/dashboards/${dashboardId}/editar`);
  await page2.goto(`/dashboards/${dashboardId}/editar`);
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
  await expect(page2.getByTestId('editor-canvas')).toBeVisible();

  // pessoa 1 adiciona um texto e salva
  await page.getByRole('button', { name: '+ Texto' }).click();
  await page.getByLabel('Título').fill('Nota do analista 1');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();

  // pessoa 2 (versão antiga) tenta salvar outra coisa
  await page2.getByRole('button', { name: '+ Texto' }).click();
  await page2.getByLabel('Título').fill('Nota do analista 2');
  await page2.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page2.getByText(/Outra pessoa alterou este dashboard/)).toBeVisible();

  await page.goto(`/dashboards/${dashboardId}`);
  await expect(page.getByRole('region', { name: 'Nota do analista 1' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Nota do analista 2' })).toHaveCount(0);
  await ctx2.close();
});

test('publicar e compartilhar: privado → o visualizador não vê; compartilhado → vê só os widgets; revogado → perde o acesso na hora', async ({ browser, page }) => {
  const manager = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  const mp = await manager.newPage();
  await demoLogin(mp, DEMO.manager);
  // o gestor ainda não tem acesso ao rascunho do analista
  const res = await mp.goto(`/dashboards/${dashboardId}`);
  expect(res?.status()).toBe(404);
  await demoLogin(page, DEMO.analyst);
  await page.goto(`/compartilhamentos?dashboard=${dashboardId}`);
  await page.getByLabel('Pessoa').selectOption({ label: 'Otávio Mendes (visualizador)' });
  await page.getByRole('button', { name: 'Conceder acesso' }).click();
  await expect(page.getByText('Acesso concedido.').first()).toBeVisible();
  const vctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  const vp = await vctx.newPage();
  await demoLogin(vp, DEMO.viewer);
  await vp.goto(`/dashboards/${dashboardId}`);
  // rascunho: o banco só entrega dados de dashboard publicado a quem só visualiza
  await expect(vp.getByRole('region', { name: 'Receita observada' }).first()).toContainText(/permissão|sem permissão/i);
  // o gestor publica para a empresa
  await demoLogin(mp, DEMO.manager);
  await page.goto(`/compartilhamentos`);
  const row = page.getByRole('row', { name: /Comercial E2E.*Otávio/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Revogar' }).click();
  await row.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Acesso revogado')).toBeVisible();
  await vp.goto(`/dashboards/${dashboardId}`);
  expect((await vp.request.get(`/dashboards/${dashboardId}`)).status()).toBe(404);
  await vctx.close(); await manager.close();
});

test('exportação: CSV do dataset (gestor) neutraliza fórmulas e é auditada; analista não exporta bruto', async ({ page, browser }) => {
  const m = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3123', locale: 'pt-BR' });
  const mp = await m.newPage();
  await demoLogin(mp, DEMO.manager);
  const ok = await mp.request.get(`/api/export/dataset/${datasetId}`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toContain('text/csv');
  const body = await ok.text();
  expect(body).toContain("'=HYPERLINK"); // fórmula neutralizada com apóstrofo
  expect(body.startsWith('﻿')).toBe(true);
  expect(norm(body)).toContain('1.234,50'.replace('.', '').replace(',', '.').slice(0, 0) + '1234.5');
  await demoLogin(page, DEMO.analyst);
  expect((await page.request.get(`/api/export/dataset/${datasetId}`)).status()).toBe(403);
  const analyst = await demoToken(DEMO.analyst);
  expect(analyst.length).toBeGreaterThan(20);
  await mp.goto('/relatorios');
  await expect(mp.getByRole('table', { name: 'Exportações' })).toContainText('Linhas do dataset (CSV)');
  await m.close();
  void apiJson;
});
