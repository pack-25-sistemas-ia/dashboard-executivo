// Content-Security-Policy estrita com nonce por requisição (padrão oficial do Next.js).
// connect-src 'self': o navegador nunca fala direto com o Supabase; todo acesso é server-side.
export type CspOptions = { nonce: string; dev: boolean; upgradeInsecure: boolean };

export function buildCsp({ nonce, dev, upgradeInsecure }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
