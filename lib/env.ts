import { z } from 'zod';

// Validação das variáveis de ambiente. Falha cedo e com mensagem clara, sem ecoar valores.
// O Core web NÃO lê service_role: todo acesso a dados passa pelo RLS com a sessão do usuário.
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

const secureUrl = (label: string) =>
  z
    .url()
    .refine((u) => u.startsWith('https://') || LOCAL_HTTP.test(u), `${label}: use https (http apenas em localhost)`);

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: secureUrl('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY ausente ou curta demais'),
  NEXT_PUBLIC_APP_URL: secureUrl('NEXT_PUBLIC_APP_URL'),
});

export type PublicEnv = z.infer<typeof publicSchema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida (${problems}). Veja .env.example.`);
  }
  return parsed.data;
}

let cached: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  // Leitura explícita para que o Next inline as variáveis NEXT_PUBLIC_*.
  cached ??= parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  return cached;
}
