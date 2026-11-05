// Golden-file tests for the bank-file parsers (16 §1.3, §4 criterion 1): OFX in its SGML and XML forms,
// QFX with an investment statement, QIF with splits, several accounts and every date order, and CSV with
// Amount vs Outflow/Inflow. Each fixture's parse is compared with its `.golden.json`.
import { dateOf, defaultOrder, importIds, validOrders } from '@shared/import/import-rules';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CsvFormatError, formatOf, parseBankFile } from './index';
import { ofxEncoding } from './ofx';

const dir = join(import.meta.dirname, 'fixtures');
const parse = (name: string) => {
  const format = formatOf(name);
  if (!format) throw new Error(`no format for ${name}`);
  return parseBankFile(new Uint8Array(readFileSync(join(dir, name))), format);
};
const golden = (name: string) => `./fixtures/${name}.golden.json`;

describe('golden files (16 §4 criterion 1)', () => {
  it.each([
    'bank-sgml.ofx',
    'card-xml.ofx',
    'broker.qfx',
    'accounts.qif',
    'dmy.qif',
    'ymd.qif',
    'amount.csv',
    'outflow-inflow.csv',
  ])('%s', async (name) => {
    await expect(`${JSON.stringify(parse(name), null, 2)}\n`).toMatchFileSnapshot(golden(name));
  });
});

