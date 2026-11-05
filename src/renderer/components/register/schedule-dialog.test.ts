// The Schedule dialog (12 §3.1) with a mocked host: the form a schedule, a new one or a draft becomes;
// the amount operators; Once and the recurrence controls; Actual's upcoming dates; linking and unlinking;
// the save parameters, Cancel, and the save errors.
import type { RecurConfig, Schedule, ScheduleMatch } from '@shared/domain/types';
import { RpcError } from '@shared/rpc/protocol';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  amountsOf,
  draftForm,
  newForm,
  scheduleForm,
  toEdit,
  type FormContext,
  type ScheduleForm,
} from '../../register/schedule-form';
import { useConnection } from '../../stores/connection';
import {
  account,
  answerDialog,
  GROUPS,
  mockHost,
  ONLINE,
  payee,
  type Responses,
} from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';
import ScheduleDialog from './ScheduleDialog.vue';

const CHECKING = account({ id: 'chk', name: 'Checking' });
const SAVINGS = account({ id: 'sav', name: 'Savings' });
const PAYEES = [
  payee({ id: 'p-rent', name: 'Landlord' }),
  payee({ id: 'tp-sav', name: '', transferAccountId: 'sav' }),
];
const MONTHLY: RecurConfig = {
  frequency: 'monthly',
  interval: 1,
  start: '2099-01-05',
  endMode: 'never',
};

const ctx: FormContext = {
  payees: PAYEES,
  accounts: new Map([
    ['chk', CHECKING],
    ['sav', SAVINGS],
  ]),
  today: '2098-12-01',
  transfer: (a) => `Transfer : ${a}`,
  categoryText: (id) => (id === 'c-rent' ? 'Bills: Rent' : ''),
};

const schedule = (s: Partial<Schedule> = {}): Schedule => ({
  id: 's1',
  name: 'Rent',
  accountId: 'chk',
  nextDate: '2099-01-05',
  frequency: 'Monthly',
  twiceAMonthStartDay: null,
  payeeId: 'p-rent',
  transferAccountId: null,
  categoryId: 'c-rent',
  notes: 'Rent #home',
  amount: -100_000,
  amountOp: 'is',
  amount2: null,
  subtransactions: [],
  postsTransaction: true,
  completed: false,
  raw: { date: { ...MONTHLY, fromWeb: 'kept' }, ruleId: 'r1' },
  ...s,
});

const match = (m: Partial<ScheduleMatch> & { id: string }): ScheduleMatch => ({
  accountId: 'chk',
  date: '2098-11-05',
  payeeId: 'p-rent',
  notes: '',
  amount: -100_000,
  ...m,
});

let host: ReturnType<typeof mockHost>;

function respond(extra: Responses = {}): void {
  host = mockHost({
    'accounts.list': () => [CHECKING, SAVINGS],
    'categories.tree': () => GROUPS,
    'payees.list': () => PAYEES,
    'prefs.synced': () => ({}),
    'schedules.preview': () => ['2099-01-05', '2099-02-05'],
    'schedules.linked': () => [match({ id: 't-linked' })],
    'schedules.matches': () => [
      match({ id: 't-linked' }),
      match({ id: 't-found', date: '2098-10-06' }),
    ],
    'schedules.save': (p: { id?: string }) => ({ id: p.id ?? 's-new' }),
    ...extra,
  });
}

beforeEach(() => {
  respond();
  useConnection().info = ONLINE;
  useConnection().hostReady = true;
});

async function open(form: ScheduleForm, props: Record<string, unknown> = {}): Promise<VueWrapper> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mountApp(ScheduleDialog, {
    props: { form, ...props },
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  await flushPromises();
  return w;
}

const button = (w: VueWrapper, text: string) => {
  const b = w.findAll('button').find((x) => x.text() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
};

/** Presses Add (a new schedule) or Save, and returns what `schedules.save` got. */
async function save(w: VueWrapper): Promise<unknown> {
  const isNew = w.findAll('button').some((b) => b.text() === 'Add');
  await button(w, isNew ? 'Add' : 'Save').trigger('click');
  await flushPromises();
  await flushPromises();
  return host.calls('schedules.save').at(-1);
}

const debounce = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 350));
  await flushPromises();
};

