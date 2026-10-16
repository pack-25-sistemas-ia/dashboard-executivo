export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">{children}</div>
    </main>
  );
}
