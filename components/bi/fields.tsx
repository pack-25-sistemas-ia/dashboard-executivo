'use client';

import { useId, useState, type ReactNode } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import type { ActionState } from '@/lib/actions/result';
import type { Opt } from './bits';
import { useBiAction } from './use-bi-action';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState & { redirectTo?: string }>;

/** Formulário ligado a uma Server Action: erros por campo, valores preservados em falha, confirmação que sobrevive à atualização. */
export function BiForm({ action, submit, pending = 'Salvando…', reset = true, variant, className = 'grid gap-4 sm:grid-cols-4', hidden, children }: {
  action: Action; submit: string; pending?: string; reset?: boolean; variant?: 'primary' | 'secondary' | 'danger'; className?: string; hidden?: Record<string, string>;
  children: (f: { e: Record<string, string[]>; v: Record<string, string>; id: (n: string) => string }) => ReactNode;
}) {
  const p = useId();
  const [state, formAction, ref] = useBiAction(action, { reset });
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form ref={ref} action={formAction} className={className} noValidate>
      {hidden ? Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />) : null}
      {children({ e, v, id: (n) => `${p}${n}` })}
      <div className="sm:col-span-4 flex flex-wrap items-center gap-3"><SubmitButton pendingText={pending} variant={variant}>{submit}</SubmitButton><FormMessage state={state} /></div>
    </form>
  );
}

export const OptionList = ({ opts, placeholder }: { opts: Opt[]; placeholder?: string }) => (
  <>{placeholder !== undefined ? <option value="">{placeholder}</option> : null}{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</>
);

type Ctx = { e: Record<string, string[]>; v: Record<string, string>; id: (n: string) => string };

export function TextF({ f, name, label, def, hint, required, max, inputMode, type = 'text', span, placeholder }: { f: Ctx; name: string; label: string; def?: string | null; hint?: string; required?: boolean; max?: number; inputMode?: 'decimal' | 'numeric' | 'text'; type?: string; span?: boolean; placeholder?: string }) {
  const body = <Field label={label} name={f.id(name)} errors={f.e[name]} hint={hint}><Input id={f.id(name)} name={name} type={type} required={required} maxLength={max} inputMode={inputMode} placeholder={placeholder} defaultValue={f.v[name] ?? def ?? ''} /></Field>;
  return span ? <div className="sm:col-span-2">{body}</div> : body;
}
export function SelectF({ f, name, label, opts, def, placeholder, hint, required, span }: { f: Ctx; name: string; label: string; opts: Opt[]; def?: string | null; placeholder?: string; hint?: string; required?: boolean; span?: boolean }) {
  const body = <Field label={label} name={f.id(name)} errors={f.e[name]} hint={hint}><Select id={f.id(name)} name={name} required={required} defaultValue={f.v[name] ?? def ?? ''}><OptionList opts={opts} placeholder={placeholder} /></Select></Field>;
  return span ? <div className="sm:col-span-2">{body}</div> : body;
}
export function AreaF({ f, name, label, def, hint, max = 500 }: { f: Ctx; name: string; label: string; def?: string | null; hint?: string; max?: number }) {
  return <div className="sm:col-span-4"><Field label={label} name={f.id(name)} errors={f.e[name]} hint={hint}><Textarea id={f.id(name)} name={name} rows={3} maxLength={max} defaultValue={f.v[name] ?? def ?? ''} /></Field></div>;
}
export function CheckF({ f, name, label, def }: { f: Ctx; name: string; label: string; def?: boolean }) {
  const [on, setOn] = useState(def ?? false);
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm" htmlFor={f.id(name)}>
      <input id={f.id(name)} type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="size-4" /> {label}
    </label>
  );
}

/** Botão de ação pontual (publicar, cancelar…) com confirmação em duas etapas quando `confirm` é informado. */
export function ActionButton({ action, fields, label, pending = 'Enviando…', variant = 'secondary', confirm, className }: {
  action: Action; fields: Record<string, string>; label: string; pending?: string; variant?: 'primary' | 'secondary' | 'danger'; confirm?: string; className?: string;
}) {
  const [state, formAction, ref] = useBiAction(action, { reset: false });
  const [armed, setArmed] = useState(false);
  return (
    <form ref={ref} action={formAction} className={className ?? 'inline-flex flex-wrap items-center gap-2'}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {confirm && !armed ? (
        <button type="button" onClick={() => setArmed(true)} className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">{label}</button>
      ) : (
        <>
          {confirm ? <span className="text-sm" role="alert">{confirm}</span> : null}
          <SubmitButton pendingText={pending} variant={variant}>{confirm ? 'Confirmar' : label}</SubmitButton>
          {confirm ? <button type="button" onClick={() => setArmed(false)} className="text-sm text-muted underline underline-offset-2">Voltar</button> : null}
        </>
      )}
      <FormMessage state={state} />
    </form>
  );
}
