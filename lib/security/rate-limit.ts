// Limitador em memória (janela fixa). Defesa em profundidade para ações de autenticação.
// LIMITAÇÃO CONHECIDA: o estado é por instância (não compartilhado entre réplicas/serverless).
// A proteção principal é o rate limit do Supabase Auth; um limitador no banco entra no próximo marco.
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export type RateLimitRule = { limit: number; windowMs: number };
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function rateLimit(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
  if (buckets.size > MAX_KEYS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_KEYS) buckets.clear();
  }
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count > rule.limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}

export const AUTH_LIMITS = {
  login: { limit: 8, windowMs: 10 * 60_000 },
  signup: { limit: 5, windowMs: 60 * 60_000 },
  recovery: { limit: 5, windowMs: 60 * 60_000 },
  mfa: { limit: 10, windowMs: 10 * 60_000 },
} satisfies Record<string, RateLimitRule>;
