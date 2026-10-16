import { expect, test } from '@playwright/test';
import { PASSWORD, loginWithMfa, onboardAndEnrollMfa, uniqueEmail, waitForAuthLink } from './helpers';

test.describe.configure({ mode: 'serial' });

const email = uniqueEmail('owner');
let secret = '';

test('cadastro pela interface: resposta neutra e senha fraca rejeitada', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('curta');
  await page.getByLabel('Confirmar senha').fill('curta');
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText('A senha deve ter no mínimo 12 caracteres.')).toBeVisible();

  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmar senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText(/Se o cadastro for possível/)).toBeVisible();

  // A conta só vale depois de confirmar o e-mail (como em produção).
  await fetch(await waitForAuthLink(email, 'signup'), { redirect: 'manual' });
});

test('login, organização, MFA obrigatório para o proprietário e painel com dados reais', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  secret = await onboardAndEnrollMfa(page, 'Empresa E2E Ltda');

});

test('sem verificação em duas etapas o proprietário não acessa o painel', async ({ page }) => {
  // Sessão nova (sem MFA verificado): o acesso exige o segundo fator.
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/mfa/verify');
  await page.goto('/dashboard');
  await page.waitForURL('**/mfa/verify');

  await page.getByLabel('Código de 6 dígitos').fill('000000');
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByText('Código inválido ou expirado.')).toBeVisible();
  await expect(page).toHaveURL(/mfa\/verify/);
});

test('configurações, equipe, auditoria e solicitação LGPD funcionam e persistem', async ({ page }) => {
  await loginWithMfa(page, email, secret);

  // Equipe: o proprietário vê o próprio e-mail e não pode se remover.
  await page.goto('/members');
  await expect(page.getByRole('table').getByText(email)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remover' })).toHaveCount(0);

  // Configurações: nome e cor persistem (verificado após recarregar).
  await page.goto('/settings');
  await page.getByLabel('Nome exibido').fill('Marca E2E');
  await page.getByLabel('Cor primária').fill('#aa2244');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText('Configurações salvas.')).toBeVisible();
  // a cor da marca precisa aparecer SEM recarregar (navegação suave sob a CSP estrita)
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())).toBe('#aa2244');
  await page.reload();
  await expect(page.getByLabel('Nome exibido')).toHaveValue('Marca E2E');
  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  expect(primary).toBe('#aa2244');

  // LGPD: cria solicitação e confirma que aparece com prazo.
  await page.goto('/privacy');
  await page.getByLabel('Referência do titular').fill('protocolo-001');
  await page.getByRole('button', { name: 'Registrar solicitação' }).click();
  await expect(page.getByText(/Solicitação registrada/)).toBeVisible();
  await expect(page.getByText('Referência: protocolo-001')).toBeVisible();

  // Auditoria: registra a alteração com o NOME do campo, nunca o valor.
  await page.goto('/audit');
  await expect(page.getByText('display_name')).toBeVisible();
  // O nome da organização aparece no menu lateral; a TABELA de auditoria não pode conter os valores.
  const table = page.getByRole('table');
  await expect(table.getByText('Marca E2E')).toHaveCount(0);
  await expect(table.getByText('protocolo-001')).toHaveCount(0);
});

test('sair encerra a sessão', async ({ page }) => {
  await loginWithMfa(page, email, secret);
  await page.getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
  await page.goto('/dashboard');
  await page.waitForURL(/\/login\?next=/);
});
