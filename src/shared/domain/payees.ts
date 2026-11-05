// Payee rules that don't need the API (14 §1): the bank-generic names that new payees are created
// disabled with, and the "Transfer : {account}" payee text.

/** New payees with one of these names are created disabled (14 §1). Compared case-insensitively. */
export const BANK_GENERIC_PAYEES: readonly string[] = [
  'ACH Credit',
  'ACH Debit',
  'ACH Deposit',
  'Automatic Deposit',
  'Automatic Withdrawal',
  'Bank Card Purchase',
  'Cash',
  'Cashed Check',
  'Check',
  'Checkcard Purchase',
  'Credit',
  'Credit Memo',
  'Customer Withdrawal',
  'Debit Memo',
  'Deposit',
  'Deposit - Thank you',
  'Forced Check',
  'Home Banking Xfer',
  'Inclearings Check',
  'Miline Transfer-in',
  'Miline Transfer-out',
  'Purchase',
  'Point of Sale',
  'POS Refund',
  'On-US Check Withdrawal',
  'Starting Balance',
  'Teller Cashed Check',
  'Transfer Credit',
  'Transfer Debit',
  'Withdrawal',
];

const generic = new Set(BANK_GENERIC_PAYEES.map((n) => n.toLocaleLowerCase()));

export const isBankGeneric = (name: string): boolean =>
  generic.has(name.trim().toLocaleLowerCase());

/** The English transfer prefix, which is always accepted besides the UI language's (11 §4.1). */
export const ENGLISH_TRANSFER_PREFIX = 'Transfer :';

/**
 * The account name in a "Transfer : {account}" text (whitespace- and case-insensitive, 11 §4.1), for the
 * given prefixes; null when the text isn't a transfer.
 */
export function transferAccountName(text: string, prefixes: readonly string[]): string | null {
  const squash = (s: string): string => s.replace(/\s+/g, '').toLocaleLowerCase();
  const t = text.trimStart();
  for (const prefix of prefixes) {
    const want = squash(prefix);
    // Walk the text until the non-space characters seen equal the prefix's.
    let seen = '';
    for (let i = 0; i < t.length; i++) {
      const ch = t.charAt(i);
      if (!/\s/.test(ch)) seen += ch.toLocaleLowerCase();
      if (seen === want) return t.slice(i + 1).trim();
      if (!want.startsWith(seen)) break;
    }
  }
  return null;
}
