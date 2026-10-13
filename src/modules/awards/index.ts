import { MA000119 } from './ma000119';
import type { AwardInterpreter } from './types';

export type { AwardPay, AwardPayInput, AwardPayLine, AwardShift, AwardWarning } from './types';

/**
 * Awards whose rules have been written down from the award's text. For any other award the
 * Commission's rates are still shown, but which hours they apply to is left to the employer.
 */
const INTERPRETERS: Record<string, AwardInterpreter> = { [MA000119.code]: MA000119 };

export const awardInterpreter = (code: string | null | undefined): AwardInterpreter | null =>
  (code && INTERPRETERS[code]) || null;
