// QIF (16 §1.3): sections `!Type:Bank`, `CCard`/`CC`, `Cash`, `Oth A`, `Oth L` (no `!Type:` line means
// Bank); an `!Account` block's `N` names the account that follows. Fields D, T/U, N, P, M, L and split
// lines S/E/$; C and A are ignored; `^` ends a record. Other `!Type:` sections (investments, lists) are
// skipped. Dates stay raw: their order is chosen later (16 §1.3).
import type {
  ParsedAccount,
  ParsedFile,
  ParsedSplit,
  ParsedTransaction,
} from '@shared/import/import-rules';
import { parseBankAmount } from '@shared/money';

const BANK_TYPES: Readonly<Record<string, string>> = {
  bank: 'Bank',
  ccard: 'CCard',
  cc: 'CCard',
  cash: 'Cash',
  'oth a': 'Oth A',
  'oth l': 'Oth L',
};

/** UTF-16 (Excel's "Unicode Text"): by its byte-order mark, else by the zero byte of ASCII text. */
function utf16Of(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const [a, b, c, d] = bytes;
  if (a === 0xff && b === 0xfe) return 'utf-16le';
  if (a === 0xfe && b === 0xff) return 'utf-16be';
  if (bytes.length < 4) return null;
  if (a !== 0 && b === 0 && c !== 0 && d === 0) return 'utf-16le';
  if (a === 0 && b !== 0 && c === 0 && d !== 0) return 'utf-16be';
  return null;
}

/**
 * QIF files are usually windows-1252; a UTF-8 file (with or without BOM) decodes as such, and so does
 * a UTF-16 one.
 */
export function decodeText(bytes: Uint8Array): string {
  const utf16 = utf16Of(bytes);
  if (utf16) return new TextDecoder(utf16).decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

interface Draft {
  rawDate: string;
  amount: number | null;
  payee: string;
  notes: string;
  checkNumber: string | null;
  category: string | null;
  splits: ParsedSplit[];
}

const blank = (): Draft => ({
  rawDate: '',
  amount: null,
  payee: '',
  notes: '',
  checkNumber: null,
  category: null,
  splits: [],
});

export function parseQif(bytes: Uint8Array): ParsedFile {
  const lines = decodeText(bytes).split(/\r\n|\r|\n/);
  const accounts: ParsedAccount[] = [];
  let section: string | null = 'Bank';
  let accountNumber: string | null = null;
  let inAccountBlock = false;
  let current: ParsedAccount | null = null;
  let draft = blank();
  let touched = false;

  const flush = (): void => {
    if (touched && section !== null && draft.rawDate !== '' && draft.amount !== null) {
      if (!current) {
        current = {
          key: accountNumber ? `qif|${accountNumber}` : null,
          type: section,
          number: accountNumber,
          transactions: [],
        };
        accounts.push(current);
      }
      const t: ParsedTransaction = {
        rawDate: draft.rawDate,
        date: null,
        amount: draft.amount,
        payee: draft.payee,
        notes: draft.notes,
        checkNumber: draft.checkNumber,
        fitId: null,
        category: draft.category,
        splits: draft.splits,
      };
      current.transactions.push(t);
    }
    draft = blank();
    touched = false;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') continue;
    if (line.startsWith('!')) {
      flush();
      const header = line.slice(1).trim();
      const lower = header.toLowerCase();
      if (lower === 'account') {
        inAccountBlock = true;
        accountNumber = null;
        current = null;
        section = 'Bank';
        continue;
      }
      if (lower.startsWith('type:')) {
        const type = BANK_TYPES[lower.slice(5).trim()];
        section = type ?? null;
        current = null;
      }
      // !Option / !Clear lines change nothing here.
      continue;
    }
    if (inAccountBlock) {
      if (line.startsWith('^')) inAccountBlock = false;
      else if (line.startsWith('N')) accountNumber = line.slice(1).trim() || null;
      continue;
    }
    if (line.startsWith('^')) {
      flush();
      continue;
    }
    const code = line.charAt(0);
    const value = line.slice(1).trim();
    touched = true;
    switch (code) {
      case 'D':
        draft.rawDate = value;
        break;
      case 'T':
      case 'U':
        draft.amount = parseBankAmount(value);
        break;
      case 'N':
        draft.checkNumber = value || null;
        break;
      case 'P':
        draft.payee = value;
        break;
      case 'M':
        draft.notes = value;
        break;
      case 'L':
        draft.category = value || null;
        break;
      case 'S':
        draft.splits.push({ category: value || null, notes: '', amount: 0 });
        break;
      case 'E': {
        const last = draft.splits.at(-1);
        if (last) last.notes = value;
        break;
      }
      case '$': {
        const last = draft.splits.at(-1);
        const amount = parseBankAmount(value);
        if (last && amount !== null) last.amount = amount;
        break;
      }
      default:
        break;
    }
  }
  flush();
  return { format: 'qif', accounts, emptyAccounts: 0 };
}
