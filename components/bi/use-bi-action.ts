'use client';

import { useActionState, useEffect, useRef, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionState } from '@/lib/actions/result';
import { pushFlash } from './flash';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState & { redirectTo?: string }>;

/**
 * O React 19 reinicia o formulário ao fim de TODA ação (inclusive as que falham). Numa operação financeira recusada
 * (ex.: valor acima do pendente) o usuário não deve perder a conta, o valor e os motivos já digitados: reaplicamos os valores enviados.
 */
function restoreValues(form: HTMLFormElement, values: Record<string, string>) {
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) || !el.name || el.name === 'idem') continue;
    if (el instanceof HTMLInputElement) {
      if (el.type === 'hidden' || el.type === 'file' || el.type === 'submit') continue;
      if (el.type === 'checkbox') { el.checked = el.name in values; continue; }
      if (el.type === 'radio') { el.checked = values[el.name] === el.value; continue; }
    }
    if (el.name in values) el.value = values[el.name] ?? '';
  }
}

const strings = (fd: FormData) => Object.fromEntries(Array.from(fd.entries()).filter(([, v]) => typeof v === 'string')) as Record<string, string>;

/**
 * Liga um formulário a uma Server Action.
 * - Chave de idempotência: gerada no 1º envio e reaproveitada em reenvios (duplo clique, rede instável) até haver sucesso ou erro de validação.
 * - Sucesso: limpa o formulário, mostra a confirmação (que sobrevive à atualização) e atualiza a tela (ou navega para `redirectTo`).
 * - Falha: mantém o que foi digitado.
 */
export function useBiAction(action: Action, opts: { reset?: boolean } = { reset: true }): [ActionState, (fd: FormData) => void, RefObject<HTMLFormElement | null>] {
  const router = useRouter();
  const keyRef = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const pending = useRef<{ form: HTMLFormElement; values: Record<string, string> } | null>(null);
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData): Promise<ActionState> => {
    keyRef.current ??= crypto.randomUUID();
    fd.set('idem', keyRef.current);
    // formulário que enviou: pela ref, ou pelo botão que está com o foco (formulários sem ref)
    const focused = typeof document !== 'undefined' ? (document.activeElement as { form?: HTMLFormElement | null } | null) : null;
    const form = formRef.current ?? focused?.form ?? null;
    const r = await action(prev, fd);
    if (r.ok || r.fieldErrors) keyRef.current = null;
    if (r.ok) {
      if (r.message) pushFlash(r.message);
      if (opts.reset !== false) form?.reset();
      else if (form) pending.current = { form, values: strings(fd) };
      if (r.redirectTo) router.push(r.redirectTo);
      else router.refresh();
    } else if (form) {
      pending.current = { form, values: r.values ?? strings(fd) };
    }
    return r;
  }, {} as ActionState);

  // Roda logo depois de o estado novo ser aplicado (e depois do reinício do formulário pelo React).
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    restoreValues(p.form, p.values);
  }, [state]);

  return [state, formAction, formRef];
}
