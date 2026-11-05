// The commit pipeline's dialogs (11 §6–8, §10 criteria 3–4) with a mocked host: the offline pre-check and
// the host's offline refusal, the three reconciled warnings, the unassigned split amount, the payee rename
// prompt, approval, and the income-as-outflow check.
import type { Transaction } from '@shared/domain/types';
import { DEFAULT_MONEY_SETTINGS } from '@shared/money';
import { RpcError } from '@shared/rpc/protocol';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDialogs } from '../stores/dialogs';
import {
  account,
  answerDialog,
  GROUPS,
  line,
  mockHost,
  payee,
  transaction,
} from '../testing/fixtures';
import { runCommit, type CommitContext } from './commit';
import { fromTransaction, type EditableTransaction } from './editable';

const CHECKING = account({ id: 'chk', name: 'Checking', lastReconciledDate: '2026-09-30' });
const SAVINGS = account({ id: 'sav', name: 'Savings', lastReconciledDate: '2026-09-30' });
const ACCOUNTS = [CHECKING, SAVINGS];
const PAYEES = [
  payee({ id: 'p-krog', name: 'Krogers #123' }),
  payee({ id: 'p-kroger', name: 'Kroger' }),
];
const accountMap = new Map(ACCOUNTS.map((a) => [a.id, a]));
const texts = {
  transfer: (name: string) => `Transfer : ${name}`,
  categoryText: (id: string | null) =>
    id === 'c-groceries'
      ? 'Everyday Expenses: Groceries'
      : id === 'c-salary'
        ? 'Income: Salary'
        : '',
};

function context(t: Transaction | null, overrides: Partial<CommitContext> = {}): CommitContext {
  return {
    accounts: ACCOUNTS,
    payees: PAYEES,
    groups: GROUPS,
    canEdit: true,
    money: DEFAULT_MONEY_SETTINGS,
    original: t ? { t, edit: fromTransaction(t, texts, accountMap) } : null,
    categoryText: texts.categoryText,
    ...overrides,
  };
}

const edited = (t: Transaction, change: (e: EditableTransaction) => void): EditableTransaction => {
  const e = fromTransaction(t, texts, accountMap);
  change(e);
  return e;
};

let host: ReturnType<typeof mockHost>;
beforeEach(() => {
  host = mockHost({
    'transactions.commit': (p: { id?: string }) => ({ id: p.id ?? 'new-1' }),
    'payees.renameImpact': () => ({ total: 0, renameable: 0, uncategorized: 0 }),
  });
});

const RECONCILED = transaction({
  id: 't1',
  accountId: 'chk',
  date: '2026-09-15',
  amount: -5000,
  payeeId: 'p-kroger',
  payeeName: 'Kroger',
  categoryId: 'c-groceries',
  cleared: 'R',
});

describe('step 1: can edit? (11 §6, §10 criterion 4)', () => {
  it('shows the offline dialog and keeps the editor open', async () => {
    const draft = edited(RECONCILED, (e) => (e.notes = 'typed'));
    const done = runCommit(draft, context(RECONCILED, { canEdit: false }));
    expect((await answerDialog('close')).instruction).toBe('You’re offline'.replace('’', "'"));
    await expect(done).resolves.toEqual({ status: 'keep' });
    expect(draft.notes).toBe('typed');
    expect(host.calls('transactions.commit')).toHaveLength(0);
  });
  it('shows the same dialog when the host’s gate refuses the write', async () => {
    host.spy.mockImplementation(() => Promise.reject(new RpcError('offline', 'offline')));
    const done = runCommit(
      edited(transaction({ id: 'n', accountId: 'chk' }), (e) => (e.notes = 'x')),
      context(null),
    );
    expect((await answerDialog('close')).instruction).toBe("You're offline");
    await expect(done).resolves.toEqual({ status: 'keep' });
  });
});

