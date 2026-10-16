import { expect, test } from '@playwright/test';
import { BASE_URL, PASSWORD, apiAal2Token, apiLogin, apiSignUp, onboardAndEnrollMfa, rest, uiLogin, uniqueEmail } from './helpers';

test.describe.configure({ mode: 'serial' });

test('cabeçalhos de segurança, CSP com nonce e nenhuma violação de CSP no navegador', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text());
  });

  const res = await page.goto('/login');
  const h = res!.headers();
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).not.toContain('unsafe-inline');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['strict-transport-security']).toContain('max-age=');
  expect(h['x-powered-by']).toBeUndefined();

  // A página hidrata (o script com nonce executa): o formulário reage ao envio vazio.
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Verifique os campos.')).toBeVisible();
  expect(violations).toEqual([]);
});

test('rotas protegidas redirecionam e o redirecionamento aberto é neutralizado', async ({ page }) => {
  await page.goto('/members');
  await page.waitForURL(/\/login\?next=%2Fmembers/);

  const email = uniqueEmail('redir');
  await apiSignUp(email);
  for (const evil of ['https://evil.example/', '//evil.example', '/\\evil.example']) {
    await page.goto(`/login?next=${encodeURIComponent(evil)}`);
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/onboarding'); // sem organização ainda; destino é interno
    expect(new URL(page.url()).hostname).toBe('localhost');
    await page.context().clearCookies();
  }
});

test('login com e-mail inexistente e com senha errada têm a mesma mensagem', async ({ page }) => {
  const email = uniqueEmail('enum');
  await apiSignUp(email);

  const message = page.getByText('E-mail ou senha inválidos.', { exact: true });
  await uiLogin(page, email, 'senha errada muito longa');
  await expect(message).toBeVisible();
  await uiLogin(page, uniqueEmail('naoexiste'), 'senha errada muito longa');
  await expect(message).toBeVisible();
  // A mesma mensagem nos dois casos: o login não revela se o e-mail existe.
});

test('isolamento entre organizações, cookie adulterado e papéis aplicados no servidor', async ({ browser }) => {
  const emailA = uniqueEmail('orga');
  const emailB = uniqueEmail('orgb');
  await apiSignUp(emailA);
  const b = await apiSignUp(emailB);

  // Usuário A cria org A e segredo MFA.
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await uiLogin(pageA, emailA);
  const secretA = await onboardAndEnrollMfa(pageA, 'Org A Isolada');
  const cookiesA = await ctxA.cookies();
  const orgA = cookiesA.find((c) => c.name === 'pack25_org')!.value;

  // Usuário B cria org B.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await uiLogin(pageB, emailB);
  await onboardAndEnrollMfa(pageB, 'Org B Isolada');
  const orgB = (await ctxB.cookies()).find((c) => c.name === 'pack25_org')!.value;
  expect(orgA).not.toBe(orgB);

  // 1) B adultera o cookie para apontar para a org A: o servidor ignora e mantém a org B.
  await ctxB.addCookies([{ name: 'pack25_org', value: orgA, url: BASE_URL, httpOnly: true, sameSite: 'Lax' }]);
  await pageB.goto('/dashboard');
  await expect(pageB.getByText('Org B Isolada').first()).toBeVisible();
  await expect(pageB.getByText('Org A Isolada')).toHaveCount(0);
  await pageB.goto('/members');
  await expect(pageB.getByText(emailA)).toHaveCount(0);

  // 2) A (proprietário) adiciona B como "viewer" da org A pela API (RLS permite ao owner).
  const tokenA1 = await apiLogin(emailA);
  // Sem segundo fator, o banco recusa a escrita do proprietário, mesmo chamando a API REST direto.
  const blocked = await rest(tokenA1, `organization_settings?organization_id=eq.${orgA}`, { method: 'PATCH', body: JSON.stringify({ display_name: 'Sem MFA' }) });
  expect(await blocked.json()).toEqual([]);
  const blockedAudit = await rest(tokenA1, `audit_log?organization_id=eq.${orgA}&select=id`);
  expect(await blockedAudit.json()).toEqual([]);
  // Com o segundo fator verificado (AAL2) a mesma operação funciona.
  const tokenA = await apiAal2Token(tokenA1, secretA);
  const add = await rest(tokenA, 'organization_members', { method: 'POST', body: JSON.stringify({ organization_id: orgA, user_id: b.id, role: 'viewer' }) });
  expect(add.status).toBe(201);

  // 3) B agora tem duas organizações; troca para A como "viewer".
  await pageB.goto('/dashboard');
  await pageB.getByLabel('Organização').selectOption(orgA);
  await pageB.getByRole('button', { name: 'Trocar' }).click();
  await pageB.waitForURL('**/dashboard');
  await expect(pageB.getByText('Leitor').first()).toBeVisible();

  // Como leitor: páginas administrativas respondem 404 no SERVIDOR; sem e-mails de colegas; sem LGPD/auditoria.
  for (const path of ['/settings', '/audit', '/privacy']) {
    const res = await pageB.goto(path);
    expect(res!.status(), path).toBe(404);
    await expect(pageB.getByText('Página não encontrada'), path).toBeVisible();
    await expect(pageB.getByRole('button', { name: /Salvar configurações|Registrar solicitação/ }), path).toHaveCount(0);
  }
  await pageB.goto('/members');
  await expect(pageB.getByText(emailA)).toHaveCount(0);
  await expect(pageB.getByRole('button', { name: 'Remover' })).toHaveCount(0);

  // 4) B tenta escalar o próprio papel direto na API: o banco nega (nenhuma linha afetada).
  const tokenB = await apiLogin(emailB);
  const escalate = await rest(tokenB, `organization_members?organization_id=eq.${orgA}&user_id=eq.${b.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'owner' }) });
  expect(await escalate.json()).toEqual([]);
  const readAudit = await rest(tokenB, `audit_log?organization_id=eq.${orgA}&select=id`);
  expect(await readAudit.json()).toEqual([]);

  // 5) B (leitor de A) continua sem enxergar dados da org A que exigem papel.
  const readPrivacy = await rest(tokenB, `privacy_requests?organization_id=eq.${orgA}&select=id`);
  expect(await readPrivacy.json()).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});

test('nenhuma página autenticada viola a CSP (estilos e scripts em linha)', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text().slice(0, 160));
  });
  const email = uniqueEmail('csp');
  await apiSignUp(email);
  await uiLogin(page, email);
  await onboardAndEnrollMfa(page, 'Empresa CSP');
  for (const path of ['/dashboard', '/members', '/settings', '/audit', '/privacy']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(violations).toEqual([]);
});
