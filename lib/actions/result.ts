import type { ZodError } from 'zod';

export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Valores NÃO sensíveis devolvidos ao formulário (nunca senhas ou códigos). */
  values?: Record<string, string>;
  enroll?: { factorId: string; qr: string; secret: string };
};

export function fieldErrorsFrom(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function fail(message: string, fieldErrors?: Record<string, string[]>, values?: Record<string, string>): ActionState {
  return { ok: false, message, fieldErrors, values };
}

export function succeed(message?: string): ActionState {
  return { ok: true, message };
}

/** Converte erro do Postgres/PostgREST em mensagem útil ao usuário, sem vazar detalhes técnicos. */
export function messageForDbError(error: { code?: string; message?: string } | null | undefined): string {
  switch (error?.code) {
    case '42501':
      return 'Você não tem permissão para esta ação.';
    case '23514':
      return error.message?.includes('owner')
        ? 'A organização precisa manter ao menos um proprietário.'
        : 'Os dados informados não são válidos.';
    case '23505':
      return 'Já existe um registro com estes dados.';
    case '28000':
      return 'Sua sessão expirou. Entre novamente.';
    default:
      return 'Não foi possível concluir a operação. Tente novamente.';
  }
}

/** Lê um campo de texto do FormData sem aceitar arquivos. */
export function textField(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === 'string' ? v : '';
}
