// Register logic (10 §2, §7; 04 §8; 11 §7.3; 14 §1; 09 §6): the sort and its tie chain, running balances
// over the unfiltered list, column defaults, split commit rules and distribution, payee and category names.
import { describe, expect, it } from 'vitest';
import { categoryLabel, categoryNameError, groupNameError } from './categories';
import { isBankGeneric, transferAccountName } from './payees';
import {
  balanceSortKeys,
  comparator,
  DEFAULT_SORT,
  defaultColumns,
  nextSortKeys,
  runningBalances,
  runningBalancesById,
  visibilityKey,
  type RegisterSort,
  type SortRow,
} from './register';
import { distribute, finalizeSplit, remainingOf, type SplitLineDraft } from './splits';

function row(r: Partial<SortRow> & { id: string }): SortRow {
  return {
    date: '2026-10-01',
    amount: 0,
    checkNumber: null,
    payeeText: '',
    categoryText: '',
    notes: '',
    accountName: '',
    cleared: 'U',
    errorLevel: 'none',
    ...r,
  };
}

const ids = (rows: SortRow[]): string[] => rows.map((r) => r.id);

describe('sorting (10 §2)', () => {
  it('defaults to date descending, newest at the top', () => {
    expect(DEFAULT_SORT).toEqual({ field: 'date', desc: true });
    const rows = [row({ id: 'a', date: '2026-10-01' }), row({ id: 'b', date: '2026-10-02' })];
    expect(ids(rows.sort(comparator(DEFAULT_SORT)))).toEqual(['b', 'a']);
  });
  it('breaks ties by Date → Amount → Check # (natural) → Payee → Category → Notes → Cleared → Error', () => {
    const rows = [
      row({
        id: 'last',
        amount: 5,
        checkNumber: '9',
        payeeText: 'A',
        categoryText: 'A',
        notes: 'A',
        cleared: 'C',
        errorLevel: 'error',
      }),
      row({
        id: 'error',
        amount: 5,
        checkNumber: '9',
        payeeText: 'A',
        categoryText: 'A',
        notes: 'A',
        cleared: 'C',
        errorLevel: 'none',
      }),
      row({
        id: 'cleared',
        amount: 5,
        checkNumber: '9',
        payeeText: 'A',
        categoryText: 'A',
        notes: 'A',
        cleared: 'U',
      }),
      row({
        id: 'notes',
        amount: 5,
        checkNumber: '9',
        payeeText: 'A',
        categoryText: 'A',
        notes: 'B',
      }),
      row({ id: 'category', amount: 5, checkNumber: '9', payeeText: 'A', categoryText: 'B' }),
      row({ id: 'payee', amount: 5, checkNumber: '9', payeeText: 'B' }),
      row({ id: 'check10', amount: 5, checkNumber: '10' }),
      row({ id: 'amount', amount: 7 }),
    ];
    expect(ids([...rows].reverse().sort(comparator({ field: 'date', desc: false })))).toEqual([
      'cleared',
      'error',
      'last',
      'notes',
      'category',
      'payee',
      'check10',
      'amount',
    ]);
  });
  it('reverses the whole order on a second click', () => {
    const rows = [row({ id: 'a', amount: 1 }), row({ id: 'b', amount: 2 })];
    expect(ids(rows.sort(comparator({ field: 'date', desc: true })))).toEqual(['b', 'a']);
  });
  it('sorts outflow and inflow by their own side', () => {
    const rows = [
      row({ id: 'in', amount: 500 }),
      row({ id: 'big', amount: -900 }),
      row({ id: 'small', amount: -100 }),
    ];
    expect(ids([...rows].sort(comparator({ field: 'outflow', desc: false })))).toEqual([
      'in',
      'small',
      'big',
    ]);
    expect(ids([...rows].sort(comparator({ field: 'inflow', desc: true }))).slice(0, 1)).toEqual([
      'in',
    ]);
  });
  it('orders a day by signed amount ascending whichever way the dates run', () => {
    const day = [
      row({ id: 'bigIn', amount: 500 }),
      row({ id: 'smallOut', amount: -100 }),
      row({ id: 'zero', amount: 0 }),
      row({ id: 'smallIn', amount: 100 }),
      row({ id: 'bigOut', amount: -900 }),
      row({ id: 'later', date: '2026-10-02', amount: -50 }),
    ];
    const order = ['bigOut', 'smallOut', 'zero', 'smallIn', 'bigIn'];
    const opts = { sameDayByAmount: true };
    expect(ids([...day].sort(comparator({ field: 'date', desc: false }, opts)))).toEqual([
      ...order,
      'later',
    ]);
    expect(ids([...day].sort(comparator({ field: 'date', desc: true }, opts)))).toEqual([
      'later',
      ...order,
    ]);
    // An explicit Outflow or Inflow key keeps its own direction.
    const inflowDesc: RegisterSort[] = [
      { field: 'date', desc: true },
      { field: 'inflow', desc: true },
    ];
    expect(ids([...day].sort(comparator(inflowDesc, opts)))).toEqual([
      'later',
      'bigIn',
      'smallIn',
      'bigOut',
      'smallOut',
      'zero',
    ]);
    // Without the register option (the scheduler) the chain follows the primary direction.
    expect(ids([...day].sort(comparator({ field: 'date', desc: true }))).slice(1)).toEqual(
      [...order].reverse(),
    );
  });
  it('sorts check numbers in natural order', () => {
    const rows = [
      row({ id: '10', checkNumber: '10' }),
      row({ id: '9', checkNumber: '9' }),
      row({ id: 'none' }),
    ];
    expect(ids(rows.sort(comparator({ field: 'check', desc: false })))).toEqual([
      'none',
      '9',
      '10',
    ]);
  });
});