describe('step 2: reconciled warnings (11 §6)', () => {
  it('a reconciled transaction whose amount changes: Yes makes it Cleared when dated after the reconciliation', async () => {
    const t = { ...RECONCILED, date: '2026-10-05' as const };
    const draft = edited(t, (e) => (e.amount = -6000));
    const done = runCommit(draft, context(t));
    const asked = await answerDialog('yes');
    expect(asked).toMatchObject({
      instruction: 'Reconciled Transaction',
      footer: 'Changing a Reconciled Transaction',
    });
    expect(asked.content).toContain('Modifying its account or amount');
    await expect(done).resolves.toMatchObject({ status: 'saved' });
    expect(host.calls('transactions.commit')[0]).toMatchObject({ cleared: 'C', amount: -6000 });
  });
  it('a reconciled transaction whose date changes: the date wording; it stays reconciled before the reconciliation', async () => {
    const draft = edited(RECONCILED, (e) => (e.date = '2026-09-20'));
    const done = runCommit(draft, context(RECONCILED));
    expect((await answerDialog('yes')).content).toContain('Modifying its date may bring');
    await done;
    expect(host.calls('transactions.commit')[0]).toMatchObject({ cleared: 'R' });
  });
  it('keeps the draft reconciled when a later step keeps the editor open', async () => {
    const t = { ...RECONCILED, date: '2026-10-05' as const };
    host.spy.mockImplementationOnce(() => Promise.reject(new RpcError('offline', 'offline')));
    const draft = edited(t, (e) => (e.amount = -6000));
    const done = runCommit(draft, context(t));
    await answerDialog('yes');
    await answerDialog('close');
    await expect(done).resolves.toEqual({ status: 'keep' });
    expect(draft.cleared).toBe('R');
  });
  it('No cancels the whole edit', async () => {
    const done = runCommit(
      edited(RECONCILED, (e) => (e.amount = 1)),
      context(RECONCILED),
    );
    await answerDialog('no');
    await expect(done).resolves.toEqual({ status: 'cancel' });
    expect(host.calls('transactions.commit')).toHaveLength(0);
  });
  const TRANSFER = transaction({
    id: 't2',
    accountId: 'chk',
    date: '2026-10-05',
    amount: -2000,
    payeeName: 'Savings',
    transferAccountId: 'sav',
    transferId: 'm2',
    transferSide: {
      id: 'm2',
      accountId: 'sav',
      date: '2026-10-05',
      cleared: 'R',
      isSplitLine: false,
    },
  });
  it('the other side is reconciled and the amount changes: that side becomes Cleared', async () => {
    const done = runCommit(
      edited(TRANSFER, (e) => (e.amount = -2500)),
      context(TRANSFER),
    );
    const asked = await answerDialog('yes');
    expect(asked.content).toContain('Modifying the amount will bring');
    expect(asked.footer).toBe('Changing a Transfer to a Reconciled Transaction');
    await done;
    expect(host.calls('transactions.commit')[0]).toMatchObject({ clearOtherSide: true });
  });
  it('the other side is reconciled and only the date changes: the date wording', async () => {
    const done = runCommit(
      edited(TRANSFER, (e) => (e.date = '2026-10-06')),
      context(TRANSFER),
    );
    expect((await answerDialog('yes')).content).toContain('Modifying the date may bring');
    await done;
  });
  it('the other side is reconciled and the payee changes', async () => {
    const done = runCommit(
      edited(TRANSFER, (e) => {
        e.transferAccountId = null;
        e.payeeText = 'Kroger';
      }),
      context(TRANSFER),
    );
    expect((await answerDialog('yes')).content).toContain('Changing the payee will bring');
    await done;
    expect(host.calls('transactions.commit')[0]).toMatchObject({ clearOtherSide: true });
  });
});

