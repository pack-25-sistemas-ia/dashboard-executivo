import { strToU8, zipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { ANON_KEY, SUPABASE_URL, apiLogin } from './helpers';

export const DEMO_PASSWORD = 'DemoLocal#2026';
export const DEMO = { owner: 'dono@demo.exemplo', manager: 'gestor@demo.exemplo', analyst: 'analista@demo.exemplo', viewer: 'consulta@demo.exemplo', analyst2: 'analista2@demo.exemplo' };

export const norm = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const sessions = new Map<string, Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>>();

/**
 * Login por e-mail/senha pela interface (usuários sem MFA obrigatório). O limitador de login do app barra logins repetidos da mesma conta,
 * então a sessão é reaproveitada (cookies) nos testes seguintes do mesmo processo.
 */
export async function demoLogin(page: Page, email: string) {
  const cached = sessions.get(email);
  if (cached) {
    await page.context().addCookies(cached);
    await page.goto('/inicio');
    if (!page.url().includes('/login')) return;
  }
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/dashboard');
  sessions.set(email, await page.context().cookies());
}
export const demoToken = (email: string) => apiLogin(email, DEMO_PASSWORD);

export async function api(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) } });
}
export async function apiJson<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(token, path, init);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
export const rpc = (token: string, fn: string, body: Record<string, unknown>) => api(token, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });

export async function expectNoServerError(page: Page, label: string) {
  await expect(page.locator('body'), `${label}: sem tela de erro`).not.toContainText(/Algo deu errado|Application error|Internal Server Error/);
}

/** BRL como o app mostra. */
export const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n).replace(/ /g, ' ');

/** XLSX mínimo válido (texto em shared strings, números nativos, data com estilo). */
export function buildXlsx(header: string[], rows: Array<Array<string | number>>, opts: { macro?: boolean; formula?: boolean } = {}): Buffer {
  const strings: string[] = [];
  const sid = (s: string) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1; } return i; };
  const colL = (i: number) => String.fromCharCode(65 + i);
  const cell = (v: string | number, r: number, c: number, isDate = false) => {
    const ref = `${colL(c)}${r}`;
    return typeof v === 'number' ? `<c r="${ref}"${isDate ? ' s="1"' : ''}><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${sid(v)}</v></c>`;
  };
  const sheetRows = [header, ...rows].map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => cell(v, ri + 1, ci, ri > 0 && typeof v === 'number' && header[ci]?.toLowerCase().includes('data'))).join('')}${opts.formula && ri === 1 ? `<c r="${colL(row.length)}2"><f>1+1</f><v>2</v></c>` : ''}</row>`).join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/styles.xml': strToU8('<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  };
  files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`);
  if (opts.macro) files['xl/vbaProject.bin'] = strToU8('MZ');
  return Buffer.from(zipSync(files));
}
