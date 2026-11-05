// The register's transaction actions (10 §5–6, §8): what each sends to the host, the dialogs around it,
// and the Undo notifier.
import type { Transaction, TransferSide } from '@shared/domain/types';
import { RpcError } from '@shared/rpc/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConnection } from '../stores/connection';
import { useDialogs } from '../stores/dialogs';
import {
  account,
  answerDialog,
  line,
  mockHost,
  ONLINE,
  transaction,
  type Responses,
} from '../testing/fixtures';
import {
  approve,
  categorizeAs,
  changeDate,
  deleteTransactions,
  dismissUndo,
  merge,
  moveToAccount,
  setCategory,
  setCleared,
  toggleCleared,
  undo,
  undoText,
} from './actions';
import { useRegisterSession } from './view-state';

const tx = (id: string, over: Partial<Transaction> = {}): Transaction =>
  transaction({ id, accountId: 'chk', ...over });

const dates = {
  today: '2026-10-20' as const,
  dateFormat: 'MM/dd/yyyy',
  accounts: [account({ id: 'chk', name: 'Checking', lastReconciledDate: '2026-09-30' })],
};

describe('register actions (10 §6, §8)', () => {
  let host: ReturnType<typeof mockHost>;
  const respond = (responses: Responses): void => {
    host = mockHost({
      'transactions.delete': () => ({ token: 'undo-1', count: 2 }),
      'transactions.moveToAccount': () => ({ token: 'undo-2', count: 1 }),
      'transactions.setDate': () => ({ token: 'undo-3', count: 2 }),
      'transactions.undo': () => ({ ids: { t1: 't1b' } }),
      'transactions.merge': () => ({ id: 't1' }),
      ...responses,
    });
  };

  beforeEach(() => {
    useConnection().info = ONLINE;
    respond({});
  });

  it('marks cleared or uncleared, never changing a reconciled row', async () => {
    expect(await setCleared([tx('t1', { cleared: 'R' })], 'C')).toBe(true);
    expect(host.calls('transactions.setCleared')).toEqual([]);
    expect(await setCleared([tx('t1'), tx('t2', { cleared: 'R' })], 'C')).toBe(true);
    expect(host.calls('transactions.setCleared')).toEqual([{ ids: ['t1'], state: 'C' }]);
  });

  it('toggles: all cleared become uncleared, otherwise cleared', async () => {
    await toggleCleared([tx('t1', { cleared: 'C' }), tx('t2', { cleared: 'R' })]);
    await toggleCleared([tx('t1', { cleared: 'C' }), tx('t2')]);
    expect(await toggleCleared([tx('t3', { cleared: 'R' })])).toBe(true);
    expect(host.calls('transactions.setCleared')).toEqual([
      { ids: ['t1'], state: 'U' },
      { ids: ['t1', 't2'], state: 'C' },
    ]);
  });

  it('approves only rows that need review', async () => {
    expect(await approve([tx('t1')])).toBe(true);
    await approve([tx('t1', { needsReview: true }), tx('t2')]);
    expect(host.calls('transactions.approve')).toEqual([{ ids: ['t1'] }]);
  });

  it('reports a failed write as false', async () => {
    respond({
      'transactions.setCleared': () => {
        throw new RpcError('offline', 'down');
      },
    });
    const clearing = setCleared([tx('t1')], 'C');
    expect((await answerDialog('close')).instruction).toBe("You're offline");
    expect(await clearing).toBe(false);
  });

  it('categorizes, skipping splits after a warning', async () => {
    const split = tx('t2', { subtransactions: [line({ id: 'l1', parentId: 't2' })] });
    const cancelled = categorizeAs([tx('t1'), split], 'c1');
    const warning = await answerDialog('cancel');
    expect(await cancelled).toBe(false);
    expect(warning.instruction).toBe(
      'The selected split transaction(s) will not be recategorized.',
    );
    expect(host.calls('transactions.categorize')).toEqual([]);

    const continued = categorizeAs([tx('t1'), split], 'c1');
    await answerDialog('continue');
    expect(await continued).toBe(true);
    expect(host.calls('transactions.categorize')).toEqual([{ ids: ['t1'], categoryId: 'c1' }]);

    const onlySplits = categorizeAs([split], 'c1');
    await answerDialog('continue');
    expect(await onlySplits).toBe(true);
    expect(host.calls('transactions.categorize')).toHaveLength(1);
  });

  it('sets the category of rows or split lines directly', async () => {
    expect(await setCategory([], 'c1')).toBe(true);
    await setCategory(['l1', 'l2'], null);
    expect(host.calls('transactions.categorize')).toEqual([
      { ids: ['l1', 'l2'], categoryId: null },
    ]);
  });

  describe('delete (10 §8)', () => {
    it('deletes without asking when there is nothing to warn about, and offers Undo', async () => {
      expect(await deleteTransactions([])).toBe(0);
      expect(await deleteTransactions([tx('t1'), tx('t2')])).toBe(2);
      expect(host.calls('transactions.delete')).toEqual([{ ids: ['t1', 't2'] }]);
      expect(useRegisterSession().state.undo).toEqual({
        token: 'undo-1',
        kind: 'deleted',
        count: 2,
      });
    });

    it('asks first about a reconciled row, and deletes nothing on Cancel', async () => {
      const cancelled = deleteTransactions([tx('t1', { cleared: 'R' })]);
      await answerDialog('cancel');
      expect(await cancelled).toBe(0);
      expect(host.calls('transactions.delete')).toEqual([]);
    });

    it('refuses rows that are all split-line transfers', async () => {
      const side: TransferSide = {
        id: 's1',
        accountId: 'sav',
        date: '2026-10-01',
        cleared: 'U',
        isSplitLine: true,
      };
      const refused = deleteTransactions([tx('t1', { transferSide: side })]);
      expect((await answerDialog('close')).instruction).toBe('Could not delete transaction(s)');
      expect(await refused).toBe(0);
    });

    it('offers no Undo without a token, and nothing for a failed delete', async () => {
      respond({ 'transactions.delete': () => ({ token: null, count: 1 }) });
      expect(await deleteTransactions([tx('t1')])).toBe(1);
      expect(useRegisterSession().state.undo).toBeNull();
      respond({
        'transactions.delete': () => {
          throw new RpcError('actual', 'boom');
        },
      });
      const failing = deleteTransactions([tx('t1')]);
      await answerDialog('close');
      expect(await failing).toBe(0);
    });
  });

  describe('move to account (10 §6.1)', () => {
    const savings = account({ id: 'sav', name: 'Savings' });

    it('moves and offers Undo', async () => {
      expect(await moveToAccount([], savings)).toBe(0);
      expect(await moveToAccount([tx('t1')], savings)).toBe(1);
      expect(host.calls('transactions.moveToAccount')).toEqual([{ ids: ['t1'], accountId: 'sav' }]);
      expect(useRegisterSession().state.undo).toMatchObject({ kind: 'moved', account: 'Savings' });
    });

    it('refuses a transfer into the target, several reconciled rows, and asks about one', async () => {
      const blocked = async (rows: Parameters<typeof moveToAccount>[0]): Promise<string> => {
        const moving = moveToAccount(rows, savings);
        const options = await answerDialog('close');
        expect(await moving).toBe(0);
        return options.content ?? '';
      };
      expect(
        await blocked([
          tx('t1', {
            subtransactions: [line({ id: 'l1', parentId: 't1', transferAccountId: 'sav' })],
          }),
        ]),
      ).toMatch(/Savings/);
      expect(await blocked([tx('t1', { cleared: 'R' }), tx('t2', { cleared: 'R' })])).toMatch(
        /^Some of these transactions have been reconciled/,
      );

      const declined = moveToAccount([tx('t1', { cleared: 'R' })], savings);
      await answerDialog('no');
      expect(await declined).toBe(0);
      const confirmed = moveToAccount([tx('t1', { cleared: 'R' })], savings);
      await answerDialog('yes');
      expect(await confirmed).toBe(1);
      expect(host.calls('transactions.moveToAccount')).toHaveLength(1);
    });

    it('moves nothing when the write fails', async () => {
      respond({
        'transactions.moveToAccount': () => {
          throw new RpcError('actual', 'boom');
        },
      });
      const moving = moveToAccount([tx('t1')], savings);
      await answerDialog('close');
      expect(await moving).toBe(0);
      expect(useRegisterSession().state.undo).toBeNull();
    });
  });

  describe('Change Date… (10 §6.1)', () => {
    it('needs two or more rows, and refuses several reconciled ones', async () => {
      expect(await changeDate([tx('t1')], dates)).toEqual([]);
      const blocked = changeDate([tx('t1', { cleared: 'R' }), tx('t2', { cleared: 'R' })], dates);
      expect((await answerDialog('close')).instruction).toBe(
        'Not all of these transactions can be changed',
      );
      expect(await blocked).toEqual([]);
    });

    it('sets the date and offers Undo; Cancel changes nothing', async () => {
      const changing = changeDate([tx('t1'), tx('t2')], dates);
      await answerDialog('change', false, '2026-10-25');
      expect(await changing).toEqual(['t1', 't2']);
      expect(host.calls('transactions.setDate')).toEqual([
        { ids: ['t1', 't2'], date: '2026-10-25' },
      ]);
      expect(useRegisterSession().state.undo).toEqual({ token: 'undo-3', kind: 'dated', count: 2 });

      const cancelled = changeDate([tx('t1'), tx('t2')], dates);
      await answerDialog('cancel', false, '2026-10-25');
      expect(await cancelled).toEqual([]);
      expect(host.calls('transactions.setDate')).toHaveLength(1);
    });

    it('asks about a reconciled row, and clears it when the date is after the last reconciliation', async () => {
      const declined = changeDate([tx('t1', { cleared: 'R' }), tx('t2')], dates);
      await answerDialog('change', false, '2026-10-25');
      await answerDialog('no');
      expect(await declined).toEqual([]);

      const changing = changeDate([tx('t1', { cleared: 'R' }), tx('t2')], dates);
      await answerDialog('change', false, '2026-10-25');
      await answerDialog('yes');
      expect(await changing).toEqual(['t1', 't2']);
      expect(host.calls('transactions.setDate')).toEqual([
        { ids: ['t1', 't2'], date: '2026-10-25', clearReconciled: ['t1'] },
      ]);
    });

    it("asks about a reconciled other side, and clears it after its account's reconciliation", async () => {
      const side: TransferSide = {
        id: 's1',
        accountId: 'chk',
        date: '2026-10-01',
        cleared: 'R',
        isSplitLine: false,
      };
      const declined = changeDate([tx('t1', { transferSide: side }), tx('t2')], dates);
      await answerDialog('change', false, '2026-10-25');
      await answerDialog('no');
      expect(await declined).toEqual([]);

      const changing = changeDate([tx('t1', { transferSide: side }), tx('t2')], dates);
      await answerDialog('change', false, '2026-09-15');
      await answerDialog('yes');
      expect(await changing).toEqual(['t1', 't2']);
      // Before the last reconciliation: the other side stays reconciled.
      expect(host.calls('transactions.setDate')).toEqual([
        { ids: ['t1', 't2'], date: '2026-09-15' },
      ]);
    });

    it('explains a partial change once, without the generic error', async () => {
      respond({
        'transactions.setDate': () => {
          throw new RpcError('actual', 'partial', { code: 'partial-change' });
        },
      });
      const changing = changeDate([tx('t1'), tx('t2')], dates);
      await answerDialog('change', false, '2026-10-25');
      const partial = await answerDialog('close');
      expect(await changing).toEqual([]);
      expect(partial.content).toMatch(
        /^Some of the 2 transactions may have been given the new date/,
      );
      expect(useDialogs().stack).toEqual([]);
    });
  });

  it('Undo re-creates what was changed once, and is dismissed by other actions', async () => {
    expect(await undo()).toBeNull();
    await deleteTransactions([tx('t1')]);
    expect(await undo()).toEqual({ t1: 't1b' });
    expect(host.calls('transactions.undo')).toEqual([{ token: 'undo-1' }]);
    expect(await undo()).toBeNull();

    await deleteTransactions([tx('t1')]);
    dismissUndo();
    expect(useRegisterSession().state.undo).toBeNull();
  });

  it('Undo refused offline keeps the notifier, so it can be retried', async () => {
    await deleteTransactions([tx('t1')]);
    const notice = useRegisterSession().state.undo;
    host.spy.mockImplementationOnce(() => Promise.reject(new RpcError('offline', 'offline')));
    const undoing = undo();
    await answerDialog('close');
    expect(await undoing).toBeNull();
    expect(useRegisterSession().state.undo).toEqual(notice);
    expect(await undo()).toEqual({ t1: 't1b' });
  });

  it("words the Undo notifier's text", () => {
    expect(undoText({ token: 'x', kind: 'deleted', count: 1 })).toBe('Deleted 1 transaction');
    expect(undoText({ token: 'x', kind: 'moved', count: 3, account: 'Savings' })).toBe(
      "Moved 3 transactions to 'Savings'",
    );
  });

  it('merges two transactions after confirming', async () => {
    const cancelled = merge(tx('t1'), tx('t2'));
    expect((await answerDialog('cancel')).instruction).toBe('Merge these two transactions?');
    expect(await cancelled).toBeNull();
    const merging = merge(tx('t1'), tx('t2'));
    await answerDialog('merge');
    expect(await merging).toBe('t1');
    expect(host.calls('transactions.merge')).toEqual([{ a: 't1', b: 't2' }]);
  });
});
