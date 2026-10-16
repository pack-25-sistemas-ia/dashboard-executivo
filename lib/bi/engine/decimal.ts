// Aritmética decimal do motor de métricas: precisão 40, meio-para-cima; arredondamento só na exibição.
import Decimal from 'decimal.js';

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 40 });
export type Dec = InstanceType<typeof D>;
export const ENGINE_VERSION = '1.0.0';

/** Texto decimal canônico («1234.50» → «1234.5») ou null se não for número finito. */
export function toDec(v: unknown): Dec | null {
  if (v === null || v === undefined || v === '') return null;
  try {
    const d = new D(v as string | number);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export class BiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
