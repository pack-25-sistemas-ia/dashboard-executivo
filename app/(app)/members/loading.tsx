export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Carregando…</span>
      <div className="h-8 w-48 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-black/10 dark:bg-white/10" />
        ))}
      </div>
    </div>
  );
}
