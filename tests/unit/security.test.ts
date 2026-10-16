import { beforeEach, describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/security/redirect';
import { buildCsp } from '@/lib/security/csp';
import { isPublicPath } from '@/lib/security/paths';
import { rateLimit, resetRateLimits } from '@/lib/security/rate-limit';
import { redact } from '@/lib/log';
import { parsePublicEnv } from '@/lib/env';
import { slugify } from '@/lib/utils';

describe('safeNext (anti open-redirect)', () => {
  it('aceita caminhos internos', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard');
    expect(safeNext('/members?x=1')).toBe('/members?x=1');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%2F/evil.example',
    '/%2f%2fevil.example',
    'javascript:alert(1)',
    '/\u0000x',
    '/a\\b',
    '',
    'dashboard',
    '/' + 'a'.repeat(300),
    '/%E0%A4%A',
  ])('rejeita %j', (input) => {
    expect(safeNext(input)).toBe('/dashboard');
  });

  it('trata null/undefined e respeita o fallback', () => {
    expect(safeNext(null)).toBe('/dashboard');
    expect(safeNext(undefined, '/x')).toBe('/x');
  });
});

describe('CSP', () => {
  const prod = buildCsp({ nonce: 'abc123', dev: false, upgradeInsecure: true });
  it('em produção: nonce, strict-dynamic, sem unsafe-eval/inline', () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain('unsafe-eval');
    expect(prod).not.toContain('unsafe-inline');
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("connect-src 'self'");
    expect(prod).toContain('upgrade-insecure-requests');
  });
  it('em dev permite eval apenas para o React', () => {
    expect(buildCsp({ nonce: 'n', dev: true, upgradeInsecure: false })).toContain("'unsafe-eval'");
  });
  it('não força https quando a URL não é https', () => {
    expect(buildCsp({ nonce: 'n', dev: false, upgradeInsecure: false })).not.toContain('upgrade-insecure-requests');
  });
});

describe('rotas públicas', () => {
  it('só as de autenticação são públicas', () => {
    for (const p of ['/login', '/signup', '/forgot-password', '/auth/confirm']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/', '/dashboard', '/members', '/settings', '/audit', '/privacy', '/login/x', '/mfa/verify', '/reset-password'])
      expect(isPublicPath(p)).toBe(false);
  });
});

describe('rateLimit', () => {
  beforeEach(() => resetRateLimits());
  it('bloqueia após o limite e libera após a janela', () => {
    const rule = { limit: 3, windowMs: 1000 };
    expect(rateLimit('k', rule, 0).allowed).toBe(true);
    expect(rateLimit('k', rule, 1).allowed).toBe(true);
    expect(rateLimit('k', rule, 2).allowed).toBe(true);
    const blocked = rateLimit('k', rule, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(rateLimit('k', rule, 1001).allowed).toBe(true);
  });
  it('isola chaves diferentes', () => {
    const rule = { limit: 1, windowMs: 1000 };
    expect(rateLimit('a', rule, 0).allowed).toBe(true);
    expect(rateLimit('b', rule, 0).allowed).toBe(true);
    expect(rateLimit('a', rule, 1).allowed).toBe(false);
  });
});

describe('redact (logs sem PII)', () => {
  it('mascara campos sensíveis, inclusive aninhados', () => {
    const out = redact({
      email: 'a@b.com', password: 'x', user: { token: 't', nome: 'Maria', id: '123' }, status: 'ok',
      headers: { authorization: 'Bearer abc', cookie: 'sb=1' }, otp_code: '123456',
    }) as Record<string, unknown>;
    const text = JSON.stringify(out);
    for (const secret of ['a@b.com', 'Maria', 'Bearer abc', 'sb=1', '123456']) expect(text).not.toContain(secret);
    expect(out.status).toBe('ok');
    expect((out.user as Record<string, unknown>).id).toBe('123');
  });
  it('não vaza a mensagem de erros e trunca strings longas', () => {
    expect(JSON.stringify(redact({ err: new Error('falha com a@b.com') }))).not.toContain('a@b.com');
    expect(String(redact('x'.repeat(1000))).length).toBeLessThan(400);
  });
});

describe('parsePublicEnv', () => {
  const ok = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(30), NEXT_PUBLIC_APP_URL: 'https://app.example.com' };
  it('aceita configuração válida e http apenas em localhost', () => {
    expect(parsePublicEnv(ok).NEXT_PUBLIC_SUPABASE_URL).toBe('https://x.supabase.co');
    expect(() => parsePublicEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })).not.toThrow();
  });
  it('rejeita http público, chave curta e ausências sem ecoar valores', () => {
    expect(() => parsePublicEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: 'http://evil.example.com' })).toThrow(/https/);
    expect(() => parsePublicEnv({ ...ok, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'curta' })).toThrow();
    expect(() => parsePublicEnv({})).toThrow(/Configuração inválida/);
    try { parsePublicEnv({ ...ok, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'segredo-curto' }); } catch (e) { expect(String(e)).not.toContain('segredo-curto'); }
  });
});

describe('slugify', () => {
  it('normaliza acentos e símbolos', () => {
    expect(slugify('Açaí & Cia. Ltda!')).toBe('acai-cia-ltda');
    expect(slugify('   ')).toBe('org');
    expect(slugify('ÁÉÍ'.repeat(40)).length).toBeLessThanOrEqual(48);
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });
});

describe('tema da organização', () => {
  it('só aceita #RRGGBB e escolhe texto legível (WCAG)', async () => {
    const { safePrimary, readableOn } = await import('@/lib/utils');
    expect(safePrimary('#ABCDEF')).toBe('#abcdef');
    for (const bad of ['red', '#12345', 'url(x)', '#0B1220;}body{', null, undefined, 42]) expect(safePrimary(bad)).toBe('#162a43');
    expect(readableOn('#ffffff')).toBe('#0b1220');
    expect(readableOn('#000000')).toBe('#ffffff');
    expect(readableOn('#162a43')).toBe('#ffffff');
    expect(readableOn('#22d3ee')).toBe('#0b1220');
  });
});

describe('tema servido como CSS do próprio domínio', () => {
  it('gera variáveis só a partir de uma cor validada', async () => {
    const { themeCss, themeParam } = await import('@/lib/theme');
    expect(themeCss('#AA2244')).toBe(':root:root{--primary:#aa2244;--primary-foreground:#ffffff}');
    expect(themeParam('#AA2244')).toBe('aa2244');
    // entradas maliciosas nunca chegam ao CSS
    for (const bad of ['red', '#12345', 'url(javascript:x)', '#0B1220;}body{display:none}', '</style><script>', null, undefined]) {
      expect(themeCss(bad)).toBe(':root:root{--primary:#162a43;--primary-foreground:#ffffff}');
    }
  });
});
