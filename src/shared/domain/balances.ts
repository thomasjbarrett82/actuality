// Account balances (04 §8). Every entered transaction counts, whatever its date. Amounts are integers.
import type { AccountBalances, ClearedState, Money } from './types';

export function balancesOf(
  rows: readonly { amount: Money; cleared: ClearedState }[],
): AccountBalances {
  let reconciled = 0;
  let cleared = 0;
  let uncleared = 0;
  for (const r of rows) {
    if (r.cleared === 'U') uncleared += r.amount;
    else {
      cleared += r.amount;
      if (r.cleared === 'R') reconciled += r.amount;
    }
  }
  return { reconciled, cleared, uncleared, working: cleared + uncleared };
}

/** Actual's two booleans as one state (04 §3): reconciled implies cleared. */
export function clearedState(cleared: boolean, reconciled: boolean): ClearedState {
  if (reconciled) return 'R';
  return cleared ? 'C' : 'U';
}
