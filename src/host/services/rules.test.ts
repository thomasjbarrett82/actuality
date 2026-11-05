// Rules on the fake API (23 §4): the list in run order with schedules, create/update/delete (schedule rules
// refused or skipped), matching, applying actions with the note metadata kept (23 §5), and the gate.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawAccount, RawRule } from '../actual';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { MATCHES_MAX, RulesService } from './rules';

const account = (a: Partial<RawAccount> & { id: string; name: string }): RawAccount => ({
  offbudget: false,
  closed: false,
  sortOrder: 0,
  accountGroupId: null,
  ...a,
});

const rule = (r: Partial<RawRule> & { id: string }): RawRule => ({
  stage: null,
  conditionsOp: 'and',
  conditions: [{ field: 'payee', op: 'is', value: 'p-kroger', type: 'id' }],
  actions: [{ op: 'set', field: 'category', value: 'c-food', type: 'id' }],
  ...r,
});

describe('RulesService (23 §4)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let service: RulesService;
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    actual = new FakeActual();
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      accounts: [account({ id: 'a-check', name: 'Checking' })],
      payees: [
        { id: 'p-kroger', name: 'Kroger', transferAcct: null },
        { id: 'p-rent', name: 'Rent Co', transferAcct: null },
      ],
      rules: [
        rule({ id: 'r-post', stage: 'post' }),
        rule({
          id: 'r-contains',
          stage: 'pre',
          conditions: [{ field: 'imported_payee', op: 'contains', value: 'krog', type: 'string' }],
          actions: [{ op: 'set', field: 'payee', value: 'p-kroger', type: 'id' }],
        }),
        rule({ id: 'r-default' }),
        rule({
          id: 'r-is',
          stage: 'pre',
          conditions: [{ field: 'imported_payee', op: 'is', value: 'KROGER 1', type: 'string' }],
          actions: [{ op: 'set', field: 'payee', value: 'p-kroger', type: 'id' }],
        }),
        rule({
          id: 'r-sched',
          conditions: [{ field: 'payee', op: 'is', value: 'p-rent', type: 'id' }],
          actions: [{ op: 'link-schedule', value: 's-rent' }],
        }),
      ],
      schedules: [
        {
          id: 's-rent',
          name: 'Rent',
          account: 'a-check',
          payee: 'p-rent',
          completed: false,
          ruleId: 'r-sched',
        },
      ],
      transactions: [
        rawTransaction({
          id: 't1',
          account: 'a-check',
          date: '2026-10-02',
          payee: 'p-kroger',
          amount: -5000,
          notes: 'Weekly ⟦chk 1234⟧ #needs-review',
        }),
        rawTransaction({ id: 't2', account: 'a-check', date: '2026-10-01', payee: 'p-rent' }),
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
    service = new RulesService(actual, queue, conn);
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  it('lists the rules in run order, with the schedule a rule belongs to (23 §1.1)', async () => {
    const rules = await service.list();
    // Pre (least specific first), then default (by score, then id), then post.
    expect(rules.map((r) => r.id)).toEqual([
      'r-contains',
      'r-is',
      'r-default',
      'r-sched',
      'r-post',
    ]);
    expect(rules.find((r) => r.id === 'r-sched')?.schedule).toEqual({ id: 's-rent', name: 'Rent' });
    expect(rules.find((r) => r.id === 'r-default')).toMatchObject({ stage: null, schedule: null });
  });

  it('creates a rule and updates one with the full rule, unknown keys kept', async () => {
    const { id } = await service.save({
      stage: 'pre',
      conditionsOp: 'or',
      conditions: [{ field: 'imported_payee', op: 'contains', value: 'AMZN', type: 'string' }],
      actions: [{ op: 'set', field: 'payee', value: 'p-kroger', type: 'id' }],
    });
    expect(budget().rules.find((r) => r.id === id)).toMatchObject({
      stage: 'pre',
      conditionsOp: 'or',
    });
    await service.save({
      id: 'r-default',
      stage: 'post',
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: 'p-kroger', type: 'id', extra: 1 }],
      actions: [{ op: 'append-notes', field: 'notes', value: '!' }],
    });
    expect(budget().rules.find((r) => r.id === 'r-default')).toEqual({
      id: 'r-default',
      stage: 'post',
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: 'p-kroger', type: 'id', extra: 1 }],
      actions: [{ op: 'append-notes', field: 'notes', value: '!' }],
    });
  });

  it("refuses to edit a schedule's rule, and skips it when deleting", async () => {
    await expect(
      service.save({
        id: 'r-sched',
        stage: null,
        conditionsOp: 'and',
        conditions: [{ field: 'payee', op: 'is', value: 'p-rent' }],
        actions: [{ op: 'set', field: 'notes', value: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'validation', details: { code: 'schedule-rule' } });
    await service.delete(['r-sched', 'r-post']);
    expect(budget().rules.map((r) => r.id)).toContain('r-sched');
    expect(budget().rules.map((r) => r.id)).not.toContain('r-post');
  });

  it('lists the matching transactions, newest first; no conditions match nothing', async () => {
    await expect(service.matches({ conditionsOp: 'and', conditions: [] })).resolves.toEqual({
      rows: [],
      more: false,
    });
    const found = await service.matches({
      conditionsOp: 'or',
      conditions: [
        { field: 'payee', op: 'is', value: 'p-kroger' },
        { field: 'payee', op: 'is', value: 'p-rent' },
      ],
    });
    expect(found?.rows.map((r) => r.id)).toEqual(['t1', 't2']);
    expect(found?.rows[0]).toMatchObject({ notes: 'Weekly', amount: -5000, categoryId: null });
    expect(actual.ruleMatchCalls.at(-1)).toMatchObject({ conditionsOp: 'or' });
    expect(MATCHES_MAX).toBe(100);
  });

  it('reports a missing handler as null', async () => {
    actual.missingHandlers.add('make-filters-from-conditions');
    await expect(
      service.matches({
        conditionsOp: 'and',
        conditions: [{ field: 'payee', op: 'is', value: 'p-kroger' }],
      }),
    ).resolves.toBeNull();
  });

  it('applies actions and keeps the check number and review tag (23 §5, criterion 5)', async () => {
    await expect(
      service.applyActions(['t1'], [{ op: 'set', field: 'notes', value: 'Groceries' }]),
    ).resolves.toEqual({ count: 1 });
    expect(budget().transactions.find((t) => t.id === 't1')?.notes).toBe(
      'Groceries ⟦chk 1234⟧ #needs-review',
    );
    await service.applyActions(['t2'], [{ op: 'prepend-notes', value: 'Paid ' }]);
    expect(budget().transactions.find((t) => t.id === 't2')?.notes).toBe('Paid ');
  });

  it('rejects every write offline (03 §5)', async () => {
    actual.server = 'down';
    await conn.syncNow().catch(() => undefined);
    await expect(
      service.save({
        stage: null,
        conditionsOp: 'and',
        conditions: [{ field: 'payee', op: 'is', value: 'p-kroger' }],
        actions: [{ op: 'delete-transaction', value: null }],
      }),
    ).rejects.toMatchObject({ code: 'offline' });
    await expect(service.delete(['r-post'])).rejects.toMatchObject({ code: 'offline' });
    await expect(
      service.applyActions(['t1'], [{ op: 'set', field: 'notes', value: 'x' }]),
    ).rejects.toMatchObject({ code: 'offline' });
    expect(budget().rules).toHaveLength(5);
  });
});
