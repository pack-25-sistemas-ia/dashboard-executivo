'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import type { ActionState } from '@/lib/actions/result';
import { cn } from '@/lib/utils';
import { Alert, Button } from './primitives';

export function SubmitButton({ children, pendingText = 'Enviando…', variant }: { children: ReactNode; pendingText?: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert>;
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition',
        active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-black/5 dark:hover:bg-white/5',
      )}
    >
      {children}
    </Link>
  );
}
