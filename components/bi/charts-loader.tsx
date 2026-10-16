'use client';

import dynamic from 'next/dynamic';

// Gráficos só no navegador: a biblioteca gera estilos em linha, que a CSP estrita bloquearia no HTML do servidor.
function Skeleton() {
  return (
    <div role="status" className="h-[260px] animate-pulse rounded-lg bg-black/10 dark:bg-white/10">
      <span className="sr-only">Carregando gráfico…</span>
    </div>
  );
}

export const ChartBodyClient = dynamic(() => import('./charts').then((m) => m.ChartBody), { ssr: false, loading: Skeleton });
