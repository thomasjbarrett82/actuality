// File ▸ Print… (16 §3): the register's and the Budget screen's printouts.
import type { RegisterColumn } from '@shared/domain/register';
import type { CategoryGroup } from '@shared/domain/types';
import { DEFAULT_MONEY_SETTINGS } from '@shared/money';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetScreen } from '../budget/use-budget';
import type { Register } from '../register/use-register';
import { useSettings } from '../stores/settings';
import { GROUPS, monthView } from '../testing/fixtures';
import { printBudget, printRegister } from './print-flow';
import { PRINT_PALETTES } from './print-view';

const format = { money: DEFAULT_MONEY_SETTINGS, dateFormat: 'MM/dd/yyyy' };

/** The last print preview's HTML and PDF name. */
const printed = (): { html: string; pdfName: string } => {
  const call = vi.mocked(window.app.shell).printPreview.mock.calls.at(-1)?.[0];
  return { html: call?.html ?? '', pdfName: call?.pdfName ?? '' };
};

const t = (id: string, amount: number, over: Record<string, unknown> = {}) => ({
  id,
  amount,
  date: '2026-10-05',
  checkNumber: null,
  notes: '',
  cleared: 'U',
  ...over,
});

const register = (over: Record<string, unknown> = {}): Register =>
  ({
    visible: new Set<RegisterColumn>([
      'select',
      'account',
      'date',
      'check',
      'payee',
      'error',
      'category',
      'notes',
      'outflow',
      'inflow',
      'balance',
      'cleared',
    ]),
    columns: [],
    format,
    isAll: false,
    account: { name: 'Checking' },
    appliedSearch: '',
    searching: false,
    searchTotal: { count: 0, total: 0 },
    balancesTotal: { cleared: 100_00, uncleared: -25_00, working: 75_00 },
    dateFilter: { preset: 'thisMonth', from: null, to: null },
    items: [
      { kind: 'row', row: { t: { id: 't1' } }, balance: { working: 75_00 } },
      { kind: 'group' },
    ],
    shown: [
      {
        row: {
          t: t('t1', -25_00, { checkNumber: '101', notes: 'Weekly <shop>', cleared: 'C' }),
          accountName: 'Checking',
          payeeText: 'Kroger',
          categoryText: 'Groceries',
          lines: [],
        },
      },
      {
        row: {
          t: t('t2', 50_00, { cleared: 'R' }),
          accountName: 'Checking',
          payeeText: 'Employer',
          categoryText: 'Split',
          lines: [
            {
              transferText: 'Savings',
              categoryText: '',
              line: { notes: 'save', amount: -10_00 },
            },
            {
              transferText: '',
              categoryText: 'Income',
              line: { notes: '', amount: 60_00 },
            },
          ],
        },
      },
    ],
    ...over,
  }) as unknown as Register;

