import { civilDateIn } from './engine';
import { nowMs } from '@/lib/time';

/** Data de hoje (AAAA-MM-DD) no fuso da empresa. */
export const todayIn = (tz: string): string => civilDateIn(new Date(nowMs()), tz);
