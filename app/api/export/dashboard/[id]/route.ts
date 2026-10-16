import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { loadDashboard } from '@/lib/bi/data';
import { filterValuesFromParams, loadDashView } from '@/lib/bi/dashboard-view';
import { formatValue, safeCell, toCsv, type CsvValue } from '@/lib/bi/engine';
import { isUuid, resolvePeriodSel, type SearchParams } from '@/lib/bi/filters';
import { todayIn } from '@/lib/bi/today';
import { nowMs } from '@/lib/time';
import { rateLimit } from '@/lib/security/rate-limit';
import type { WidgetDisplay } from '@/lib/bi/widgets';

export const runtime = 'nodejs';
const deny = (status: number, msg: string) => new NextResponse(msg, { status, headers: { 'Cache-Control': 'no-store' } });
const br = (iso: string) => iso.split('-').reverse().join('/');

/** Exporta os números que os widgets mostram (mesmas consultas, período e filtros da tela). Quem vê o dashboard exporta o que vê — nada além. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolveContext(['owner', 'admin', 'manager', 'member', 'viewer']);
  if (r.kind === 'redirect') return deny(401, 'Sessão expirada.');
  if (r.kind !== 'ok') return deny(403, 'Sem permissão.');
  if (!isUuid(id)) return deny(404, 'Não encontrado.');
  const { ctx } = r;
  if (!rateLimit(`exp:${ctx.user.id}`, { limit: 10, windowMs: 60_000 }).allowed) return deny(429, 'Muitas exportações em pouco tempo.');
  const org = ctx.membership.organization_id;
  const data = await loadDashboard(ctx, id);
  if (!data) return deny(404, 'Não encontrado.');
  const { data: st } = await ctx.supabase.from('bi_settings').select('timezone').eq('organization_id', org).maybeSingle();
  const tz = (st as { timezone?: string } | null)?.timezone ?? 'America/Sao_Paulo';
  const today = todayIn(tz);
  const sp: SearchParams = {};
  for (const [k, v] of new URL(req.url).searchParams.entries()) { const cur = sp[k]; sp[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v]; }
  const d = data.dashboard;
  const sel = resolvePeriodSel(sp, today, { preset: d.default_period as never, comparison: d.comparison as never });
  const widgets = data.widgets.filter((w) => w.query_json && w.widget_type !== 'goal');
  const view = await loadDashView(ctx, org, d, widgets, { range: sel.range, preset: sel.preset, comparison: sel.comparison, today, filters: filterValuesFromParams(sp, data.filters) });
  const rows: CsvValue[][] = [];
  const header = ['Widget', 'Dimensão 1', 'Dimensão 2', 'Indicador', 'Valor', 'Situação'];
  let n = 0;
  for (const w of widgets) {
    const o = view.outcomes.get(w.id);
    const disp = w.display_json as unknown as WidgetDisplay;
    if (!o || !o.ok) { rows.push([w.title, '', '', '', '', o && !o.ok ? o.error : 'Sem dados']); continue; }
    for (const row of o.result.rows) {
      row.values.forEach((v, i) => {
        const m = disp.metrics[i]!;
        rows.push([w.title, row.dims[0] ?? '', row.dims[1] ?? '', m.name, v.state === 'ok' && v.value !== null ? { num: formatValue(v.value, m.format) } : '', v.state === 'ok' ? 'ok' : v.state === 'div_zero' ? 'indisponível (denominador zero)' : 'sem dados']);
        n++;
      });
    }
  }
  const meta: CsvValue[][] = [
    [`Dashboard: ${d.name}`], [`Período: ${br(sel.range.from)} a ${br(sel.range.to)} (inclusivo, fuso ${tz})`], [`Gerado em: ${new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(nowMs()))}`],
    [`Fontes: ${(view.extras.sources ?? []).map((s) => `${s.name} v${s.version_number ?? '—'}`).join('; ')}`], [],
  ];
  await ctx.supabase.rpc('bi_log_export', { p_org: org, p_dashboard: id, p_rows: n });
  const BOM = String.fromCharCode(0xfeff);
  const metaText = meta.map((m) => (m.length ? safeCell(String(m[0]).replace(/[\r\n]+/g, ' ')) : '')).join('\r\n');
  const body = `${BOM}${metaText}\r\n${toCsv(header, rows).replace(BOM, '')}`;
  return new NextResponse(body, { status: 200, headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="dashboard-${id.slice(0, 8)}.csv"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
