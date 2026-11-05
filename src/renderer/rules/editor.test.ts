// Opening the rule editor (23 §3): it resolves with the saved rule's id, and a schedule's rule hands over
// to the Schedule dialog (23 §3.3) with the schedule's account, or the first open one.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openScheduleDialog } from '../register/schedule-dialog';
import { queryClient } from '../rpc/query-client';
import { account, answerModal, mockHost, transaction } from '../testing/fixtures';
import { openRuleEditor, openRuleFromTransaction } from './editor';
import { emptyForm } from './form';

vi.mock('../register/schedule-dialog', () => ({
  openScheduleDialog: vi.fn(() => Promise.resolve(null)),
}));

const ACCOUNTS = [
  account({ id: 'a-closed', name: 'Old', closed: true }),
  account({ id: 'a-open', name: 'Checking' }),
];

let schedules: { id: string; accountId: string | null }[];

beforeEach(() => {
  queryClient.clear();
  vi.mocked(openScheduleDialog).mockClear();
  schedules = [{ id: 's1', accountId: 'a-sched' }];
  mockHost({
    'accounts.list': () => ACCOUNTS,
    'schedules.list': () => schedules,
  });
});

describe('openRuleEditor (23 §3)', () => {
  it("resolves with the saved rule's id, or null when cancelled", async () => {
    let result = openRuleEditor(emptyForm());
    await answerModal({ id: 'r1' });
    expect(await result).toBe('r1');
    result = openRuleEditor(emptyForm());
    await answerModal(null);
    expect(await result).toBeNull();
    expect(openScheduleDialog).not.toHaveBeenCalled();
  });

  it("hands a schedule's rule over to the Schedule dialog, on the schedule's account (23 §3.3)", async () => {
    const result = openRuleEditor(emptyForm());
    await answerModal({ scheduleId: 's1' });
    expect(await result).toBeNull();
    expect(openScheduleDialog).toHaveBeenCalledWith({
      kind: 'edit',
      schedule: schedules[0],
      fallbackAccountId: 'a-sched',
    });
  });

  it("falls back to the first open account for a schedule without one, and skips a schedule that's gone", async () => {
    schedules = [{ id: 's1', accountId: null }];
    let result = openRuleEditor(emptyForm());
    await answerModal({ scheduleId: 's1' });
    await result;
    expect(openScheduleDialog).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackAccountId: 'a-open' }),
    );
    vi.mocked(openScheduleDialog).mockClear();
    result = openRuleEditor(emptyForm());
    await answerModal({ scheduleId: 's-gone' });
    expect(await result).toBeNull();
    expect(openScheduleDialog).not.toHaveBeenCalled();
  });

  it('opens Create a new rule... from a register transaction, pre-filled (23 §2.2)', async () => {
    const result = openRuleFromTransaction(
      transaction({ id: 't1', accountId: 'a-open', payeeId: 'p1', categoryId: 'c1' }),
    );
    const props = await answerModal(null);
    await result;
    expect(JSON.stringify(props['form'])).toContain('p1');
    expect(JSON.stringify(props['form'])).toContain('c1');
  });
});
