import type { ReactNode } from 'react';
import { COL_SPAN, COL_START, MIN_H } from './grid-classes';

type Pos = { x: number; y: number; w: number; h: number };
export type GridItem = { id: string; layout: { lg?: Pos; md?: Pos; sm?: Pos }; node: ReactNode };

const clamp = (n: number, a: number, b: number) => Math.min(Math.max(Math.trunc(n), a), b);

/** Grade do dashboard no modo visualização: 12 colunas no desktop, 2 no tablet, 1 no celular (mesma ordem de leitura). */
export function DashboardGrid({ items }: { items: GridItem[] }) {
  const sorted = [...items].sort((a, b) => (a.layout.lg?.y ?? 0) - (b.layout.lg?.y ?? 0) || (a.layout.lg?.x ?? 0) - (b.layout.lg?.x ?? 0));
  return (
    <div className="grid grid-flow-row-dense grid-cols-12 gap-4" data-testid="dashboard-grid">
      {sorted.map((it) => {
        const p = it.layout.lg ?? { x: 0, y: 0, w: 6, h: 3 };
        const w = clamp(p.w, 1, 12); const x = clamp(p.x, 0, 11); const h = clamp(p.h, 1, 30);
        const md = it.layout.md ? (it.layout.md.w >= 8 ? 'md:col-span-12' : 'md:col-span-6') : w >= 8 ? 'md:col-span-12' : 'md:col-span-6';
        return (
          <div key={it.id} data-widget-id={it.id} className={`col-span-12 ${md} ${COL_START[Math.min(x, 12 - w)]} ${COL_SPAN[w - 1]} ${MIN_H[h - 1]}`}>
            {it.node}
          </div>
        );
      })}
    </div>
  );
}
