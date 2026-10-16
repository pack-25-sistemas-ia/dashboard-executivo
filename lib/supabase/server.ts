import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getPublicEnv } from '@/lib/env';

/** Cliente Supabase com a sessão do usuário (cookies HttpOnly). Todo acesso passa pelo RLS. */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  const env = getPublicEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Chamado de um Server Component (somente leitura): o proxy renova a sessão.
        }
      },
    },
  });
}