describe('multisort (10 §2, §11 criterion 7)', () => {
  const rows = [
    row({ id: 'a', payeeText: 'Shell', categoryText: 'Fuel', amount: -100 }),
    row({ id: 'b', payeeText: 'Kroger', categoryText: 'Groceries', amount: -300 }),
    row({ id: 'c', payeeText: 'Kroger', categoryText: 'Fuel', amount: -200 }),
    row({ id: 'd', payeeText: 'Shell', categoryText: 'Fuel', amount: -400 }),
  ];
  const sorted = (keys: Parameters<typeof comparator>[0]): string[] =>
    ids([...rows].sort(comparator(keys)));

  it('compares by each key in its own direction', () => {
    expect(
      sorted([
        { field: 'payee', desc: false },
        { field: 'category', desc: true },
      ]),
    ).toEqual(['b', 'c', 'd', 'a']);
    expect(
      sorted([
        { field: 'payee', desc: true },
        { field: 'category', desc: false },
      ]),
    ).toEqual(['a', 'd', 'c', 'b']);
  });
  it('ignores a repeated column', () => {
    expect(
      sorted([
        { field: 'payee', desc: false },
        { field: 'payee', desc: true },
        { field: 'category', desc: true },
      ]),
    ).toEqual(
      sorted([
        { field: 'payee', desc: false },
        { field: 'category', desc: true },
      ]),
    );
  });
  it("skips the keys in the tie chain, which takes the primary key's direction", () => {
    // Amount is a later key, ascending; the rest of the chain follows the primary (descending).
    const tied = [
      row({ id: 'x2', payeeText: 'P', amount: 5, notes: 'b' }),
      row({ id: 'x1', payeeText: 'P', amount: 5, notes: 'a' }),
      row({ id: 'y', payeeText: 'P', amount: 1, notes: 'z' }),
    ];
    const keys = [
      { field: 'payee', desc: true },
      { field: 'amount', desc: false },
    ];
    expect(ids(tied.sort(comparator(keys)))).toEqual(['y', 'x2', 'x1']);
  });
  it('a single key behaves as before', () => {
    expect(sorted([{ field: 'amount', desc: true }])).toEqual(
      sorted({ field: 'amount', desc: true }),
    );
  });
});

