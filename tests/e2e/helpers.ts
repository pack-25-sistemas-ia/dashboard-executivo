import { createHmac, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? '';
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:58324';
export const PASSWORD = 'uma frase longa e segura 2026';

export function uniqueEmail(tag: string): string {
  return `e2e.${tag}.${randomBytes(4).toString('hex')}@example.test`;
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error('segredo TOTP inválido');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** TOTP RFC 6238 (SHA-1, 30 s, 6 dígitos), igual ao de um aplicativo autenticador. */
export function totp(secret: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const code = ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

/** Espera o e-mail chegar no Mailpit (servidor de e-mail local) e devolve o link de confirmação do app. */
export async function waitForAuthLink(to: string, type: 'signup' | 'recovery' | 'invite', timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const list = (await res.json()) as { messages?: Array<{ ID: string }> };
    for (const m of list.messages ?? []) {
      const msg = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${m.ID}`)).json()) as { HTML?: string; Text?: string };
      const body = [msg.HTML ?? '', msg.Text ?? ''].join('\n');
      const urls = body.match(/https?:\/\/[^\s"'<>]*\/auth\/confirm\?[^\s"'<>]*/g) ?? [];
      const match = urls.map((u) => u.replaceAll('&amp;', '&')).find((u) => u.includes(`type=${type}`));
      if (match) return match;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`e-mail ${type} para ${to} não chegou`);
}

/** Cria um usuário direto no GoTrue e confirma o e-mail pelo link recebido (confirmação ligada, como em produção). */
export async function apiSignUp(email: string, password = PASSWORD): Promise<{ id: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`signup falhou: ${res.status}`);
  const body = (await res.json()) as { user?: { id: string }; id?: string };
  const link = await waitForAuthLink(email, 'signup');
  // O link aponta para o app (APP_URL); consome o token por GET direto no GoTrue equivalente via app.
  await fetch(link, { redirect: 'manual' });
  return { id: (body.user?.id ?? body.id) as string };
}

export async function apiLogin(email: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login falhou: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function uiLogin(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Cria a organização no onboarding e conclui o cadastro obrigatório de MFA. Retorna o segredo TOTP. */
export async function onboardAndEnrollMfa(page: Page, orgName: string): Promise<string> {
  await page.waitForURL('**/onboarding');
  await page.getByLabel('Nome da empresa').fill(orgName);
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await page.waitForURL('**/mfa/enroll?required=1');
  await page.getByRole('button', { name: 'Gerar QR Code' }).click();
  const secret = (await page.locator('code').first().innerText()).trim();
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Painel' })).toBeVisible();
  return secret;
}

export async function loginWithMfa(page: Page, email: string, secret: string) {
  await uiLogin(page, email);
  await page.waitForURL('**/mfa/verify');
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await page.waitForURL('**/dashboard');
}

/** Chamada REST (PostgREST) autenticada como o usuário, para preparar cenários de papel. */
export async function rest(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation', ...init.headers },
  });
}

/** Eleva um token AAL1 para AAL2 verificando o TOTP direto no GoTrue (como um cliente de API faria). */
export async function apiAal2Token(token: string, secret: string): Promise<string> {
  const headers = { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const user = (await (await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers })).json()) as { factors?: Array<{ id: string; status: string }> };
  const factor = user.factors?.find((f) => f.status === 'verified');
  if (!factor) throw new Error('usuário sem fator TOTP verificado');
  const challenge = (await (await fetch(`${SUPABASE_URL}/auth/v1/factors/${factor.id}/challenge`, { method: 'POST', headers })).json()) as { id: string };
  const res = await fetch(`${SUPABASE_URL}/auth/v1/factors/${factor.id}/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ challenge_id: challenge.id, code: totp(secret) }),
  });
  if (!res.ok) throw new Error(`verificação MFA via API falhou: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}