describe('the Schedule dialog form (12 §3.1)', () => {
  it('reads a schedule and writes it back unchanged, unknown config fields included', () => {
    const f = scheduleForm(schedule(), 'chk', ctx);
    expect(f).toMatchObject({
      name: 'Rent',
      repeats: true,
      outflow: true,
      magnitude: 100_000,
      tx: { payeeText: 'Landlord', categoryText: 'Bills: Rent', notes: 'Rent #home' },
    });
    expect(toEdit(f, PAYEES, { link: [], unlink: [], moveFrom: null })).toEqual({
      id: 's1',
      name: 'Rent',
      accountId: 'chk',
      date: { ...MONTHLY, fromWeb: 'kept' },
      payee: { kind: 'existing', id: 'p-rent' },
      categoryId: 'c-rent',
      notes: 'Rent #home',
      amountOp: 'is',
      amount: -100_000,
      postsTransaction: true,
    });
  });

  it('writes "is between" with the same sign, the smaller magnitude first', () => {
    const f = scheduleForm(
      schedule({ amountOp: 'isbetween', amount: -90_000, amount2: -110_000 }),
      'chk',
      ctx,
    );
    expect([f.magnitude, f.magnitude2]).toEqual([90_000, 110_000]);
    f.magnitude = 120_000;
    expect(amountsOf(f)).toEqual({ amount: -110_000, amount2: -120_000 });
    f.outflow = false;
    expect(amountsOf(f)).toEqual({ amount: 110_000, amount2: 120_000 });
  });

  it('starts a new schedule Monthly from tomorrow, auto-added (12 §1)', () => {
    const f = newForm('chk', ctx);
    expect(f).toMatchObject({
      id: null,
      repeats: true,
      config: { frequency: 'monthly', interval: 1, start: '2098-12-02', endMode: 'never' },
      postsTransaction: true,
      amountOp: 'is',
    });
  });

  it('pre-fills from a register transaction (12 §4)', () => {
    const f = draftForm(
      {
        accountId: 'chk',
        date: '2099-02-01',
        payeeId: 'tp-sav',
        transferAccountId: 'sav',
        categoryId: null,
        notes: 'save',
        amount: -5000,
        subtransactions: [],
      },
      ctx,
    );
    expect(f).toMatchObject({
      repeats: false,
      once: '2099-02-01',
      tx: { payeeText: 'Transfer : Savings' },
    });
    expect(toEdit(f, PAYEES, { link: [], unlink: [], moveFrom: 't9' })).toMatchObject({
      date: '2099-02-01',
      payee: { kind: 'transfer', accountId: 'sav' },
      moveFrom: 't9',
    });
  });
});

