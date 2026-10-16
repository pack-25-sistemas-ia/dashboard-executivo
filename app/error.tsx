'use client';

import { Button } from '@/components/ui/primitives';

// Mensagem genérica ao usuário. O detalhe técnico fica apenas nos logs privados do servidor.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Algo deu errado</h1>
      <p className="text-sm text-muted">Não foi possível concluir a operação. Tente novamente em instantes.</p>
      {error.digest ? <p className="text-xs text-muted">Código de referência: {error.digest}</p> : null}
      <div>
        <Button onClick={reset}>Tentar novamente</Button>
      </div>
    </main>
  );
}
