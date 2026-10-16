import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { loadColumns, loadDataset } from '@/lib/bi/data';
import { toCsv, type CsvValue } from '@/lib/bi/engine';
import { buildFilters } from '@/lib/bi/explorer';
import { isUuid, one, type SearchParams } from '@/lib/bi/filters';
import { rateLimit } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const deny = (status: number, msg: string) => new NextResponse(msg, { status, headers: { 'Cache-Control': 'no-store' } });

/** Exportação das linhas de um dataset (gestor+). Passa pela função do banco (autorização, restrição de dataset e auditoria); CSV neutralizado. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolveContext(['owner', 'admin', 'manager']);
  if (r.kind === 'redirect') return deny(401, 'Sessão expirada.');
  if (r.kind !== 'ok') return deny(403, 'Sem permissão.');
  if (!isUuid(id)) return deny(404, 'Não encontrado.');
  const { ctx } = r;
  if (!rateLimit(`exp:${ctx.user.id}`, { limit: 10, windowMs: 60_000 }).allowed) return deny(429, 'Muitas exportações em pouco tempo.');
  const org = ctx.membership.organization_id;
  const ds = await loadDataset(ctx, id);
  if (!ds?.current_version_id) return deny(404, 'Não encontrado.');
  const cols = await loadColumns(ctx, ds.current_version_id);
  const sp: SearchParams = Object.fromEntries(new URL(req.url).searchParams.entries());
  const filters = buildFilters(sp, cols);
  const sortRaw = one(sp.sort); const sort = cols.some((c) => c.column_key === sortRaw) ? sortRaw : null;
  const out: CsvValue[][] = [];
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await ctx.supabase.rpc('bi_dataset_rows', { p_org: org, p_dataset: id, p_filters: filters, p_period: null, p_sort: sort, p_dir: one(sp.dir) === 'desc' ? 'desc' : 'asc', p_page: page, p_size: 5000, p_for_export: true });
    if (error) return deny(error.code === '42501' ? 403 : 400, 'Não foi possível exportar.');
    const res = data as { rows: Array<{ n: number; v: Record<string, string | boolean | null> }>; total: number };
    for (const row of res.rows) out.push(cols.map((c): CsvValue => { const v = row.v[c.column_key]; if (v === null || v === undefined) return ''; if (typeof v === 'boolean') return v; return ['integer', 'decimal', 'currency', 'percentage'].includes(c.data_type) ? { num: v } : v; }));
    if (page * 5000 >= res.total) break;
  }
  return new NextResponse(toCsv(cols.map((c) => c.display_name), out), { status: 200, headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="dataset-${id.slice(0, 8)}.csv"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
