'use client';

import { useEffect, useSyncExternalStore } from 'react';

// Confirmação de operação que sobrevive à atualização da tela (o formulário pode sumir quando o registro muda de estado).
// Guardada em sessionStorage só enquanto aparece; nunca carrega valores sensíveis (só a frase de sucesso).
const KEY = 'bi-flash';
const EVENT = 'bi-flash';

export function pushFlash(text: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ text: text.slice(0, 240), id: Date.now() }));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* armazenamento indisponível: a mensagem inline do formulário continua valendo */ }
}

function clear() {
  try { sessionStorage.removeItem(KEY); window.dispatchEvent(new Event(EVENT)); } catch { /* sem armazenamento */ }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
function snapshot(): string {
  try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

export function FlashHost() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => '');
  useEffect(() => {
    if (!raw) return;
    const t = setTimeout(clear, 7000);
    return () => clearTimeout(t);
  }, [raw]);
  let text = '';
  try { text = raw ? (JSON.parse(raw) as { text: string }).text : ''; } catch { text = ''; }
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" aria-live="polite" role="status">
      {text ? (
        <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border border-success bg-card px-4 py-3 text-sm shadow-lg">
          <span aria-hidden className="text-success">✓</span>
          <span>{text}</span>
          <button type="button" onClick={clear} className="ml-2 text-muted underline underline-offset-2" aria-label="Fechar aviso">Fechar</button>
        </div>
      ) : null}
    </div>
  );
}
