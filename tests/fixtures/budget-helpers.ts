// Helpers shared by the budget builders: the test fixtures (build-fixture.ts) and the demo budget
// (build-demo.ts).

/** A transaction as the builders pass it to `addTransactions`. */
export type Tx = {
  date: string;
  amount: number;
  payee?: string;
  category?: string;
  notes?: string;
  cleared?: boolean;
  subtransactions?: { amount: number; category?: string; payee?: string; notes?: string }[];
};

/** mulberry32: a small seeded PRNG, so a budget is the same on every build. */
export function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for a day of a `YYYY-MM` month. */
export const day = (month: string, d: number): string => `${month}-${pad(d)}`;
