import { themeCss } from '@/lib/theme';

// Tema (cor primária) da organização como CSS. A cor vem na URL e é validada (#RRGGBB); qualquer outro
// valor cai no padrão. Como o conteúdo depende só do parâmetro, é imutável e pode ser cacheado para sempre.
export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('c') ?? '';
  const css = themeCss(/^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}` : null);
  return new Response(css, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
