import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-muted">O endereço não existe ou você não tem acesso a ele.</p>
      <p>
        <Link className="underline" href="/dashboard">Ir para o painel</Link>
      </p>
    </main>
  );
}