describe('OFX details', () => {
  it('drops undated transactions and accounts without transactions', () => {
    const file = parse('bank-sgml.ofx');
    expect(file.accounts).toHaveLength(1);
    expect(file.accounts[0]?.transactions.map((t) => t.fitId)).not.toContain('nodate');
    expect(file.accounts[0]?.unreadable).toBe(1);
  });
  it('keys by the sign-on FID, reads windows-1252 and REFNUM for checks', () => {
    const [a] = parse('bank-sgml.ofx').accounts;
    expect(a?.key).toBe('12345|000111222333');
    expect(a?.transactions[0]?.payee).toBe('CAFÉ ROUGE & CO');
    expect(a?.transactions[1]?.checkNumber).toBe('1042');
    expect(a?.transactions[2]).toMatchObject({ amount: 123_450, checkNumber: '77' });
  });
  it('reads only INVTRANLIST transactions of an investment statement', () => {
    const [a] = parse('broker.qfx').accounts;
    expect(a?.key).toBe('broker.example|Z-77');
    expect(a?.transactions.map((t) => t.fitId)).toEqual(['D1']);
  });
  it('keeps the unreadable count of an account it drops for having no readable transactions', () => {
    const ofx =
      'OFXHEADER:100<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>1</BANKACCTFROM>' +
      '<BANKTRANLIST><STMTTRN><DTPOSTED>2026<TRNAMT>-1.00</STMTTRN>' +
      '<STMTTRN><DTPOSTED>20261001<TRNAMT>abc</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS>' +
      '</BANKMSGSRSV1></OFX>';
    expect(parseBankFile(new TextEncoder().encode(ofx), 'ofx')).toEqual({
      format: 'ofx',
      accounts: [],
      emptyAccounts: 1,
      unreadable: 2,
    });
  });
  it('picks the character set from the headers', () => {
    expect(ofxEncoding('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe('iso-8859-1');
    expect(ofxEncoding('ENCODING:UTF-8\nCHARSET:NONE')).toBe('utf-8');
    expect(ofxEncoding('CHARSET:1252')).toBe('windows-1252');
    expect(ofxEncoding('')).toBe('windows-1252');
  });
});

describe('QIF and CSV dates (16 §1.3)', () => {
  const raws = (name: string) =>
    parse(name).accounts.flatMap((a) => a.transactions.map((t) => t.rawDate));
  it('offers only the orders that parse every date', () => {
    expect(validOrders(raws('accounts.qif'))).toEqual(['MDY']);
    expect(validOrders(raws('dmy.qif'))).toEqual(['DMY']);
    expect(validOrders(raws('ymd.qif'))).toEqual(['YMD']);
    expect(validOrders(['01/02/2026'])).toEqual(['DMY', 'MDY']);
    expect(validOrders(['2026-13-40'])).toEqual([]);
  });
  it('defaults to a remembered order, then the budget’s, then the first valid', () => {
    expect(defaultOrder(['DMY', 'MDY'], 'MDY', 'DMY')).toBe('DMY');
    expect(defaultOrder(['DMY', 'MDY'], 'MDY', 'YMD')).toBe('MDY');
    expect(defaultOrder(['DMY'], 'MDY')).toBe('DMY');
    expect(defaultOrder([], 'MDY')).toBeNull();
  });
  it('reads Quicken’s apostrophe years', () => {
    const [t] = parse('accounts.qif').accounts[0]?.transactions ?? [];
    expect(t && dateOf(t, 'MDY')).toBe('2026-01-05');
  });
});

describe('QIF', () => {
  it('starts a new account for consecutive !Account blocks without a type header', () => {
    const file = parseBankFile(
      new TextEncoder().encode(
        '!Account\nNChecking\n^\n!Type:CCard\nD01/05/2026\nT-10.00\nPShop\n^\n' +
          '!Account\nNSavings\n^\nD01/06/2026\nT-20.00\nPMarket\n^\n',
      ),
      'qif',
    );
    expect(file.accounts.map((a) => [a.key, a.type, a.transactions.map((t) => t.payee)])).toEqual([
      ['qif|Checking', 'CCard', ['Shop']],
      ['qif|Savings', 'Bank', ['Market']],
    ]);
  });

  it('splits accounts, reads splits and skips investment sections', () => {
    const file = parse('accounts.qif');
    expect(file.accounts.map((a) => [a.key, a.type, a.transactions.length])).toEqual([
      ['qif|Checking 4455', 'Bank', 2],
      ['qif|Visa 9911', 'CCard', 1],
    ]);
    const market = file.accounts[0]?.transactions[1];
    expect(market?.splits).toEqual([
      { category: 'Groceries', notes: 'Food', amount: 3000 },
      { category: 'Household: Cleaning: Supplies', notes: '', amount: 1200 },
    ]);
    expect(file.accounts[1]?.transactions[0]?.amount).toBe(-2500);
  });
});

describe('CSV', () => {
  it('reads Amount or Outflow/Inflow, quoting, and skips rows without a date or amount', () => {
    const a = parse('amount.csv').accounts[0]?.transactions ?? [];
    expect(a.map((t) => [t.payee, t.amount])).toEqual([
      ['Kroger, Inc.', -4520],
      ['Employer', 200_000],
      ['Water Co', -3000],
    ]);
    expect(a[0]?.notes).toBe('He said "hi"');
    expect(a[2]).toMatchObject({ notes: 'two\r\nlines', checkNumber: '1043' });
    const b = parse('outflow-inflow.csv').accounts[0]?.transactions ?? [];
    expect(b.map((t) => t.amount)).toEqual([-350, 1000]);
  });
  it('refuses a file without the required columns', () => {
    expect(() => parse('bad.csv')).toThrow(CsvFormatError);
  });
  it('reads UTF-16, with or without a byte-order mark (Excel "Unicode Text")', () => {
    const text = 'Date\tPayee\tAmount\r\n10/01/2026\tCafé\t-4.50\r\n';
    const le = Buffer.from(text, 'utf16le');
    const be = Buffer.from(le).swap16();
    for (const bytes of [
      Buffer.concat([Buffer.from([0xff, 0xfe]), le]),
      le,
      Buffer.concat([Buffer.from([0xfe, 0xff]), be]),
      be,
    ]) {
      const [t] = parseBankFile(new Uint8Array(bytes), 'csv').accounts[0]?.transactions ?? [];
      expect(t).toMatchObject({ rawDate: '10/01/2026', payee: 'Café', amount: -450 });
    }
  });
});

describe('import ids (16 §1.3)', () => {
  it('uses FITID, else a stable key counting repeats', () => {
    expect(
      importIds([
        { fitId: 'F1', amount: -5, date: '2026-01-01', payee: 'X' },
        { fitId: null, amount: -5, date: '2026-01-01', payee: ' Shop ' },
        { fitId: null, amount: -5, date: '2026-01-01', payee: 'shop' },
      ]),
    ).toEqual(['F1', 'AD:-5:2026-01-01:shop:1', 'AD:-5:2026-01-01:shop:2']);
  });
});
