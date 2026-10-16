import type { NextConfig } from 'next';

// Cabeçalhos estáticos. A CSP com nonce é gerada por requisição em proxy.ts.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Importação de planilhas (CSV/XLSX até 20 MB) passa por Server Actions: eleva os limites padrão (o limite real é conferido no servidor).
  experimental: { proxyClientMaxBodySize: '26mb', serverActions: { bodySizeLimit: '24mb' } },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
