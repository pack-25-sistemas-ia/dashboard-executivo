import { readableOn, safePrimary } from '@/lib/utils';

/**
 * CSS do tema da organização (white-label). Servido por /theme.css?c=RRGGBB, uma folha de estilo do
 * próprio domínio: a CSP (`style-src 'self'`) a aceita em qualquer navegação, sem nonce.
 * (Uma tag <style> com nonce falha em navegações suaves, porque o nonce muda a cada requisição.)
 * `:root:root` tem especificidade maior que o `:root` do globals.css, então vence em qualquer ordem.
 */
export function themeCss(hex: unknown): string {
  const primary = safePrimary(hex);
  return `:root:root{--primary:${primary};--primary-foreground:${readableOn(primary)}}`;
}

/** Valor do parâmetro `c` (6 dígitos hex, sem #) a partir da cor do tema. */
export function themeParam(hex: unknown): string {
  return safePrimary(hex).slice(1);
}