describe('the Schedule dialog (12 §3.1)', () => {
  it('saves the name, operator and recurrence the user set', async () => {
    const w = await open(scheduleForm(schedule(), 'chk', ctx));
    expect(w.text()).toContain('Edit Schedule');
    await w.get('[data-field="name"]').setValue('Big rent');
    await w.get('[data-field="op"]').setValue('isapprox');
    expect(w.text()).toContain('Matches amounts within 7.5%.');
    await w.get('[data-field="preset"]').setValue('EveryOtherWeek');
    await w.get('[data-field="interval"]').setValue('3');
    await w.get('[data-field="interval"]').trigger('change');
    expect((w.get('[data-field="preset"]').element as HTMLSelectElement).value).toBe('custom');
    await w.get('[data-field="unit"]').setValue('monthly');
    await w.get('[data-field="unit"]').trigger('change');
    await button(w, 'Add specific days').trigger('click');
    const [which, kind] = w.findAll('[data-pattern] select');
    await kind?.setValue('FR');
    await kind?.trigger('change');
    await which?.setValue('-1');
    await which?.trigger('change');
    await w.get('input[value="after_n_occurrences"]').setValue(true);
    await w.get('[data-field="occurrences"]').setValue('6');
    await w.get('[data-field="occurrences"]').trigger('change');
    await w.get('[data-field="weekend"]').setValue(true);
    await w.get('[data-field="auto"]').setValue(false);
    expect(await save(w)).toEqual({
      id: 's1',
      name: 'Big rent',
      accountId: 'chk',
      date: {
        frequency: 'monthly',
        interval: 3,
        start: '2099-01-05',
        endMode: 'after_n_occurrences',
        endOccurrences: 6,
        patterns: [{ type: 'FR', value: -1 }],
        skipWeekend: true,
        weekendSolveMode: 'after',
        fromWeb: 'kept',
      },
      payee: { kind: 'existing', id: 'p-rent' },
      categoryId: 'c-rent',
      notes: 'Rent #home',
      amountOp: 'isapprox',
      amount: -100_000,
      postsTransaction: false,
    });
    expect(w.emitted('close')).toEqual([[{ id: 's1' }]]);
  });

  it('saves a Once date when Repeats is off, and the second amount of "is between"', async () => {
    const w = await open(newForm('chk', ctx));
    expect(w.text()).toContain('Add Schedule');
    await w.get('[data-field="repeats"]').setValue(false);
    await w.get('[data-field="op"]').setValue('isbetween');
    const amount2 = w.get('[data-field="amount2"] input');
    await amount2.setValue('25');
    await amount2.trigger('blur');
    expect(await save(w)).toMatchObject({
      date: '2098-12-02',
      amountOp: 'isbetween',
      amount: 0,
      amount2: -2500,
    });
  });

  it("shows Actual's upcoming dates", async () => {
    const w = await open(scheduleForm(schedule(), 'chk', ctx));
    expect(host.calls('schedules.preview')[0]).toEqual({
      date: { ...MONTHLY, fromWeb: 'kept' },
      count: 5,
    });
    expect(w.get('[data-section="upcoming"]').text()).toContain('Upcoming dates');
    expect(w.get('[data-section="upcoming"]').findAll('li')).toHaveLength(2);
  });

  it('hides the upcoming dates when Actual lacks the handler', async () => {
    respond({
      'schedules.preview': () => {
        throw new RpcError('actual', 'missing', { code: 'internal-handler-unavailable' });
      },
    });
    const w = await open(scheduleForm(schedule(), 'chk', ctx));
    expect(w.find('[data-section="upcoming"]').exists()).toBe(false);
  });

  it('links found transactions and unlinks linked ones, written by Save (12 §3.1)', async () => {
    const w = await open(scheduleForm(schedule(), 'chk', ctx));
    const rows = () => w.findAll('[data-match-id]').map((r) => r.attributes('data-match-id'));
    expect(rows()).toEqual(['t-linked']);
    await w.get('[data-match-id="t-linked"] input').setValue(true);
    await button(w, 'Unlink').trigger('click');
    expect(w.text()).toContain('No transactions are linked to this schedule.');
    await button(w, 'Find matching transactions').trigger('click');
    await debounce();
    expect(host.calls('schedules.matches').at(-1)).toEqual({
      accountId: 'chk',
      payee: { kind: 'existing', id: 'p-rent' },
      date: { ...MONTHLY, fromWeb: 'kept' },
      amountOp: 'is',
      amount: -100_000,
    });
    expect(rows()).toEqual(['t-linked', 't-found']);
    await w.get('[data-match-id="t-found"] input').setValue(true);
    await button(w, 'Link to schedule').trigger('click');
    expect(rows()).toEqual(['t-linked']);
    expect(await save(w)).toMatchObject({ link: ['t-found'], unlink: ['t-linked'] });
  });

  it('says when Actual cannot search for matches', async () => {
    respond({ 'schedules.matches': () => null });
    const w = await open(newForm('chk', ctx));
    await debounce();
    expect(w.text()).toContain("This version of Actual can't search for matching transactions.");
  });

  it('says when the linked transactions fail to load, and retries on return (12 §3.1)', async () => {
    let fail = true;
    respond({
      'schedules.linked': () => {
        if (fail) throw new RpcError('actual', 'boom');
        return [match({ id: 't-linked' })];
      },
    });
    const w = await open(scheduleForm(schedule(), 'chk', ctx));
    expect(w.text()).toContain("The linked transactions couldn't be loaded.");
    expect(w.text()).not.toContain('No transactions are linked to this schedule.');
    fail = false;
    await button(w, 'Find matching transactions').trigger('click');
    await button(w, 'Linked transactions').trigger('click');
    await flushPromises();
    expect(w.find('[data-load-failed]').exists()).toBe(false);
    expect(w.findAll('[data-match-id]').map((r) => r.attributes('data-match-id'))).toEqual([
      't-linked',
    ]);
  });

  it('says when the matching transactions fail to load (12 §3.1)', async () => {
    respond({
      'schedules.matches': () => {
        throw new RpcError('actual', 'boom');
      },
    });
    const w = await open(newForm('chk', ctx));
    await debounce();
    expect(w.text()).toContain("The matching transactions couldn't be loaded.");
    expect(w.text()).not.toContain('No matching transactions.');
  });

  it('explains a transfer to its own account and stays open', async () => {
    respond({
      'schedules.save': () => {
        throw new RpcError('validation', 'self', { code: 'transfer-to-self' });
      },
    });
    const w = await open(scheduleForm(schedule(), 'chk', ctx));
    void button(w, 'Save').trigger('click');
    const options = await answerDialog('close');
    expect(options.instruction).toBe("You can't transfer from an account to itself.");
    expect(w.emitted('close')).toBeUndefined();
  });

  it('passes Move to scheduler’s transaction to the save', async () => {
    const w = await open(newForm('chk', ctx), { moveFrom: 't9' });
    expect(await save(w)).toMatchObject({ moveFrom: 't9' });
  });

  it('writes nothing on Cancel', async () => {
    const w = await open(scheduleForm(schedule(), 'chk', ctx));
    await w.get('[data-field="name"]').setValue('Changed');
    // Save is save-toned (green, blue in CVD) and Cancel cancel-toned (red, orange in CVD) (12 §3.1).
    expect(button(w, 'Save').classes()).toContain('ui-button--save');
    expect(button(w, 'Cancel').classes()).toContain('ui-button--cancel');
    await button(w, 'Cancel').trigger('click');
    expect(w.emitted('close')).toEqual([[null]]);
    expect(host.calls('schedules.save')).toEqual([]);
  });

  it('explains a taken name and stays open', async () => {
    respond({
      'schedules.save': () => {
        throw new RpcError('validation', 'taken', { code: 'name-taken' });
      },
    });
    const w = await open(scheduleForm(schedule(), 'chk', ctx));
    void button(w, 'Save').trigger('click');
    const options = await answerDialog('close');
    expect(options.instruction).toBe('Schedule name already used');
    expect(options.content).toContain("There is already a schedule named 'Rent'.");
    expect(w.emitted('close')).toBeUndefined();
  });

  it('has no axe violations', async () => {
    vi.useRealTimers();
    const w = await open(scheduleForm(schedule(), 'chk', ctx));
    expect(await axe(w.element as Element)).toHaveNoViolations();
  });
});
