'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatValue, labelBucket, type FormatType, type Grain } from '@/lib/bi/engine';
import type { ResultSet } from '@/lib/bi/widgets';

// Gráficos só no navegador (ver charts-loader.tsx). Todos os valores vêm do banco/motor (texto decimal exato); aqui só desenhamos.
// Número JS é usado APENAS para a posição no desenho; rótulos e tabelas usam o texto exato formatado.
const COLORS = ['#0e7490', '#047857', '#b45309', '#7c3aed', '#be123c', '#475569', '#0369a1', '#a16207'];
const TICK = { fill: 'currentColor', fontSize: 12 };
const TOOLTIP = { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' };
const Grid = () => <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.2} />;
const short = (v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v);

type Pt = Record<string, string | number | null>;

function label(rs: ResultSet, raw: string | null, i = 0): string {
  const d = rs.dims[i];
  if (raw === null || raw === '') return '(vazio)';
  if (d?.grain) return labelBucket(raw, d.grain as Grain);
  if (d && (d.type === 'date' || d.type === 'timestamp')) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw); return m ? `${m[3]}/${m[2]}/${m[1]}` : raw; }
  return raw;
}

/** Linhas → pontos do gráfico. 1 dimensão: uma série por indicador. 2 dimensões: uma série por valor da 2ª dimensão (1 indicador). */
export function toPoints(rs: ResultSet): { data: Pt[]; series: Array<{ key: string; name: string; format: FormatType }> } {
  const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
  if (rs.dims.length === 2 && rs.metrics.length === 1) {
    const names: string[] = [];
    const byCat = new Map<string, Pt>();
    for (const r of rs.rows) {
      const cat = label(rs, r.dims[0] ?? null, 0);
      const ser = label(rs, r.dims[1] ?? null, 1);
      if (!names.includes(ser)) names.push(ser);
      const p = byCat.get(cat) ?? { name: cat };
      p[`s_${names.indexOf(ser)}`] = num(r.values[0]?.value);
      byCat.set(cat, p);
    }
    return { data: [...byCat.values()], series: names.map((n, i) => ({ key: `s_${i}`, name: n, format: rs.metrics[0]!.format })) };
  }
  const data: Pt[] = rs.rows.map((r) => {
    const p: Pt = { name: label(rs, r.dims[0] ?? null, 0) };
    rs.metrics.forEach((_, i) => { p[`s_${i}`] = num(r.values[i]?.value); });
    return p;
  });
  if (rs.others) { const p: Pt = { name: 'Outros' }; rs.metrics.forEach((_, i) => { p[`s_${i}`] = num(rs.others!.values[i]?.value); }); data.push(p); }
  return { data, series: rs.metrics.map((m, i) => ({ key: `s_${i}`, name: m.name, format: m.format })) };
}

export function ChartBody({ chart, rs, height = 260 }: { chart: string; rs: ResultSet; height?: number }) {
  const { data, series } = toPoints(rs);
  if (!data.length) return <p className="flex items-center justify-center rounded-md border border-dashed border-border text-sm text-muted" style={{ height }}>Sem dados no período e filtros escolhidos</p>;
  const fmt = (s: { format: FormatType }) => (v: unknown) => formatValue(v === null || v === undefined ? null : String(v), s.format);
  const tick = (f: FormatType) => (v: number) => formatValue(String(v), f, { compact: true });
  const tooltip = <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => { const s = series.find((x) => x.name === n); return s ? fmt(s)(v) : String(v); }} />;
  const first = series[0]!;
  if (chart === 'pie' || chart === 'donut') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie isAnimationActive={false} data={data} dataKey={first.key} nameKey="name" innerRadius={chart === 'donut' ? '55%' : 0} outerRadius="80%" paddingAngle={1}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          {tooltip}<Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chart === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} /><YAxis tick={TICK} tickFormatter={tick(first.format)} width={72} />{tooltip}<Legend />
          {series.map((s, i) => <Line key={s.key} isAnimationActive={false} type="monotone" dataKey={s.key} name={s.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={data.length < 40} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (chart === 'area') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} /><YAxis tick={TICK} tickFormatter={tick(first.format)} width={72} />{tooltip}<Legend />
          {series.map((s, i) => <Area key={s.key} isAnimationActive={false} type="monotone" dataKey={s.key} name={s.name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.25} connectNulls />)}
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  if (chart === 'combo') {
    const second = series[1] ?? first;
    const dual = second.format !== first.format;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} />
          <YAxis yAxisId="l" tick={TICK} tickFormatter={tick(first.format)} width={72} />{dual ? <YAxis yAxisId="r" orientation="right" tick={TICK} tickFormatter={tick(second.format)} width={72} /> : null}
          {tooltip}<Legend />
          <Bar isAnimationActive={false} yAxisId="l" dataKey={first.key} name={first.name} fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          {series[1] ? <Line isAnimationActive={false} yAxisId={dual ? 'r' : 'l'} type="monotone" dataKey={second.key} name={second.name} stroke={COLORS[2]} strokeWidth={2} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }
  const stacked = chart === 'stacked_bar';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}><Grid /><XAxis dataKey="name" tick={TICK} tickFormatter={short} interval={0} angle={data.length > 6 ? -30 : 0} textAnchor={data.length > 6 ? 'end' : 'middle'} height={data.length > 6 ? 64 : 30} />
        <YAxis tick={TICK} tickFormatter={tick(first.format)} width={72} />{tooltip}{series.length > 1 ? <Legend /> : null}
        {series.map((s, i) => <Bar key={s.key} isAnimationActive={false} dataKey={s.key} name={s.name} fill={COLORS[i % COLORS.length]} {...(stacked ? { stackId: 'a' } : {})} radius={stacked ? 0 : [4, 4, 0, 0]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}
