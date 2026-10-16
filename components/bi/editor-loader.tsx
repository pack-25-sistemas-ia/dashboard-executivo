'use client';

import dynamic from 'next/dynamic';

// O editor usa posicionamento por estilo calculado no navegador (react-grid-layout): só no cliente, para não gerar estilo em linha no HTML (CSP estrita).
export const DashboardEditorClient = dynamic(() => import('./dashboard-editor').then((m) => m.DashboardEditor), {
  ssr: false,
  loading: () => <div role="status" className="h-64 animate-pulse rounded-lg bg-black/10 dark:bg-white/10"><span className="sr-only">Carregando editor…</span></div>,
});
