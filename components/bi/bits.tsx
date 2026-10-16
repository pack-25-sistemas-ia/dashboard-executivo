import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card } from '@/components/ui/primitives';
import { PAGE_SIZE, withParams, type SearchParams } from '@/lib/bi/filters';
import { cn } from '@/lib/utils';

export type Opt = { value: string; label: string };

export function DateTimeBR({ value, tz }: { value: string | null | undefined; tz: string }) {
  if (!value) return <span>—</span>;
  const d = new Date(value);
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
  return <span className="tabular-nums whitespace-nowrap">{date} {time}</span>;
}
export function DateBR({ value }: { value: string | null | undefined }) {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return <span className="tabular-nums whitespace-nowrap">{m ? `${m[3]}/${m[2]}/${m[1]}` : '—'}</span>;
}

/** Cartão de indicador: valor, rótulo e a definição (visível, não só tooltip). */
export function Kpi({ label, value, tone, definition, children }: { label: string; value: ReactNode; tone?: 'neutral' | 'danger' | 'success' | 'warning'; definition?: string; children?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted" title={definition}>{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</p>
      {children}
      {definition ? <p className="mt-2 text-xs leading-snug text-muted">{definition}</p> : null}
    </Card>
  );
}

export function Tabs({ items, current }: { items: Array<{ href: string; label: string; key: string }>; current: string }) {
  return (
    <nav aria-label="Seções" className="mb-5 flex flex-wrap gap-1 border-b border-border">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === current ? 'page' : undefined}
          className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', i.key === current ? 'border-primary text-foreground' : 'border-transparent text-muted hover:text-foreground')}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ base, sp, page, total, size = PAGE_SIZE }: { base: string; sp: SearchParams; page: number; total: number; size?: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return <p className="mt-3 text-xs text-muted">{total} registro(s)</p>;
  const link = (p: number) => withParams(base, sp, { page: p === 1 ? null : String(p) });
  return (
    <nav aria-label="Paginação" className="mt-3 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{total} registro(s) · página {page} de {pages}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link className="rounded-md border border-border px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5" href={link(page - 1)}>Anterior</Link> : null}
        {page < pages ? <Link className="rounded-md border border-border px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5" href={link(page + 1)}>Próxima</Link> : null}
      </span>
    </nav>
  );
}

export function Section({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Painel recolhível sem JavaScript (details/summary): usado para formulários secundários. */
export function Disclosure({ summary, children, open = false, tone = 'secondary' }: { summary: string; children: ReactNode; open?: boolean; tone?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <details open={open} className="group rounded-lg border border-border bg-card">
      <summary className={cn('flex min-h-10 cursor-pointer list-none items-center rounded-lg px-4 text-sm font-medium', tone === 'primary' && 'bg-primary text-primary-foreground', tone === 'danger' && 'text-danger')}>{summary}</summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

export const TH = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted';
export const THR = 'whitespace-nowrap px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted';
export const TD = 'px-3 py-2 align-top text-sm';
export const TDR = 'px-3 py-2 align-top text-right text-sm tabular-nums';

export function TableShell({ caption, children, empty, emptyText }: { caption: string; children: ReactNode; empty?: boolean; emptyText?: string }) {
  if (empty) return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{emptyText ?? 'Nenhum registro encontrado.'}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

const TONES: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  active: 'success', published: 'success', completed: 'success', achieved: 'success', ready: 'warning', processing: 'warning', staging: 'warning', draft: 'neutral', archived: 'neutral', superseded: 'neutral',
  failed: 'danger', invalid: 'danger', cancelled: 'neutral', missed: 'danger', attention: 'warning', on_track: 'warning', unavailable: 'neutral',
};
export function StatusBadge({ status, label }: { status: string; label: string | undefined }) {
  return <Badge tone={TONES[status] ?? 'neutral'}>{label ?? status}</Badge>;
}
