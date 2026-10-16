import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export function formatDateTime(value: string | Date): string {
  return dateFormatter.format(typeof value === 'string' ? new Date(value) : value);
}

const DEFAULT_PRIMARY = '#162a43';

/** Cor primária segura (#RRGGBB) vinda do tema da organização; qualquer outra coisa cai no padrão. */
export function safePrimary(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : DEFAULT_PRIMARY;
}

/** Cor de texto (branco/preto) com melhor contraste sobre a cor informada (WCAG, luminância relativa). */
export function readableOn(hex: string): '#ffffff' | '#0b1220' {
  const n = Number.parseInt(safePrimary(hex).slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastDark = (l + 0.05) / (0.0066 + 0.05);
  return contrastWhite >= contrastDark ? '#ffffff' : '#0b1220';
}

/** Gera um slug seguro (a-z, 0-9, hífen) a partir de um nome, sem acentos. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return base || 'org';
}
