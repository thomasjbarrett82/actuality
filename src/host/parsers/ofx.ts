// OFX / QFX (16 §1.3): a tolerant reader for both the SGML (OFX 1.x, unclosed leaf tags) and XML (2.x)
// forms. Statements: bank `<STMTRS>`, credit card `<CCSTMTRS>`, and `<INVSTMTRS>` (only the `<STMTTRN>`
// inside `<INVTRANLIST>`). The `<SIGNONMSGSRS>` FID overrides `<BANKID>`/`<BROKERID>` in the mapping key.
import { isISODate, toISODate } from '@shared/dates';
import type { ParsedAccount, ParsedFile, ParsedTransaction } from '@shared/import/import-rules';
import { parseBankAmount } from '@shared/money';

interface Node {
  name: string;
  value: string | null;
  children: Node[];
}

/** The character set from the headers: XML `encoding`, SGML `ENCODING:UTF-8`, else `CHARSET`, else 1252. */
export function ofxEncoding(head: string): string {
  const xml = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head);
  if (xml?.[1]) return xml[1].toLowerCase();
  if (/^\s*ENCODING\s*:\s*UTF-?8\s*$/im.test(head)) return 'utf-8';
  const charset = /^\s*CHARSET\s*:\s*(\S+)\s*$/im.exec(head)?.[1]?.toUpperCase();
  if (!charset || charset === 'NONE') return 'windows-1252';
  if (/^\d+$/.test(charset)) return `windows-${charset}`;
  return charset.toLowerCase();
}

/** Decodes the file with its declared character set (default windows-1252). */
export function decodeOfx(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  let label = ofxEncoding(head);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    label = 'windows-1252';
    return new TextDecoder(label).decode(bytes);
  }
}

const unescape = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** Builds the element tree. A leaf's value ends at the next tag; SGML leaves have no closing tag. */
function readTree(text: string): Node {
  const root: Node = { name: '#root', value: null, children: [] };
  const stack: Node[] = [root];
  const body = text.replace(/<\?[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const tag = /<\s*(\/)?\s*([A-Za-z0-9_.]+)[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const top = (): Node => stack[stack.length - 1] ?? root;
  const text_ = (s: string): void => {
    const v = s.trim();
    if (v === '') return;
    const node = top();
    if (node !== root && node.children.length === 0) node.value = unescape(v);
  };
  while ((m = tag.exec(body)) !== null) {
    text_(body.slice(last, m.index));
    last = tag.lastIndex;
    const name = (m[2] ?? '').toUpperCase();
    if (m[1]) {
      // Close: pop up to the matching element, closing unclosed leaves on the way.
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    // A leaf with a value is closed by the next tag (SGML).
    if (top().value !== null) stack.pop();
    const node: Node = { name, value: null, children: [] };
    top().children.push(node);
    stack.push(node);
    if (/\/\s*>$/.test(m[0])) stack.pop();
  }
  text_(body.slice(last));
  return root;
}

const find = (n: Node, name: string): Node | undefined => {
  for (const c of n.children) {
    if (c.name === name) return c;
    const deeper = find(c, name);
    if (deeper) return deeper;
  }
  return undefined;
};

const findAll = (n: Node, name: string, out: Node[] = []): Node[] => {
  for (const c of n.children) {
    if (c.name === name) out.push(c);
    else findAll(c, name, out);
  }
  return out;
};

const valueOf = (n: Node | undefined, name: string): string | null =>
  (n ? find(n, name)?.value : null) ?? null;

/** `<DTPOSTED>`: its YYYYMMDD prefix. */
function dateOf(raw: string | null): string | null {
  const m = raw ? /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim()) : null;
  if (!m) return null;
  const d = toISODate(Number(m[1]), Number(m[2]), Number(m[3]));
  return isISODate(d) ? d : null;
}

function transaction(t: Node): ParsedTransaction | null {
  const date = dateOf(valueOf(t, 'DTPOSTED'));
  const amount = parseBankAmount(valueOf(t, 'TRNAMT') ?? '', true);
  if (!date || amount === null) return null;
  // NAME and PAYEE (or PAYEE's own NAME): the last one in the file wins.
  let payee = '';
  for (const c of t.children) {
    if (c.name === 'NAME' && c.value) payee = c.value;
    if (c.name === 'PAYEE') payee = c.value ?? valueOf(c, 'NAME') ?? payee;
  }
  const type = (valueOf(t, 'TRNTYPE') ?? '').toUpperCase();
  const check = valueOf(t, 'CHECKNUM') ?? (type === 'CHECK' ? valueOf(t, 'REFNUM') : null);
  return {
    rawDate: date,
    date: date as ParsedTransaction['date'],
    amount,
    payee: payee.trim(),
    notes: (valueOf(t, 'MEMO') ?? '').trim(),
    checkNumber: check?.trim() || null,
    fitId: valueOf(t, 'FITID')?.trim() || null,
    category: null,
    splits: [],
  };
}

export function parseOfx(bytes: Uint8Array): ParsedFile {
  const tree = readTree(decodeOfx(bytes));
  const signonFid = valueOf(find(tree, 'SIGNONMSGSRSV1') ?? find(tree, 'SIGNONMSGSRS'), 'FID');
  const accounts: ParsedAccount[] = [];
  let emptyAccounts = 0;
  let droppedUnreadable = 0;
  const add = (stmt: Node, from: Node | undefined, kind: 'bank' | 'cc' | 'inv'): void => {
    const lists = kind === 'inv' ? findAll(stmt, 'INVTRANLIST') : [stmt];
    const rows = lists.flatMap((l) => findAll(l, 'STMTTRN'));
    const transactions = rows.flatMap((t) => transaction(t) ?? []);
    const unreadable = rows.length - transactions.length;
    if (transactions.length === 0) {
      emptyAccounts++;
      droppedUnreadable += unreadable;
      return;
    }
    const number = valueOf(from, 'ACCTID');
    const fid = signonFid ?? valueOf(from, kind === 'inv' ? 'BROKERID' : 'BANKID');
    accounts.push({
      key: number ? `${fid ?? ''}|${number}` : null,
      type:
        valueOf(from, 'ACCTTYPE') ??
        (kind === 'cc' ? 'CREDITCARD' : kind === 'inv' ? 'INVESTMENT' : null),
      number,
      transactions,
      ...(unreadable > 0 ? { unreadable } : {}),
    });
  };
  for (const s of findAll(tree, 'STMTRS')) add(s, find(s, 'BANKACCTFROM'), 'bank');
  for (const s of findAll(tree, 'CCSTMTRS')) add(s, find(s, 'CCACCTFROM'), 'cc');
  for (const s of findAll(tree, 'INVSTMTRS')) add(s, find(s, 'INVACCTFROM'), 'inv');
  return {
    format: 'ofx',
    accounts,
    emptyAccounts,
    ...(droppedUnreadable > 0 ? { unreadable: droppedUnreadable } : {}),
  };
}
