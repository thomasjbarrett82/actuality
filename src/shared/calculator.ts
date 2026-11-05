// The calculator's arithmetic (09 §5.4): left-to-right evaluation (calculator semantics, not operator
// precedence) on exact fractions of BigInts, never floats. Results round half away from zero to minor
// units. 0/0 = 0; any other division by zero is an error.
import type { Money } from './domain/types';

export type Operator = '+' | '-' | '*' | '/';

/** An exact rational number: num / den, den > 0. */
interface Fraction {
  num: bigint;
  den: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};

function make(num: bigint, den: bigint): Fraction {
  const sign = den < 0n ? -1n : 1n;
  const g = gcd(num, den);
  return { num: (sign * num) / g, den: (sign * den) / g };
}

/** Minor units → fraction of major units (×100 storage, 04 §1). */
export function fromMinor(m: Money): Fraction {
  return make(BigInt(m), 100n);
}

/** Parses a typed operand with "." as the decimal separator. */
export function parseOperand(text: string): Fraction | null {
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const frac = m[3] ?? '';
  const num = BigInt((m[2] || '0') + frac) * (m[1] ? -1n : 1n);
  return make(num, 10n ** BigInt(frac.length));
}

/** Applies one operator; null for a division by zero other than 0/0 (09 §5.4). */
export function apply(a: Fraction, op: Operator, b: Fraction): Fraction | null {
  switch (op) {
    case '+':
      return make(a.num * b.den + b.num * a.den, a.den * b.den);
    case '-':
      return make(a.num * b.den - b.num * a.den, a.den * b.den);
    case '*':
      return make(a.num * b.num, a.den * b.den);
    case '/':
      if (b.num === 0n) return a.num === 0n ? make(0n, 1n) : null;
      return make(a.num * b.den, a.den * b.num);
  }
}

/** Rounds to minor units, half away from zero, as a BigInt (no precision loss). */
function toMinorBig(f: Fraction): bigint {
  const scaled = f.num * 100n;
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const q = (abs * 2n + f.den) / (2n * f.den);
  return neg ? -q : q;
}

/** Rounds to minor units, half away from zero. */
export function toMinor(f: Fraction): Money {
  return Number(toMinorBig(f));
}

/** Formats minor units with "." and exactly 2 decimals, for the calculator display. */
export function formatMinor(m: Money | bigint): string {
  const big = BigInt(m);
  const neg = big < 0n;
  const s = (neg ? -big : big).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

export const MAX_DISPLAY = 30;

/**
 * A calculator's state machine. `display` is what the user sees. Keys follow 09 §5.4: digits, ".",
 * operators, "=", Backspace, C (clear) and F (negate).
 */
export class Calculator {
  display: string;
  private acc: Fraction | null = null;
  private pending: Operator | null = null;
  private fresh = true;
  error = false;

  constructor(initial: Money = 0) {
    this.display = initial === 0 ? '0' : formatMinor(initial);
  }

  /** Starts with a value and an operator, as when "+" is typed in a budget cell (09 §5.4). */
  static withOperator(initial: Money, op: Operator): Calculator {
    const c = new Calculator(initial);
    c.operator(op);
    return c;
  }

  digit(d: string): void {
    if (this.error) this.clear();
    if (this.fresh) {
      this.display = d === '.' ? '0.' : d;
      this.fresh = false;
      return;
    }
    if (d === '.' && this.display.includes('.')) return;
    if (this.display.length >= MAX_DISPLAY) return;
    this.display = this.display === '0' && d !== '.' ? d : this.display + d;
  }

  backspace(): void {
    if (this.error || this.fresh) return;
    this.display =
      this.display.length > 1 && this.display !== '-0' ? this.display.slice(0, -1) : '0';
    if (this.display === '-') this.display = '0';
  }

  negate(): void {
    if (this.error) return;
    if (this.display === '0') return;
    this.display = this.display.startsWith('-') ? this.display.slice(1) : `-${this.display}`;
  }

  clear(): void {
    this.display = '0';
    this.acc = null;
    this.pending = null;
    this.fresh = true;
    this.error = false;
  }

  operator(op: Operator): void {
    if (this.error) return;
    if (!this.fresh || this.acc === null) this.evaluatePending();
    this.pending = op;
    this.fresh = true;
  }

  /** "=": evaluates left to right and shows the result rounded to minor units. */
  equals(): Money | null {
    if (this.error) return null;
    this.evaluatePending();
    this.pending = null;
    this.fresh = true;
    return this.result();
  }

  /** The current value in minor units, or null on error. */
  result(): Money | null {
    if (this.error) return null;
    const v = this.acc ?? parseOperand(this.display);
    return v ? toMinor(v) : null;
  }

  private evaluatePending(): void {
    const operand = parseOperand(this.display);
    if (!operand) {
      this.fail();
      return;
    }
    if (this.acc === null || this.pending === null) {
      this.acc = operand;
    } else {
      const next = apply(this.acc, this.pending, operand);
      if (!next) {
        this.fail();
        return;
      }
      this.acc = next;
    }
    const minor = toMinorBig(this.acc);
    const shown = formatMinor(minor);
    if (shown.length > MAX_DISPLAY || !Number.isSafeInteger(Number(minor))) {
      this.fail();
      return;
    }
    this.display = shown;
  }

  private fail(): void {
    this.error = true;
    this.acc = null;
    this.pending = null;
    this.display = 'Error';
  }
}
