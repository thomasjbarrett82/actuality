import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  apply,
  Calculator,
  formatMinor,
  fromMinor,
  MAX_DISPLAY,
  parseOperand,
  toMinor,
} from './calculator';

const press = (c: Calculator, keys: string): Calculator => {
  for (const k of keys) {
    if (/[\d.]/.test(k)) c.digit(k);
    else if (k === '+' || k === '-' || k === '*' || k === '/') c.operator(k);
    else if (k === '=') c.equals();
    else if (k === '<') c.backspace();
    else if (k === 'C') c.clear();
    else if (k === 'F') c.negate();
  }
  return c;
};

describe('calculator (09 §5.4)', () => {
  it('evaluates left to right, not by precedence', () => {
    expect(press(new Calculator(), '2+3*4=').display).toBe('20.00');
    expect(press(new Calculator(), '10-2/4=').display).toBe('2.00');
  });

  it('starts from a value and operator', () => {
    const c = Calculator.withOperator(6000, '+');
    expect(press(c, '12.5=').result()).toBe(7250);
  });

  it('rounds to minor units half away from zero, exactly', () => {
    expect(press(new Calculator(), '0.1+0.2=').display).toBe('0.30');
    expect(press(new Calculator(), '10/3=').result()).toBe(333);
    expect(press(new Calculator(), '0.005=').result()).toBe(1);
    expect(press(new Calculator(), '0.005F=').result()).toBe(-1);
    expect(press(new Calculator(), '1/8=').display).toBe('0.13');
  });

  it('treats 0/0 as 0 and other divisions by zero as an error', () => {
    expect(press(new Calculator(), '0/0=').result()).toBe(0);
    const c = press(new Calculator(), '5/0=');
    expect(c.display).toBe('Error');
    expect(c.result()).toBeNull();
    expect(c.equals()).toBeNull();
    press(c, '7');
    expect(c.display).toBe('7');
  });

  it('edits the display: backspace, negate, clear, one decimal point', () => {
    expect(press(new Calculator(), '12.3<').display).toBe('12.');
    expect(press(new Calculator(), '5<<').display).toBe('0');
    expect(press(new Calculator(), '1.2.3').display).toBe('1.23');
    expect(press(new Calculator(), '.5').display).toBe('0.5');
    expect(press(new Calculator(), '7F').display).toBe('-7');
    expect(press(new Calculator(), '7FF').display).toBe('7');
    expect(press(new Calculator(), 'F').display).toBe('0');
    expect(press(new Calculator(), '7-<').display).toBe('7.00');
    expect(press(new Calculator(), '7+3C').display).toBe('0');
    expect(press(new Calculator(), '-<').display).toBe('0.00');
  });

  it('limits the display to 30 characters', () => {
    const c = press(new Calculator(), '9'.repeat(40));
    expect(c.display).toHaveLength(MAX_DISPLAY);
    expect(press(new Calculator(), `${'9'.repeat(28)}*${'9'.repeat(28)}=`).display).toBe('Error');
  });

  it('shows an initial value', () => {
    expect(new Calculator(-1250).display).toBe('-12.50');
    expect(new Calculator().display).toBe('0');
  });

  it('keeps exact arithmetic', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.integer({ min: -1e9, max: 1e9 }),
        (a, b) => {
          const sum = apply(fromMinor(a), '+', fromMinor(b));
          expect(sum && toMinor(sum)).toBe(a + b);
          const diff = apply(fromMinor(a), '-', fromMinor(b));
          expect(diff && toMinor(diff)).toBe(a - b);
        },
      ),
    );
  });

  it('parses and formats operands', () => {
    expect(parseOperand('')).toBeNull();
    expect(parseOperand('.')).toBeNull();
    expect(parseOperand('1e5')).toBeNull();
    expect(formatMinor(5)).toBe('0.05');
    expect(formatMinor(-5)).toBe('-0.05');
  });
});
