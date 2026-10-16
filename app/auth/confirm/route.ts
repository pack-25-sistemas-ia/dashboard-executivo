import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSupabaseServer } from '@/lib/supabase/server';
import { safeNext } from '@/lib/security/redirect';

const typeSchema = z.enum(['signup', 'recovery', 'email', 'invite', 'magiclink', 'email_change']);

// Destino dos links enviados por e-mail (confirmação de cadastro e recuperação de senha).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = typeSchema.safeParse(params.get('type'));
  const next = safeNext(params.get('next'));

  if (tokenHash && type.success) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    if (!error) redirect(type.data === 'recovery' || type.data === 'invite' ? '/reset-password' : next);
  }
  redirect('/login?error=link_invalido');
}
