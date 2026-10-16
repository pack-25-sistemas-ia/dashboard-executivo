// Relógio único do servidor. Server Components renderizam uma vez por requisição,
// então ler a hora aqui é seguro; centralizar facilita fixar o tempo em testes.
export function nowMs(): number {
  return Date.now();
}

export function daysAgoIso(days: number): string {
  return new Date(nowMs() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function nowIso(): string {
  return new Date(nowMs()).toISOString();
}
