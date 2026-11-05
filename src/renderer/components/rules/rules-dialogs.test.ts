// The Rules dialog (23 §2) and the rule editor (23 §3) with a mocked host: the list in run order, the
// filters, deleting, creating, saving, the incomplete-rule warning, a schedule's read-only rule, the
// matching transactions with Apply Actions, and the offline read-only state.
import type { Rule } from '@shared/domain/rules';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { reactive, type Component } from 'vue';
import { emptyForm, formOf, type RuleForm } from '../../rules/form';
import { useConnection } from '../../stores/connection';
import { useModals } from '../../stores/modals';
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
import RuleEditorDialog from './RuleEditorDialog.vue';
import RulesDialog from './RulesDialog.vue';

const RULES: Rule[] = [
  {
    id: 'r-pre',
    stage: 'pre',
    conditionsOp: 'or',
    conditions: [{ field: 'imported_payee', op: 'contains', value: 'KROGER' }],
    actions: [{ op: 'set', field: 'payee', value: 'p-kroger' }],
    schedule: null,
  },
  {
    id: 'r-default',
    stage: null,
    conditionsOp: 'and',
    conditions: [{ field: 'payee', op: 'is', value: 'p-shell' }],
    actions: [{ op: 'set', field: 'category', value: 'c-fuel' }],
    schedule: null,
  },
  {
    id: 'r-sched',
    stage: null,
    conditionsOp: 'and',
    conditions: [{ field: 'payee', op: 'is', value: 'p-rent' }],
    actions: [{ op: 'link-schedule', value: 's-rent' }],
    schedule: { id: 's-rent', name: 'Rent' },
  },
];

let host: ReturnType<typeof mockHost>;
function respond(extra: Responses = {}): void {
  host = mockHost({
    'rules.list': () => RULES,
    'payees.list': () => [
      payee({ id: 'p-kroger', name: 'Kroger' }),
      payee({ id: 'p-shell', name: 'Shell' }),
      payee({ id: 'p-rent', name: 'Rent Co' }),
    ],
    'accounts.list': () => [account({ id: 'chk', name: 'Checking' })],
    'categories.tree': () => GROUPS,
    'rules.matches': () => ({
      rows: [
        {
          id: 't1',
          accountId: 'chk',
          date: '2026-10-02',
          payeeId: 'p-kroger',
          categoryId: 'c-groceries',
          notes: 'Weekly',
          amount: -5000,
        },
      ],
      more: false,
    }),
    'rules.save': () => ({ id: 'r-new' }),
    'rules.applyActions': () => ({ count: 1 }),
    ...extra,
  });
}

beforeEach(() => {
  respond();
  useConnection().info = ONLINE;
  useConnection().hostReady = true;
});

async function mount(component: Component, props: Record<string, unknown>): Promise<VueWrapper> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mountApp(component, {
    props,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return w;
}

const button = (w: VueWrapper, text: string) => {
  const b = w.findAll('button').find((x) => x.text() === text);
  if (!b) throw new Error(`no button ${text}`);
  return b;
};
const rowTexts = (w: VueWrapper): string[] => w.findAll('[data-rule-text]').map((b) => b.text());
const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 350));
  await flushPromises();
};

describe('Rules dialog (23 §2)', () => {
  it('lists the rules in run order with their stage and text', async () => {
    const w = await mount(RulesDialog, { payeeId: null });
    expect(rowTexts(w)).toEqual([
      'If imported payee contains "KROGER" then set payee to Kroger',
      'If payee is Shell then set category to Everyday Expenses: Fuel',
      'If payee is Rent Co then link to the schedule',
    ]);
    const stages = w.findAll('.rules__stage').map((s) => s.text());
    expect(stages).toEqual(['Pre', 'Default', 'Schedule']);
    // A schedule's rule can't be checked for deletion.
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(2);
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });

  it('filters by text and by payee', async () => {
    const w = await mount(RulesDialog, { payeeId: 'p-shell' });
    expect(w.text()).toContain('Payee: Shell');
    expect(rowTexts(w)).toHaveLength(1);
    await w.get('[data-payee-filter] button').trigger('click');
    expect(rowTexts(w)).toHaveLength(3);
    await w.get('input[type="search"]').setValue('kroger');
    expect(rowTexts(w)).toHaveLength(1);
    await w.get('input[type="search"]').setValue('nothing like this');
    expect(w.text()).toContain('No rules match the filter.');
  });

  it('deletes the checked rules after a confirmation', async () => {
    const w = await mount(RulesDialog, { payeeId: null });
    await w.findAll('input[type="checkbox"]')[1]?.setValue(true);
    await button(w, 'Delete 1 rule').trigger('click');
    expect(await answerDialog('delete')).toMatchObject({
      instruction: 'Delete 1 rule?',
      content: "Deleted rules can't be restored.",
    });
    expect(host.calls('rules.delete')).toEqual([{ ids: ['r-default'] }]);
  });

  it('opens the editor for a rule, and for a new one with the payee filter', async () => {
    const w = await mount(RulesDialog, { payeeId: 'p-shell' });
    await w.get('[data-rule-text]').trigger('click');
    const modals = useModals();
    expect(modals.stack.at(-1)?.component).toBe(RuleEditorDialog);
    expect((modals.stack.at(-1)?.props['form'] as RuleForm).id).toBe('r-default');
    await button(w, 'Create a New Rule').trigger('click');
    const form = modals.stack.at(-1)?.props['form'] as RuleForm;
    expect(form.id).toBeNull();
    expect(form.conditions[0]).toMatchObject({ field: 'payee', op: 'is', id: 'p-shell' });
  });

  it('is read-only offline', async () => {
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    const w = await mount(RulesDialog, { payeeId: null });
    expect(button(w, 'Create a New Rule').attributes('disabled')).toBeDefined();
    expect(w.get('input[type="checkbox"]').attributes('disabled')).toBeDefined();
  });
});

