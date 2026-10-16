import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEMO, demoLogin } from './bi-helpers';

// Acessibilidade estrutural, responsividade (celular), teclado e tema escuro nas telas com dados de demonstração.
test.describe.configure({ mode: 'serial' });

const PAGES = ['/inicio', '/dashboards', '/dashboards/novo', '/metas', '/datasets', '/importacoes', '/importacoes/nova', '/explorador', '/indicadores', '/indicadores/novo', '/relatorios', '/compartilhamentos', '/qualidade', '/notificacoes'];

/** Verificações estruturais (WCAG 2.2 AA em parte): ids únicos, um <main>, um h1, controles com nome e tabelas com legenda. */
async function structural(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const ids = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((e) => ids.set(e.id, (ids.get(e.id) ?? 0) + 1));
    for (const [id, n] of ids) if (n > 1) out.push(`id repetido «${id}» (${n}x)`);
    if (document.querySelectorAll('main').length !== 1) out.push('deve haver exatamente um <main>');
    if (document.querySelectorAll('h1').length !== 1) out.push(`h1: ${document.querySelectorAll('h1').length}`);
    if (!document.documentElement.lang) out.push('<html> sem lang');
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      const i = el as HTMLInputElement;
      if (i.type === 'hidden' || i.type === 'submit') return;
      const named = (i.labels && i.labels.length > 0) || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || i.title;
      if (!named) out.push(`controle sem nome acessível: <${el.tagName.toLowerCase()} name="${i.name}">`);
    });
    document.querySelectorAll('button, a[href]').forEach((el) => {
      const t = (el.textContent ?? '').trim();
      if (!t && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.querySelector('img[alt]')) out.push(`${el.tagName.toLowerCase()} sem texto/nome: ${(el.getAttribute('href') ?? '').slice(0, 40)}`);
    });
    document.querySelectorAll('img').forEach((el) => { if (!el.hasAttribute('alt')) out.push('img sem alt'); });
    document.querySelectorAll('table:not([hidden])').forEach((el) => { if (!el.querySelector('caption')) out.push('tabela sem caption'); });
    document.querySelectorAll('details > summary').forEach((el) => { if (!(el.textContent ?? '').trim()) out.push('summary vazio'); });
    return out;
  });
}

test('acessibilidade estrutural: todas as telas principais', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  for (const path of PAGES) {
    await page.goto(path);
    const problems = await structural(page);
    expect(problems, `${path}: ${problems.join(' | ')}`).toEqual([]);
  }
  // visão do dashboard (com gráficos e tabelas alternativas) e o editor
  await page.goto('/dashboards');
  await page.getByRole('link', { name: /Comercial/ }).first().click();
  await expect(page.getByTestId('dashboard-grid')).toBeVisible();
  await page.waitForTimeout(1500);
  const view = await structural(page);
  expect(view, `dashboard: ${view.join(' | ')}`).toEqual([]);
  await page.getByRole('link', { name: 'Editar layout' }).click();
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
  await expect(page.getByTestId('editor-widget').first()).toBeVisible();
  const ed = await structural(page);
  expect(ed, `editor: ${ed.join(' | ')}`).toEqual([]);
});

test('teclado: «Ir para o conteúdo» é o primeiro foco; campos têm foco visível', async ({ page }) => {
  await demoLogin(page, DEMO.manager);
  await page.goto('/dashboards');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Ir para o conteúdo' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#conteudo$/);
  await page.goto('/indicadores/novo');
  const campo = page.getByLabel('Nome do indicador');
  await campo.focus();
  const outline = await campo.evaluate((e) => { const st = getComputedStyle(e); return `${st.outlineStyle}|${st.outlineWidth}|${st.boxShadow}`; });
  expect(outline).not.toBe('none|0px|none');
});

test.describe('celular (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('sem rolagem horizontal da página; tabelas rolam dentro do próprio quadro', async ({ page }) => {
    await demoLogin(page, DEMO.manager);
    for (const path of PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path}: a página rolou ${overflow}px na horizontal`).toBeLessThanOrEqual(1);
    }
  });

  test('dashboard no celular: uma coluna, filtros acessíveis e alvo de toque adequado', async ({ page }) => {
    await demoLogin(page, DEMO.analyst);
    await page.goto('/dashboards');
    await page.getByRole('link', { name: /Comercial/ }).first().click();
    await expect(page.getByTestId('dashboard-grid')).toBeVisible();
    const widths = await page.locator('[data-widget-id]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(new Set(widths).size, 'no celular todos os widgets ocupam a largura toda').toBe(1);
    const h = await page.getByRole('button', { name: 'Aplicar' }).evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(40);
    await expect(page.getByRole('region', { name: 'Faturamento' }).first().getByTestId('kpi-value')).toBeVisible();
  });
});

test.describe('tema escuro', () => {
  test.use({ colorScheme: 'dark' });
  test('o painel respeita o tema escuro e o texto continua legível', async ({ page }) => {
    await demoLogin(page, DEMO.manager);
    await page.goto('/inicio');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const fg = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(bg).not.toBe(fg);
    const lum = (rgb: string) => { const m = rgb.match(/\d+/g)!.map(Number); return (0.2126 * m[0]! + 0.7152 * m[1]! + 0.0722 * m[2]!) / 255; };
    expect(Math.abs(lum(bg) - lum(fg))).toBeGreaterThan(0.5);
  });
});

test('capturas de tela para a documentação (opcional: E2E_SHOTS=1)', async ({ page }) => {
  test.skip(!process.env.E2E_SHOTS, 'defina E2E_SHOTS=1 para gerar docs/screenshots');
  mkdirSync('docs/screenshots', { recursive: true });
  await demoLogin(page, DEMO.manager);
  await page.setViewportSize({ width: 1366, height: 900 });
  const alvo: Array<[string, string]> = [
    ['inicio', '/inicio'], ['dashboards', '/dashboards'], ['datasets', '/datasets'], ['importacao', '/importacoes/nova'], ['indicadores', '/indicadores'], ['metas', '/metas'], ['qualidade', '/qualidade'], ['relatorios', '/relatorios'],
  ];
  await page.goto('/dashboards');
  await page.getByRole('link', { name: /Comercial/ }).first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'docs/screenshots/dashboard-comercial.png', fullPage: true });
  for (const [name, path] of alvo) {
    await page.goto(path);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: name === 'inicio' });
  }
});
