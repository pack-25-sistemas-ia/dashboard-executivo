const FALLBACK = '/dashboard';

/**
 * Aceita apenas caminhos relativos internos (anti open-redirect).
 * Rejeita: URL absoluta, "//host", "/\\host", esquemas, caracteres de controle e valores longos.
 */
export function safeNext(next: string | null | undefined, fallback: string = FALLBACK): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 200) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  if (decoded.startsWith('//') || /^\/+[a-z][a-z0-9+.-]*:/i.test(decoded)) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return fallback;
  return next;
}
