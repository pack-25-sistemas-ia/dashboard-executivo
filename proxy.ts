import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getPublicEnv } from '@/lib/env';
import { buildCsp } from '@/lib/security/csp';
import { isPublicPath } from '@/lib/security/paths';
import { safeNext } from '@/lib/security/redirect';

// Proxy (antigo middleware): CSP com nonce, renovação da sessão e redirecionamento de UX.
// NÃO é a barreira de segurança: toda página/ação revalida sessão, papel e propriedade
// (lib/auth/session.ts) e o banco aplica RLS. Ver docs/SECURITY_STANDARD.md §3.
export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const env = getPublicEnv();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    upgradeInsecure: env.NEXT_PUBLIC_APP_URL.startsWith('https://'),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        requestHeaders.set('cookie', request.headers.get('cookie') ?? '');
        response = NextResponse.next({ request: { headers: requestHeaders } });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims valida a assinatura do JWT e renova o token quando necessário.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  if (!signedIn && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    const target = safeNext(request.nextUrl.pathname + request.nextUrl.search);
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(target)}`;
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    redirect.headers.set('content-security-policy', csp);
    return redirect;
  }

  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