describe('register printout (16 §3)', () => {
  it('prints the account, its filter, the totals and the visible columns', async () => {
    await printRegister(register());
    const { html, pdfName } = printed();
    expect(pdfName).toBe('Checking.pdf');
    expect(html).toContain('<h1>Checking</h1>');
    expect(html).toContain('<dt>Showing:</dt><dd>This Month</dd>');
    expect(html).toContain('<dt>Cleared Balance</dt>');
    expect(html).not.toContain('Search:');
    // Select and Error are screen-only columns.
    expect(html.match(/<col style=/g)).toHaveLength(10);
    expect(html).toContain('<th class="num">Outflow</th>');
    expect(html).toContain('<td>101</td>');
    expect(html).toContain('<td>10/05/2026</td>');
    expect(html).toContain('<td>Weekly &lt;shop&gt;</td>');
    expect(html).toContain('<td>C</td>');
    expect(html).toContain('<td>R</td>');
    expect(html.match(/<tr class="line">/g)).toHaveLength(2);
    expect(html).toContain('<td class="indent">Savings</td>');
  });

  it('prints All Accounts with its search and custom dates, without hidden columns', async () => {
    await printRegister(
      register({
        isAll: true,
        account: null,
        visible: new Set<RegisterColumn>(['date', 'payee', 'outflow', 'inflow']),
        appliedSearch: 'kroger, ',
        searching: true,
        searchTotal: { count: 1, total: -25_00 },
        dateFilter: { preset: 'custom', from: '2026-01', to: '2026-03' },
      }),
    );
    const { html, pdfName } = printed();
    expect(pdfName).toBe('All Accounts.pdf');
    expect(html).toContain('<dt>Search:</dt><dd>kroger</dd>');
    expect(html).toContain('<dt>Search Total (1)</dt>');
    expect(html).toContain("<dd>Jan '26 - Mar '26</dd>");
    expect(html).not.toContain('Cleared</th>');
    expect(html.match(/<col style=/g)).toHaveLength(4);
  });

  it('names each date filter, and All Dates for one it does not know', async () => {
    const showing = async (preset: string): Promise<string> => {
      await printRegister(register({ dateFilter: { preset, from: null, to: null } }));
      return /<dt>Showing:<\/dt><dd>([^<]*)<\/dd>/.exec(printed().html)?.[1] ?? '';
    };
    expect(await showing('thisYear')).toBe('This Year');
    expect(await showing('lastYear')).toBe('Last Year');
    expect(await showing('all')).toBe('All Dates');
    expect(await showing('custom')).toBe('All Dates');
  });

  it('prints with the color-vision palette when it is on', async () => {
    useSettings().app = { ...useSettings().app, colorVision: 'cvd' };
    await printRegister(register());
    expect(printed().html).toContain(PRINT_PALETTES.cvd.negative);
  });
});

describe('budget printout (16 §3)', () => {
  const tree: CategoryGroup[] = GROUPS.map((g) =>
    g.id === 'g-bills'
      ? { ...g, categories: g.categories.map((c) => ({ ...c, hidden: true })) }
      : g,
  );

  const budget = (over: Record<string, unknown> = {}): BudgetScreen =>
    ({
      selected: '2026-10',
      views: new Map([
        [
          '2026-10',
          monthView(
            '2026-10',
            {
              'c-groceries': { budgeted: 400_00, activity: -300_00, balance: 100_00 },
              'c-rent': { budgeted: 1000_00, activity: -1000_00, balance: 0 },
            },
            {
              heldForNext: 50_00,
              toBudget: -20_00,
              uncategorized: { activity: -5_00, hasTransactions: true },
            },
            tree,
          ),
        ],
      ]),
      format,
      tree,
      ...over,
    }) as unknown as BudgetScreen;

  beforeEach(() => {
    vi.mocked(window.app.shell).printPreview.mockClear();
  });

  it("prints the month's summary and its visible categories, hidden ones as one row", async () => {
    await printBudget(budget());
    const { html, pdfName } = printed();
    expect(pdfName).toBe("Budget For Oct '26.pdf");
    expect(html).toContain("<dt>Not Budgeted in Sep '26</dt>");
    expect(html).toContain("<dt>Held for Nov '26</dt>");
    expect(html).toContain('<dt>Warning: Over-Budgeted</dt><dd class="neg">');
    expect(html).toContain('<tr class="group"><td>Uncategorized Transactions</td>');
    expect(html).toContain('<td class="indent">Groceries</td>');
    expect(html).not.toContain('>Rent</td>');
    expect(html).toContain('>Hidden Categories</td>');
    expect(html).toContain('<tr class="total"><td>Totals</td>');
    expect(html).toContain('<th class="num">Balance</th>');
  });

  it('prints nothing without a month on screen', async () => {
    await printBudget(budget({ selected: null }));
    await printBudget(budget({ views: new Map() }));
    expect(vi.mocked(window.app.shell).printPreview.mock.calls).toEqual([]);
  });
});
