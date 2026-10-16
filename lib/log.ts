// Logs estruturados SEM PII/segredos (LGPD art. 6º, III e art. 46). Campos sensíveis são mascarados.
const SENSITIVE = /pass|senha|token|secret|authorization|cookie|api[-_]?key|e-?mail|cpf|cnpj|phone|telefone|nome|name|address|endere|code|otp|jwt/i;
const MAX_STRING = 300;
const MAX_DEPTH = 4;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return { name: value.name };
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

type Level = 'info' | 'warn' | 'error';

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}, requestId?: string) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, requestId, ...(redact(fields) as object) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}