describe('header clicks (10 §2)', () => {
  const date = { field: 'date', desc: false } as const;
  it('a plain click sorts by that column alone, reversing the primary key', () => {
    expect(nextSortKeys([date], 'date', false)).toEqual([{ field: 'date', desc: true }]);
    expect(nextSortKeys([date], 'payee', false)).toEqual([{ field: 'payee', desc: false }]);
    const two = [date, { field: 'payee', desc: true } as const];
    expect(nextSortKeys(two, 'date', false)).toEqual([{ field: 'date', desc: true }]);
    expect(nextSortKeys(two, 'payee', false)).toEqual([{ field: 'payee', desc: false }]);
  });
  it('Shift+click adds, cycles in place and removes keys', () => {
    let keys = nextSortKeys([date], 'payee', true);
    expect(keys).toEqual([date, { field: 'payee', desc: false }]);
    keys = nextSortKeys(keys, 'category', true);
    keys = nextSortKeys(keys, 'payee', true);
    expect(keys).toEqual([
      date,
      { field: 'payee', desc: true },
      { field: 'category', desc: false },
    ]);
    keys = nextSortKeys(keys, 'payee', true);
    expect(keys).toEqual([date, { field: 'category', desc: false }]);
  });
  it('removing the last key restores the default', () => {
    expect(nextSortKeys([{ field: 'payee', desc: true }], 'payee', true)).toEqual([DEFAULT_SORT]);
  });
  it('stops at 4 keys and ignores columns that are not sortable', () => {
    const four = (['date', 'payee', 'category', 'notes'] as const).map((field) => ({
      field,
      desc: false,
    }));
    expect(nextSortKeys(four, 'inflow', true)).toEqual(four);
    expect(nextSortKeys(four, 'balance', false)).toEqual(four);
    expect(nextSortKeys(four, 'select', true)).toEqual(four);
  });
});