describe('step 3: splits (11 §7.3)', () => {
  const SPLIT = transaction({
    id: 's1',
    accountId: 'chk',
    amount: -15000,
    payeeId: 'p-kroger',
    payeeName: 'Kroger',
    subtransactions: [
      line({ id: 'l1', parentId: 's1', amount: -10000, categoryId: 'c-groceries' }),
      line({ id: 'l2', parentId: 's1', amount: -2000, categoryId: 'c-groceries' }),
    ],
  });
  it('asks about the unassigned amount; Manually adjust keeps editing', async () => {
    const done = runCommit(
      edited(SPLIT, () => undefined),
      context(SPLIT),
    );
    const asked = await answerDialog('manual');
    expect(asked.instruction).toBe('How would you like to handle the unassigned **-30.00**?');
    expect(asked.content).toBe(
      'The total transaction amount is **-150.00**, but the sum of the splits is **-120.00**.  This leaves **-30.00** unaccounted for.',
    );
    expect(asked.commandLinks?.map((l) => l.title)).toEqual([
      'Manually adjust splits',
      'Auto-distribute amongst splits',
      'Adjust original transaction',
    ]);
    await expect(done).resolves.toEqual({ status: 'keep' });
  });
  it('Cancel keeps editing too', async () => {
    const done = runCommit(
      edited(SPLIT, () => undefined),
      context(SPLIT),
    );
    await answerDialog('cancel');
    await expect(done).resolves.toEqual({ status: 'keep' });
  });
  it('Auto-distribute spreads the remainder over the lines', async () => {
    const done = runCommit(
      edited(SPLIT, () => undefined),
      context(SPLIT),
    );
    await answerDialog('distribute');
    await done;
    expect(host.calls('transactions.commit')[0]).toMatchObject({
      lines: [
        { id: 'l1', amount: -12500 },
        { id: 'l2', amount: -2500 },
      ],
    });
  });
  it('Adjust original transaction sets the total to the lines’ sum', async () => {
    const done = runCommit(
      edited(SPLIT, () => undefined),
      context(SPLIT),
    );
    await answerDialog('adjust');
    await done;
    expect(host.calls('transactions.commit')[0]).toMatchObject({ amount: -12000 });
  });
  it('a reconciled split whose total Adjust changes asks the reconciled question', async () => {
    const reconciled = { ...SPLIT, cleared: 'R' as const };
    const done = runCommit(
      edited(reconciled, () => undefined),
      context(reconciled),
    );
    await answerDialog('adjust');
    expect((await answerDialog('no')).content).toContain('Modifying its account or amount');
    await expect(done).resolves.toEqual({ status: 'cancel' });
    expect(host.calls('transactions.commit')).toHaveLength(0);
  });
  it('collapses a single line into a normal transaction without asking', async () => {
    const one = edited(SPLIT, (e) => {
      e.lines = [{ ...(e.lines[0] ?? ({} as never)), amount: -15000 }];
    });
    await expect(runCommit(one, context(SPLIT))).resolves.toMatchObject({ status: 'saved' });
    expect(host.calls('transactions.commit')[0]).toMatchObject({
      categoryId: 'c-groceries',
      amount: -15000,
    });
    expect(host.calls('transactions.commit')[0]).not.toHaveProperty('lines');
  });
});

