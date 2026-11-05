// Payee writes on the fake API (14 §1, §3–4): rename (new name, capitalization, merge, transfer) with the
// rename-rule upkeep, combine, enable/disable, the app's rules, and applying rename rules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawAccount, RawRule } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { MetadataRepository } from './metadata';
import { conditionMatches, PayeesService } from './payees';

const account = (a: Partial<RawAccount> & { id: string; name: string }): RawAccount => ({
  offbudget: false,
  closed: false,
  sortOrder: 0,
  accountGroupId: null,
  ...a,
});

describe('PayeesService (14 §3–4)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let service: PayeesService;
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };
  const payeeOf = (id: string): string | null =>
    budget().transactions.find((t) => t.id === id)?.payee ?? null;
  const ruleFor = (payeeId: string): RawRule | undefined =>
    budget().rules.find((r) => r.stage === 'pre' && r.actions[0]?.value === payeeId);

  beforeEach(async () => {
    vi.useFakeTimers();
    actual = new FakeActual();
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      accounts: [
        account({ id: 'a-check', name: 'Checking' }),
        account({ id: 'a-save', name: 'Savings' }),
      ],
      payees: [
        { id: 'tp-a-check', name: '', transferAcct: 'a-check' },
        { id: 'tp-a-save', name: '', transferAcct: 'a-save' },
        { id: 'p-krog', name: 'Krogers #123', transferAcct: null },
        { id: 'p-kroger', name: 'Kroger', transferAcct: null },
        { id: 'p-shell', name: 'Shell', transferAcct: null },
        { id: 'p-mover', name: 'Mover', transferAcct: null },
      ],
      rules: [
        {
          id: 'r-shell',
          stage: 'pre',
          conditionsOp: 'or',
          conditions: [
            { field: 'imported_payee', op: 'is', value: 'Krogers #123', type: 'string' },
          ],
          actions: [{ op: 'set', field: 'payee', value: 'p-shell', type: 'id' }],
        },
      ],
      transactions: [
        rawTransaction({
          id: 't1',
          account: 'a-check',
          payee: 'p-krog',
          category: null,
          importedPayee: 'KROGERS #123 OH',
        }),
        rawTransaction({ id: 't2', account: 'a-check', payee: 'p-krog', category: 'c-food' }),
        rawTransaction({ id: 't3', account: 'a-check', payee: 'p-kroger' }),
        rawTransaction({ id: 't4', account: 'a-check', payee: 'p-mover' }),
        rawTransaction({ id: 't5', account: 'a-save', payee: 'p-mover' }),
        rawTransaction({
          id: 't6',
          account: 'a-check',
          payee: 'p-shell',
          importedPayee: 'KRG 1234',
        }),
      ],
    });
    const queue = new JobQueue();
    conn = new Connection({
      actual,
      queue,
      control: new FakeControl(),
      emit: () => undefined,
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: actual.server === 'up', diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
    });
    service = new PayeesService(actual, queue, conn, new MetadataRepository(actual));
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  describe('rename (14 §3)', () => {
    it('renames to a new name and adds the rename rule for the old one', async () => {
      await expect(service.rename('p-krog', 'Krogers')).resolves.toEqual({ id: 'p-krog' });
      expect(budget().payees.find((p) => p.id === 'p-krog')?.name).toBe('Krogers');
      expect(ruleFor('p-krog')?.conditions).toEqual([
        { field: 'imported_payee', op: 'is', value: 'Krogers #123', type: 'string' },
      ]);
      // The same condition is taken off the other payee's rule, which had nothing else, so it goes.
      expect(budget().rules.some((r) => r.id === 'r-shell')).toBe(false);
    });
    it('changes only the capitalization without a rule', async () => {
      await service.rename('p-kroger', 'KROGER');
      expect(budget().payees.find((p) => p.id === 'p-kroger')?.name).toBe('KROGER');
      expect(ruleFor('p-kroger')).toBeUndefined();
    });
    it('does nothing for the same name', async () => {
      await service.rename('p-kroger', 'Kroger');
      expect(budget().rules).toHaveLength(1);
    });
    it('merges into an existing payee (any case), and its transactions follow', async () => {
      await expect(service.rename('p-krog', 'kroger')).resolves.toEqual({ id: 'p-kroger' });
      expect(budget().payees.some((p) => p.id === 'p-krog')).toBe(false);
      expect([payeeOf('t1'), payeeOf('t2')]).toEqual(['p-kroger', 'p-kroger']);
      expect(ruleFor('p-kroger')?.conditions.map((c) => c.value)).toEqual(['Krogers #123']);
    });
    it('renames to a transfer: re-points the eligible transactions, keeping the rest', async () => {
      await service.rename('p-mover', 'Transfer : Savings', { transferAccountId: 'a-save' });
      expect(payeeOf('t4')).toBe('tp-a-save');
      // In the target account itself it would be a transfer to itself: left alone, so the payee stays.
      expect(payeeOf('t5')).toBe('p-mover');
      expect(budget().payees.some((p) => p.id === 'p-mover')).toBe(true);
    });
    it('"Rename and categorize" sets the uncategorized ones and the auto-category rule (11 §8)', async () => {
      await service.rename('p-krog', 'Kroger', { categoryId: 'c-food' });
      expect(budget().transactions.find((t) => t.id === 't1')?.category).toBe('c-food');
      const auto = budget().rules.find(
        (r) => r.stage === null && r.conditions[0]?.value === 'p-kroger',
      );
      expect(auto?.actions[0]?.value).toBe('c-food');
    });
    it('"Rename and categorize" leaves off-budget transactions without a category (04 §3)', async () => {
      budget().accounts.push(account({ id: 'a-loan', name: 'Loan', offbudget: true }));
      budget().transactions.push(rawTransaction({ id: 't7', account: 'a-loan', payee: 'p-krog' }));
      await expect(service.renameImpact('p-krog')).resolves.toMatchObject({
        total: 3,
        uncategorized: 1,
      });
      await service.rename('p-krog', 'Kroger', { categoryId: 'c-food' });
      expect(budget().transactions.find((t) => t.id === 't1')?.category).toBe('c-food');
      expect(budget().transactions.find((t) => t.id === 't7')?.category).toBeNull();
    });
    it('refuses to rename a transfer payee or to a blank name', async () => {
      await expect(service.rename('tp-a-save', 'X')).rejects.toMatchObject({
        details: { code: 'transfer-payee' },
      });
      await expect(service.rename('p-kroger', '  ')).rejects.toMatchObject({
        details: { code: 'blank' },
      });
    });
    it('counts the impact, excluding the transaction being edited', async () => {
      await expect(service.renameImpact('p-krog', undefined, 't2')).resolves.toEqual({
        total: 1,
        renameable: 1,
        uncategorized: 1,
      });
      await expect(service.renameImpact('p-mover', 'a-save')).resolves.toMatchObject({
        total: 2,
        renameable: 1,
      });
    });
  });

  it('combines payees into one, moving every transaction (14 §5 criterion 2)', async () => {
    await expect(
      service.combine(['p-krog', 'p-kroger', 'p-mover', 'tp-a-save'], 'Kroger'),
    ).resolves.toEqual({
      id: 'p-kroger',
    });
    expect(
      budget()
        .payees.map((p) => p.id)
        .sort(),
    ).toEqual(['p-kroger', 'p-shell', 'tp-a-check', 'tp-a-save']);
    expect(['t1', 't2', 't3', 't4', 't5'].map(payeeOf)).toEqual(Array(5).fill('p-kroger'));
    expect(
      ruleFor('p-kroger')
        ?.conditions.map((c) => c.value)
        .sort(),
    ).toEqual(['Krogers #123', 'Mover']);
  });

  it('enables and disables payees in ad:payees, skipping transfer payees (X12)', async () => {
    await service.setEnabled(['p-krog', 'tp-a-save'], false);
    expect(JSON.parse(budget().notes.get('ad:payees') ?? '{}')).toEqual({
      v: 1,
      disabled: ['p-krog'],
    });
    await service.setEnabled(['p-krog'], true);
    expect(JSON.parse(budget().notes.get('ad:payees') ?? '{}')).toEqual({ v: 1, disabled: [] });
  });

  describe('rules (14 §1, §4)', () => {
    it('writes Starts with as an anchored, escaped matches condition (14 §5 criterion 1)', async () => {
      await service.setRenameRules('p-shell', [
        { op: 'startsWith', value: 'KRG' },
        { op: 'contains', value: 'a.b' },
      ]);
      const rule = ruleFor('p-shell');
      expect(rule).toMatchObject({ stage: 'pre', conditionsOp: 'or' });
      expect(rule?.conditions).toEqual([
        { field: 'imported_payee', op: 'matches', value: '^KRG', type: 'string' },
        { field: 'imported_payee', op: 'contains', value: 'a.b', type: 'string' },
      ]);
      await expect(service.rules('p-shell')).resolves.toEqual({
        renameRules: [
          { op: 'startsWith', value: 'KRG' },
          { op: 'contains', value: 'a.b' },
        ],
        autoCategoryId: null,
        otherRuleIds: [],
      });
      await service.setRenameRules('p-shell', []);
      expect(ruleFor('p-shell')).toBeUndefined();
    });
    it('sets, changes and removes the auto-category rule', async () => {
      await service.setAutoCategory('p-kroger', 'c-food');
      await service.setAutoCategory('p-kroger', 'c-fun');
      const auto = budget().rules.filter((r) => r.stage === null);
      expect(auto).toHaveLength(1);
      expect(auto[0]?.actions[0]).toMatchObject({ field: 'category', value: 'c-fun' });
      await service.setAutoCategory('p-kroger', null);
      expect(budget().rules.some((r) => r.stage === null)).toBe(false);
    });
    it('lists the rules it can’t edit as other rules', async () => {
      budget().rules.push({
        id: 'r-odd',
        stage: 'post',
        conditionsOp: 'and',
        conditions: [{ field: 'payee', op: 'is', value: 'p-kroger' }],
        actions: [{ op: 'set', field: 'notes', value: 'x' }],
      });
      await expect(service.rules('p-kroger')).resolves.toMatchObject({ otherRuleIds: ['r-odd'] });
    });
    it('applies rename rules to existing transactions, after a dry run', async () => {
      await service.setRenameRules('p-kroger', [
        { op: 'startsWith', value: 'krg' },
        { op: 'contains', value: 'krogers' },
      ]);
      await expect(service.applyRenameRules('p-kroger', true)).resolves.toEqual({
        count: 3,
        payeeNames: ['Krogers #123', 'Shell'],
      });
      expect(payeeOf('t6')).toBe('p-shell');
      await service.applyRenameRules('p-kroger', false);
      expect(['t1', 't2', 't6'].map(payeeOf)).toEqual(['p-kroger', 'p-kroger', 'p-kroger']);
    });
  });

  it('matches rename conditions case-insensitively (S-14)', () => {
    expect(conditionMatches({ op: 'contains', value: 'amzn' }, 'AMZN Mktp US*123')).toBe(true);
    expect(conditionMatches({ op: 'is', value: 'Shell' }, '  shell ')).toBe(true);
    expect(conditionMatches({ op: 'startsWith', value: 'KRG' }, 'krg 1234')).toBe(true);
    expect(conditionMatches({ op: 'endsWith', value: '42' }, 'station 42')).toBe(true);
    expect(conditionMatches({ op: 'endsWith', value: '42' }, '42 station')).toBe(false);
  });
});
