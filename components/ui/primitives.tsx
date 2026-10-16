import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-border bg-card text-foreground hover:bg-black/5 dark:hover:bg-white/5',
  danger: 'bg-danger text-white hover:opacity-90',
  ghost: 'text-foreground hover:bg-black/5 dark:hover:bg-white/5',
};

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

const control = 'min-h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted aria-[invalid=true]:border-danger';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24 py-2', className)} {...props} />;
}

export function Field({ label, name, errors, hint, children }: { label: string; name: string; errors?: string[]; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !errors?.length ? (
        <p id={`${name}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {errors?.length ? (
        <p id={`${name}-error`} role="alert" className="text-xs text-danger">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const tones = {
    error: 'border-danger text-danger',
    success: 'border-success text-success',
    warning: 'border-warning text-warning',
    info: 'border-border text-foreground',
  } as const;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-md border bg-card px-3 py-2 text-sm', tones[tone])}>
      {children}
    </div>
  );
}

export function Card({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-lg border border-border bg-card p-5 shadow-sm', className)}>
      {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className={title || description ? 'mt-4' : undefined}>{children}</div>
    </section>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const tones = {
    neutral: 'border-border text-muted',
    success: 'border-success text-success',
    warning: 'border-warning text-warning',
    danger: 'border-danger text-danger',
  } as const;
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