describe('step 4: the payee rename prompt (11 §8)', () => {
  const T = transaction({
    id: 't5',
    accountId: 'chk',
    payeeId: 'p-krog',
    payeeName: 'Krogers #123',
    amount: -100,
  });
  const impact = (total: number, uncategorized = 0): void => {
    host.spy.mockImplementation((method, params) =>
      Promise.resolve(
        (method === 'payees.renameImpact'
          ? { total, renameable: total, uncategorized }
          : method === 'transactions.commit'
            ? { id: (params as { id?: string }).id ?? 'x' }
            : null) as never,
      ),
    );
  };
  it('offers Rename them / Leave them alone, and renames after the write', async () => {
    impact(3);
    const done = runCommit(
      edited(T, (e) => (e.payeeText = 'Kroger')),
      context(T),
    );
    const asked = await answerDialog('rename');
    expect(asked.instruction).toBe('Apply changes to matching transactions?');
    expect(asked.content).toBe(
      '3 other transactions were found with this payee:<br/>&nbsp;&nbsp;"**Krogers #123**"<br/>How would you like to handle them?',
    );
    expect(asked.commandLinks?.map((l) => [l.title, l.subLabel])).toEqual([
      ['Rename them', 'Rename 3 matching transactions to: "Kroger"'],
      ['Leave them alone', "I just want to change this transaction. Don't change the others."],
    ]);
    expect(asked.checkbox?.text).toBe("Don't try to bulk-rename this payee again");
    await done;
    expect(host.calls('payees.renameImpact')[0]).toEqual({ id: 'p-krog', excludeId: 't5' });
    expect(host.calls('payees.rename')[0]).toEqual({ id: 'p-krog', name: 'Kroger' });
  });
  it('offers Rename and categorize when this one has a category and others don’t', async () => {
    impact(2, 1);
    const done = runCommit(
      edited(T, (e) => {
        e.payeeText = 'Kroger';
        e.categoryId = 'c-groceries';
      }),
      context(T),
    );
    const asked = await answerDialog('categorize');
    expect(asked.commandLinks?.map((l) => l.title)).toEqual([
      'Rename and categorize',
      'Just rename them',
      'Leave them alone',
    ]);
    expect(asked.commandLinks?.[0]?.subLabel).toBe(
      'Rename 2 matching transactions to: "Kroger". Categorize 1 uncategorized transactions as "Everyday Expenses: Groceries".',
    );
    await done;
    expect(host.calls('payees.rename')[0]).toEqual({
      id: 'p-krog',
      name: 'Kroger',
      categoryId: 'c-groceries',
    });
  });
  it('Leave them alone with the checkbox only disables the payee', async () => {
    impact(1);
    const done = runCommit(
      edited(T, (e) => (e.payeeText = 'Kroger')),
      context(T),
    );
    const dialogs = useDialogs();
    await flushPromises();
    const top = dialogs.stack.at(-1);
    if (top) dialogs.close(top.id, { button: 'leave', checkboxChecked: true });
    await done;
    expect(host.calls('payees.rename')).toHaveLength(0);
    expect(host.calls('payees.setEnabled')[0]).toEqual({ ids: ['p-krog'], enabled: false });
  });
  it('Cancel aborts the commit and keeps editing', async () => {
    impact(1);
    const done = runCommit(
      edited(T, (e) => (e.payeeText = 'Kroger')),
      context(T),
    );
    await answerDialog('cancel');
    await expect(done).resolves.toEqual({ status: 'keep' });
    expect(host.calls('transactions.commit')).toHaveLength(0);
  });
  it('renames the payee entity without asking when no other transaction uses it', async () => {
    impact(0);
    await runCommit(
      edited(T, (e) => (e.payeeText = 'Kroger')),
      context(T),
    );
    expect(useDialogs().stack).toHaveLength(0);
    expect(host.calls('payees.rename')[0]).toEqual({ id: 'p-krog', name: 'Kroger' });
  });
  it('doesn’t ask for a disabled payee', async () => {
    impact(5);
    await runCommit(
      edited(T, (e) => (e.payeeText = 'Kroger')),
      context(T, {
        payees: [
          payee({ id: 'p-krog', name: 'Krogers #123', enabled: false }),
          payee({ id: 'p-kroger', name: 'Kroger' }),
        ],
      }),
    );
    expect(host.calls('payees.renameImpact')).toHaveLength(0);
  });
  it('compares the imported payee when an approval keeps the payee (11 §8)', async () => {
    impact(2);
    const imported = transaction({
      id: 't6',
      accountId: 'chk',
      payeeId: 'p-kroger',
      payeeName: 'Kroger',
      importedPayee: 'Krogers #123',
      needsReview: true,
    });
    const done = runCommit(
      edited(imported, () => undefined),
      context(imported),
      { approve: true },
    );
    await answerDialog('rename');
    await done;
    expect(host.calls('payees.rename')[0]).toEqual({ id: 'p-krog', name: 'Kroger' });
  });
});

describe('step 5: approval (11 §6)', () => {
  const REVIEW = transaction({
    id: 't7',
    accountId: 'chk',
    needsReview: true,
    amount: -100,
    payeeName: '',
  });
  it('approves a needs-review transaction when a field changes', async () => {
    await runCommit(
      edited(REVIEW, (e) => (e.notes = 'checked')),
      context(REVIEW),
    );
    expect(host.calls('transactions.commit')[0]).toMatchObject({ needsReview: false });
  });
  it('keeps the review tag when only the check number changes', async () => {
    await runCommit(
      edited(REVIEW, (e) => (e.checkNumber = '55')),
      context(REVIEW),
    );
    expect(host.calls('transactions.commit')[0]).toMatchObject({
      needsReview: true,
      checkNumber: '55',
    });
  });
  it('sends the notes with their tags as typed (11 §5)', async () => {
    await runCommit(
      edited(REVIEW, (e) => (e.notes = 'trip #Vacation2025 #trip')),
      context(REVIEW),
    );
    expect(host.calls('transactions.commit')[0]).toMatchObject({
      notes: 'trip #Vacation2025 #trip',
    });
  });
  it('the Approve buttons approve explicitly', async () => {
    await runCommit(
      edited(REVIEW, () => undefined),
      context(REVIEW),
      { approve: true },
    );
    expect(host.calls('transactions.commit')[0]).toMatchObject({ needsReview: false });
  });
});

describe('step 8: income entered as outflow (11 §6)', () => {
  it('flags an outflow in an income category', async () => {
    const draft = edited(transaction({ id: 'n2', accountId: 'chk' }), (e) => {
      e.id = null;
      e.categoryId = 'c-salary';
      e.amount = -100;
    });
    await expect(runCommit(draft, context(null))).resolves.toEqual({
      status: 'saved',
      id: 'new-1',
      incomeOutflow: true,
    });
  });
});