describe('running balances (04 §8, 10 §7.4, §11 criterion 3)', () => {
  const key = (field: RegisterSort['field'], desc: boolean): RegisterSort => ({ field, desc });
  const D = key('date', true);
  const A = key('date', false);
  const OD = key('outflow', true);
  const OA = key('outflow', false);
  const ID = key('inflow', true);
  const IA = key('inflow', false);

  it('normalizes the display keys into the balance keys', () => {
    expect(balanceSortKeys([key('payee', false)])).toEqual([D, OD, IA]);
    expect(balanceSortKeys([A])).toEqual([A, OD, IA]);
    expect(balanceSortKeys([OD])).toEqual([D, OD, IA]);
    expect(balanceSortKeys([OA])).toEqual([D, OA, IA]);
    expect(balanceSortKeys([ID])).toEqual([D, ID, OD]);
    expect(balanceSortKeys([IA])).toEqual([D, IA, OD]);
    expect(balanceSortKeys([key('payee', false), ID, OA])).toEqual([D, ID, OA]);
    expect(balanceSortKeys([IA, A, key('notes', true), OA])).toEqual([A, IA, OA]);
  });

  // Opening 1000 on the 1st; on the 2nd an inflow of 300 and outflows of 200 and 50.
  const rows = [
    row({ id: 'open', date: '2026-10-01', amount: 1000, cleared: 'R', payeeText: 'Z' }),
    row({ id: 'in', date: '2026-10-02', amount: 300, payeeText: 'A' }),
    row({ id: 'small', date: '2026-10-02', amount: -50, cleared: 'C', payeeText: 'M' }),
    row({ id: 'big', date: '2026-10-02', amount: -200, payeeText: 'B' }),
  ];
  const working = (keys: RegisterSort[], list = rows): Record<string, number> =>
    Object.fromEntries([...runningBalancesById(list, keys)].map(([id, b]) => [id, b.working]));

  it('accumulates oldest first; in a date sort each row is the one below it plus its amount', () => {
    // Date ascending: the day reads largest outflow first, largest inflow last, top to bottom.
    expect(working([A])).toEqual({ open: 1000, big: 800, small: 750, in: 1050 });
    // Date descending (the default): the same rows, newest at the top, accumulated from the bottom.
    expect(working([D])).toEqual({ open: 1000, in: 1300, small: 1250, big: 1050 });
    const display = [...rows].sort(comparator([D], { sameDayByAmount: true }));
    const b = runningBalancesById(rows, [D]);
    expect(ids(display)).toEqual(['big', 'small', 'in', 'open']);
    display.slice(0, -1).forEach((r, i) => {
      const below = display[i + 1] as SortRow;
      expect(b.get(r.id)?.working).toBe((b.get(below.id)?.working ?? 0) + r.amount);
    });
  });
  it('keeps cleared and uncleared apart', () => {
    expect(runningBalancesById(rows, [A]).get('small')).toEqual({
      cleared: 950,
      uncleared: -200,
      working: 750,
    });
  });
  it('follows Outflow and Inflow keys within a day', () => {
    // Date descending → Outflow ascending → Inflow ascending: the day reads in, small, big top to
    // bottom, so it accumulates big, small, in.
    expect(working([OA])).toEqual({ open: 1000, big: 800, small: 750, in: 1050 });
    // Date descending → Inflow descending → Outflow descending: in, big, small; accumulated small first.
    expect(working([ID])).toEqual({ open: 1000, small: 950, big: 750, in: 1050 });
    // Date ascending → Inflow ascending → Outflow ascending: small, big, in.
    expect(working([A, IA, OA])).toEqual({ open: 1000, small: 950, big: 750, in: 1050 });
    // Date ascending → Outflow ascending → Inflow descending: in, small, big.
    expect(working([OA, A, ID])).toEqual({ open: 1000, in: 1300, small: 1250, big: 1050 });
  });
  it('ignores other display keys', () => {
    expect(working([key('payee', false)])).toEqual(working([D]));
    expect(working([key('payee', true), key('notes', false)])).toEqual(working([D]));
    expect(working([key('payee', false), A])).toEqual(working([A]));
  });
  it('counts the rows a filter or reconciliation hides', () => {
    // The caller passes every row of the account, so a hidden opening balance still counts.
    expect(working([A])['in']).toBe(1050);
    expect(working([A], rows.slice(1))['in']).toBe(50);
  });
  it('accumulates cleared, uncleared and working balances in list order', () => {
    expect(
      runningBalances([
        { amount: 1000, cleared: 'R' },
        { amount: -200, cleared: 'U' },
        { amount: -300, cleared: 'C' },
      ]),
    ).toEqual([
      { cleared: 1000, uncleared: 0, working: 1000 },
      { cleared: 1000, uncleared: -200, working: 800 },
      { cleared: 700, uncleared: -200, working: 500 },
    ]);
  });
});

describe('columns (10 §2)', () => {
  it('shows Check # and Running Balance hidden by default', () => {
    const visible = defaultColumns()
      .filter((c) => c.visible)
      .map((c) => c.field);
    expect(visible).not.toContain('check');
    expect(visible).not.toContain('balance');
    expect(visible).toEqual(expect.arrayContaining(['notes', 'cleared']));
  });
  it('compares visibility, not widths', () => {
    const a = defaultColumns();
    const b = a.map((c) => ({ ...c, width: c.width + 1 }));
    expect(visibilityKey(a)).toBe(visibilityKey(b));
    expect(visibilityKey(a)).not.toBe(
      visibilityKey(a.map((c) => (c.field === 'check' ? { ...c, visible: true } : c))),
    );
  });
});

const ln = (l: Partial<SplitLineDraft>): SplitLineDraft => ({
  id: null,
  transferAccountId: null,
  categoryId: null,
  notes: '',
  amount: 0,
  ...l,
});

