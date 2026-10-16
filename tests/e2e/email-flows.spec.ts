import { expect, test } from '@playwright/test';
import { PASSWORD, apiSignUp, uiLogin, uniqueEmail, waitForAuthLink } from './helpers';

// Fluxos que dependem de e-mail, lendo a mensagem real no servidor de e-mail local (Mailpit).
test.describe.configure({ mode: 'serial' });

const NEW_PASSWORD = 'outra frase longa e segura 2027';

test('cadastro: o e-mail de confirmação chega e o link ativa a conta', async ({ page }) => {
  const email = uniqueEmail('confirma');
  await page.goto('/signup');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmar senha').fill(PASSWORD);
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText(/Se o cadastro for possível/)).toBeVisible();

  // Antes de confirmar, o login não funciona.
  await uiLogin(page, email);
  await expect(page.getByText('E-mail ou senha inválidos.', { exact: true })).toBeVisible();

  // O link do e-mail confirma e já entra no app.
  const link = await waitForAuthLink(email, 'signup');
  await page.goto(link);
  await page.waitForURL('**/onboarding');
});

test('recuperação de senha: e-mail, link, nova senha; a antiga deixa de valer', async ({ page }) => {
  const email = uniqueEmail('recupera');
  await apiSignUp(email);

  await page.goto('/forgot-password');
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Enviar instruções' }).click();
  await expect(page.getByText(/Se o e-mail estiver cadastrado/)).toBeVisible();

  const link = await waitForAuthLink(email, 'recovery');
  await page.goto(link);
  await page.waitForURL('**/reset-password');
  await page.getByLabel('Nova senha', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirmar nova senha').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Redefinir senha' }).click();
  await page.waitForURL('**/onboarding');

  await page.context().clearCookies();
  await uiLogin(page, email, PASSWORD);
  await expect(page.getByText('E-mail ou senha inválidos.', { exact: true })).toBeVisible();
  await uiLogin(page, email, NEW_PASSWORD);
  await page.waitForURL('**/onboarding');
});

test('o link de recuperação é de uso único e links inválidos são recusados', async ({ page }) => {
  const email = uniqueEmail('umavez');
  await apiSignUp(email);
  await page.goto('/forgot-password');
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Enviar instruções' }).click();
  const link = await waitForAuthLink(email, 'recovery');

  await page.goto(link);
  await page.waitForURL('**/reset-password');
  await page.context().clearCookies();
  await page.goto(link); // segunda vez: o token já foi usado
  await page.waitForURL(/\/login\?error=link_invalido/);
  await expect(page.getByText('O link é inválido ou expirou.')).toBeVisible();

  await page.goto('/auth/confirm?token_hash=lixo&type=recovery');
  await page.waitForURL(/\/login\?error=link_invalido/);
});
