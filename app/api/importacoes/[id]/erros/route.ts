import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { loadColumns, loadImport } from '@/lib/bi/data';
import { toCsv, type CsvValue } from '@/lib/bi/engine';
import { isUuid } from '@/lib/bi/filters';
import { rateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const deny = (status: number, msg: string) => new NextResponse(msg, { status, headers: { 'Cache-Control': 'no-store' } });

/** Relatório de erros da importação (CSV neutralizado). Analista+; os dados vêm pela RLS do dataset. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolveContext(['owner', 'admin', 'manager', 'member']);
  if (r.kind === 'redirect') return deny(401, 'Sessão expirada.');
  if (r.kind !== 'ok') return deny(403, 'Sem permissão.');
  if (!isUuid(id)) return deny(404, 'Não encontrado.');
  const { ctx } = r;
  if (!rateLimit(`imperr:${ctx.user.id}`, { limit: 20, windowMs: 60_000 }).allowed) return deny(429, 'Muitas requisições.');
  const data = await loadImport(ctx, id);
  if (!data) return deny(404, 'Não encontrado.');
  const cols = await loadColumns(ctx, data.job.dataset_version_id);
  const name = new Map(cols.map((c) => [c.column_key, c.display_name]));
  const rows: CsvValue[][] = data.errors.map((e) => [e.row_number, e.column_key ? name.get(e.column_key) ?? e.column_key : '', e.error_message, e.rejected_value ?? '']);
  return new NextResponse(toCsv(['Linha do arquivo', 'Coluna', 'Motivo', 'Valor rejeitado'], rows), { status: 200, headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="erros-importacao-${id.slice(0, 8)}.csv"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