describe('split commit rules (11 §7.3)', () => {
  it('discards empty lines; none left is no split', () => {
    expect(finalizeSplit({ hasPayee: true, notes: '', amount: -100 }, [ln({}), ln({})])).toEqual({
      kind: 'none',
    });
  });
  it('collapses one line into the empty parent fields', () => {
    expect(
      finalizeSplit({ hasPayee: true, notes: '', amount: 0 }, [
        ln({ categoryId: 'c', notes: 'x', amount: -500 }),
        ln({}),
      ]),
    ).toEqual({
      kind: 'collapse',
      transferAccountId: null,
      categoryId: 'c',
      notes: 'x',
      amount: -500,
    });
  });
  it('keeps the split when one line conflicts with the parent', () => {
    expect(
      finalizeSplit({ hasPayee: true, notes: '', amount: 0 }, [
        ln({ transferAccountId: 'sav', amount: -5 }),
      ]).kind,
    ).toBe('split');
    expect(
      finalizeSplit({ hasPayee: false, notes: 'a', amount: 0 }, [ln({ notes: 'b', amount: -5 })])
        .kind,
    ).toBe('split');
    expect(
      finalizeSplit({ hasPayee: false, notes: '', amount: -10 }, [
        ln({ categoryId: 'c', amount: -5 }),
      ]).kind,
    ).toBe('split');
    expect(
      finalizeSplit({ hasPayee: false, notes: 'a', amount: -5 }, [
        ln({ notes: 'a', amount: -5, categoryId: 'c' }),
      ]).kind,
    ).toBe('collapse');
  });
  it('computes the amount remaining to assign', () => {
    expect(remainingOf(-15000, [ln({ amount: -10000 }), ln({ amount: -2000 })])).toBe(-3000);
  });
  it('auto-distributes proportionally, truncating, with the remainder on the largest line', () => {
    // 1 cent over 3 equal-ish lines: shares truncate to 0; the remainder goes to the largest.
    expect(
      distribute(-1, [ln({ amount: -100 }), ln({ amount: -300 }), ln({ amount: -200 })]),
    ).toEqual([-100, -301, -200]);
    expect(distribute(-1000, [ln({ amount: -3000 }), ln({ amount: -1000 })])).toEqual([
      -3750, -1250,
    ]);
  });
  it('splits evenly when every line is zero, the remainder to the first', () => {
    expect(distribute(-100, [ln({}), ln({}), ln({})])).toEqual([-34, -33, -33]);
  });
});

describe('payee names (14 §1, 11 §4.1)', () => {
  it('knows the bank-generic names, in any case', () => {
    expect(isBankGeneric('  check ')).toBe(true);
    expect(isBankGeneric('Kroger')).toBe(false);
  });
  it('reads "Transfer : X" whitespace- and case-insensitively', () => {
    expect(transferAccountName('Transfer : Savings', ['Transfer :'])).toBe('Savings');
    expect(transferAccountName('transfer:Visa Card', ['Transfer :'])).toBe('Visa Card');
    expect(transferAccountName('Tr', ['Transfer :'])).toBeNull();
    expect(transferAccountName('Kroger', ['Transfer :'])).toBeNull();
    expect(transferAccountName('Überweisung : Sparen', ['Überweisung :', 'Transfer :'])).toBe(
      'Sparen',
    );
  });
});

describe('category names (09 §6.1–6.2)', () => {
  it('checks category names in their group', () => {
    expect(categoryNameError(' ', [])).toBe('empty');
    expect(categoryNameError('a:b', [])).toBe('characters');
    expect(categoryNameError('a`b', [])).toBe('characters');
    expect(categoryNameError('groceries', ['Groceries'])).toBe('duplicate');
    expect(categoryNameError('Fuel', ['Groceries'])).toBeNull();
  });
  it('checks group names, refusing Income and the reserved names', () => {
    expect(groupNameError('income', [])).toBe('income');
    expect(groupNameError('Hidden Categories', [])).toBe('reserved');
    expect(groupNameError('Versteckt', [], ['Versteckt'])).toBe('reserved');
    expect(groupNameError('bills', ['Bills'])).toBe('duplicate');
    expect(groupNameError('Savings Goals', ['Bills'])).toBeNull();
  });
  it('labels categories "Group: Category"', () => {
    expect(categoryLabel({ name: 'Income' }, { name: 'Salary' })).toBe('Income: Salary');
  });
});