describe('Rule editor (23 §3)', () => {
  it('warns about an incomplete rule instead of saving', async () => {
    const w = await mount(RuleEditorDialog, { form: emptyForm() });
    expect(w.text()).toContain('New Rule');
    await button(w, 'Save').trigger('click');
    expect(await answerDialog('close')).toMatchObject({
      instruction: "This rule isn't complete",
      content: 'Fill in or remove the highlighted rows.',
    });
    expect(w.find('[data-condition][aria-invalid="true"]').exists()).toBe(true);
    expect(host.calls('rules.save')).toEqual([]);
  });

  it('saves the stage, conditions and actions', async () => {
    const w = await mount(RuleEditorDialog, { form: emptyForm() });
    await w.get('[data-condition] input[data-rule-value]').setValue('AMZN');
    await button(w, 'Pre').trigger('click');
    await w.get('[data-action] select').setValue('set:notes');
    await w.get('[data-action] input[data-rule-value]').setValue('Online');
    expect(w.text()).toContain('Replaces the whole note.');
    await button(w, 'Save').trigger('click');
    await flushPromises();
    expect(host.calls('rules.save')).toEqual([
      {
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [{ field: 'imported_payee', op: 'contains', value: 'AMZN', type: 'string' }],
        actions: [{ op: 'set', field: 'notes', value: 'Online', type: 'string' }],
      },
    ]);
    expect(w.emitted('close')?.[0]).toEqual([{ id: 'r-new' }]);
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });

  it('opens a rule from the query cache, whose objects are reactive', async () => {
    const [first] = RULES;
    if (!first) throw new Error('rules');
    const w = await mount(RuleEditorDialog, { form: formOf(reactive(structuredClone(first))) });
    expect(w.text()).toContain('Edit Rule');
    expect(
      (w.get('[data-condition] input[data-rule-value]').element as HTMLInputElement).value,
    ).toBe('KROGER');
  });

  it('lists the matching transactions and applies the actions to the checked ones', async () => {
    const [first] = RULES;
    if (!first) throw new Error('rules');
    const w = await mount(RuleEditorDialog, { form: formOf(first) });
    await settle();
    expect(host.calls('rules.matches').at(-1)).toEqual({
      conditionsOp: 'or',
      conditions: [{ field: 'imported_payee', op: 'contains', value: 'KROGER', type: 'string' }],
    });
    expect(w.get('[data-match-id="t1"]').text()).toContain('Everyday Expenses: Groceries');
    await w.get('[data-match-id="t1"] input').setValue(true);
    await button(w, 'Apply Actions').trigger('click');
    expect(await answerDialog('apply')).toMatchObject({
      instruction: "Apply this rule's actions to 1 transaction?",
    });
    expect(host.calls('rules.applyActions')).toEqual([
      { ids: ['t1'], actions: [{ op: 'set', field: 'payee', value: 'p-kroger', type: 'id' }] },
    ]);
  });

  it('drops the listed matches and checked rows as soon as the conditions change', async () => {
    const [first] = RULES;
    if (!first) throw new Error('rules');
    const w = await mount(RuleEditorDialog, { form: formOf(first) });
    await settle();
    await w.get('[data-match-id="t1"] input').setValue(true);
    expect(button(w, 'Apply Actions').attributes('disabled')).toBeUndefined();
    await w.get('[data-condition] input[data-rule-value]').setValue('KROGER #2');
    // Before the debounce runs: no stale rows, nothing to apply.
    expect(w.find('[data-match-id="t1"]').exists()).toBe(false);
    expect(button(w, 'Apply Actions').attributes('disabled')).toBeDefined();
    await settle();
    expect(w.get('[data-match-id="t1"] input').element).toHaveProperty('checked', false);
  });

  it('ignores a matches response that arrives after the conditions changed', async () => {
    const [first] = RULES;
    if (!first) throw new Error('rules');
    let answer: (v: unknown) => void = () => undefined;
    respond({ 'rules.matches': () => new Promise((r) => (answer = r)) });
    const w = await mount(RuleEditorDialog, { form: formOf(first) });
    await new Promise((r) => setTimeout(r, 350));
    // The request is in flight; the condition becomes incomplete.
    await w.get('[data-condition] input[data-rule-value]').setValue('');
    answer({
      rows: [
        {
          id: 't1',
          accountId: 'chk',
          date: '2026-10-02',
          payeeId: 'p-kroger',
          categoryId: null,
          notes: '',
          amount: -5000,
        },
      ],
      more: false,
    });
    await flushPromises();
    expect(w.find('[data-match-id="t1"]').exists()).toBe(false);
    expect(w.text()).toContain('Complete the conditions to see matching transactions.');
  });

  it('asks for complete conditions before listing matches', async () => {
    const w = await mount(RuleEditorDialog, { form: emptyForm() });
    await settle();
    expect(w.text()).toContain('Complete the conditions to see matching transactions.');
    expect(host.calls('rules.matches')).toEqual([]);
  });

  it("opens a schedule's rule read-only, with Edit Schedule", async () => {
    const sched = RULES[2];
    if (!sched) throw new Error('rules');
    const w = await mount(RuleEditorDialog, { form: formOf(sched) });
    expect(w.text()).toContain('Schedule Rule');
    expect(w.text()).toContain('link to the schedule');
    expect(w.get('[data-condition] select').attributes('disabled')).toBeDefined();
    await button(w, 'Edit Schedule').trigger('click');
    expect(w.emitted('close')?.[0]).toEqual([{ scheduleId: 's-rent' }]);
  });
});
