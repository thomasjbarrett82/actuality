// Rename Payee (14 §3.1) and Payee Settings (14 §4) with a mocked host: the rename checks and impact
// confirmations, and Payee Settings' single and multiple selection, rules, auto-category, listing, the
// transactions link, the auto-fill preferences and the offline read-only state.
import { DEFAULT_BUDGET_SETTINGS } from '@shared/settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import type { RuleForm } from '../../rules/form';
import { useBudgetSettings } from '../../stores/budget-settings';
import { useConnection } from '../../stores/connection';
import { useModals } from '../../stores/modals';
import { useSettings } from '../../stores/settings';
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
import RulesDialog from '../rules/RulesDialog.vue';
import PayeeSettingsDialog from './PayeeSettingsDialog.vue';
import RenamePayeeDialog from './RenamePayeeDialog.vue';

const PAYEES = [
  payee({ id: 'p-krog', name: 'Krogers #123', usageCount: 4 }),
  payee({ id: 'p-kroger', name: 'Kroger', usageCount: 0 }),
  payee({ id: 'p-shell', name: 'Shell', usageCount: 1, enabled: false }),
  payee({ id: 'tp-sav', name: '', transferAccountId: 'sav', usageCount: 2 }),
];
let host: ReturnType<typeof mockHost>;

function respond(extra: Responses = {}): void {
  host = mockHost({
    'payees.list': () => PAYEES,
    'accounts.list': () => [
      account({ id: 'chk', name: 'Checking' }),
      account({ id: 'sav', name: 'Savings' }),
    ],
    'categories.tree': () => GROUPS,
    'payees.rules': () => ({
      renameRules: [{ op: 'contains', value: 'KROGER' }],
      autoCategoryId: 'c-groceries',
      otherRuleIds: ['r-odd'],
    }),
    'rules.list': () => [],
    'payees.renameImpact': () => ({ total: 3, renameable: 3, uncategorized: 0 }),
    'payees.rename': (p: { id: string }) => ({ id: p.id }),
    'payees.combine': () => ({ id: 'p-kroger' }),
    'payees.applyRenameRules': (p: { dryRun: boolean }) => ({
      count: 2,
      payeeNames: ['Krogers #123', 'Shell'],
      dryRun: p.dryRun,
    }),
    ...extra,
  });
}

beforeEach(() => {
  respond();
  useConnection().info = ONLINE;
  useConnection().hostReady = true;
  const settings = useBudgetSettings();
  settings.cloudFileId = 'c1';
  settings.settings = structuredClone(DEFAULT_BUDGET_SETTINGS);
  vi.spyOn(window.app.shell.settings, 'patchBudget').mockImplementation((_id, p) =>
    Promise.resolve({ ...settings.settings, ...(p as object) }),
  );
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

describe('Rename Payee (14 §3.1)', () => {
  async function rename(text: string): Promise<VueWrapper> {
    const w = await mount(RenamePayeeDialog, { payeeId: 'p-krog' });
    const input = w.get('input[role="combobox"]');
    (input.element as HTMLInputElement).value = text;
    await input.trigger('input');
    await button(w, 'Rename').trigger('click');
    return w;
  }
  it('describes the rename and shows the current name', async () => {
    const w = await mount(RenamePayeeDialog, { payeeId: 'p-krog' });
    expect(w.text()).toContain(
      'Rename transactions with payee "Krogers #123" to the new payee name.',
    );
    expect(w.text()).toContain('Current payee name:');
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });
  it('asks for a different name when it’s unchanged', async () => {
    await rename('Krogers #123');
    expect(await answerDialog('ok')).toMatchObject({
      instruction: 'Enter a new payee name',
      content: 'To rename a payee, first enter a different payee for the "New payee name"',
    });
  });
  it('refuses a blank name and an invalid transfer', async () => {
    await rename('  ');
    expect(await answerDialog('close')).toMatchObject({
      instruction: 'Invalid Payee',
      content: 'The new payee may not be blank.',
    });
    await rename('Transfer : Nowhere');
    expect((await answerDialog('close')).content).toContain('is not a valid account name');
  });
  it('confirms the impact, then renames', async () => {
    await rename('Kroger');
    const asked = await answerDialog('rename');
    expect(asked.instruction).toBe('Existing transactions will be renamed');
    expect(asked.content).toBe(
      'All (3) "**Krogers #123**" transaction(s) will be renamed to:<br/> "**Kroger**"',
    );
    expect(host.calls('payees.rename')[0]).toEqual({ id: 'p-krog', name: 'Kroger' });
  });
  it('says when only some can become transfers, and adds the transfer note', async () => {
    respond({ 'payees.renameImpact': () => ({ total: 3, renameable: 2, uncategorized: 0 }) });
    await rename('Transfer : Savings');
    const asked = await answerDialog('cancel');
    expect(asked.content).toContain(
      '(2) of the (3) "**Krogers #123**" transaction(s) will be renamed to:',
    );
    expect(asked.content).toContain(
      'Note: All renamed transactions will become transfers to the "Savings" account',
    );
    expect(host.calls('payees.rename')).toHaveLength(0);
  });
  it('says when none can be renamed', async () => {
    respond({ 'payees.renameImpact': () => ({ total: 2, renameable: 0, uncategorized: 0 }) });
    await rename('Transfer : Savings');
    expect((await answerDialog('ok')).instruction).toBe('No transactions could be renamed');
  });
  it('skips the confirmation with one renameable transaction', async () => {
    respond({ 'payees.renameImpact': () => ({ total: 1, renameable: 1, uncategorized: 0 }) });
    await rename('Kroger');
    await flushPromises();
    expect(host.calls('payees.rename')[0]).toEqual({ id: 'p-krog', name: 'Kroger' });
  });
});

describe('Payee Settings (14 §4)', () => {
  const settings = (initialId: string | null = 'p-krog') =>
    mount(PayeeSettingsDialog, { initialId });
  it('lists every payee, transfers too, and filters them', async () => {
    const w = await settings(null);
    expect(w.findAll('[role="option"]').map((o) => o.text())).toEqual([
      'Kroger',
      'Krogers #123',
      'Shell',
      'Transfer : Savings',
    ]);
    expect(w.text()).toContain('Select a payee to edit');
    const filter = w.get('input[type="search"]');
    (filter.element as HTMLInputElement).value = 'krog';
    await filter.trigger('input');
    expect(w.findAll('[role="option"]')).toHaveLength(2);
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });
  it('shows one payee’s settings: listing, usage link, auto-category, rules and other rules', async () => {
    const w = await settings();
    expect(w.text()).toContain('List and Autocomplete this payee');
    expect(w.text()).toContain('(used in 4 transaction(s))');
    expect(w.text()).toContain('Rename imported transactions to Krogers #123 if payee:');
    expect((w.find('input[data-rule-value]').element as HTMLInputElement).value).toBe('KROGER');
    expect(w.text()).toContain('Other rule (edit in Rules)');
    expect(w.text()).toContain('Rename Existing Payees');
  });
  it('links to the payee’s rules, or offers to create one (23 §2.1)', async () => {
    const w = await settings();
    expect(w.text()).not.toContain('associated rule');
    await button(w, 'Create a New Rule').trigger('click');
    await flushPromises();
    const modals = useModals();
    const form = modals.stack.at(-1)?.props['form'] as RuleForm;
    expect(form.conditions[0]).toMatchObject({ field: 'payee', op: 'is', id: 'p-krog' });
    modals.close(modals.stack.at(-1)?.id ?? 0, null);

    respond({
      'rules.list': () => [
        {
          id: 'r1',
          stage: null,
          conditionsOp: 'and',
          conditions: [{ field: 'payee', op: 'is', value: 'p-krog' }],
          actions: [{ op: 'set', field: 'notes', value: 'x' }],
          schedule: null,
        },
      ],
    });
    const linked = await settings();
    const link = linked.findAll('a, button').find((x) => x.text() === '1 associated rule');
    await link?.trigger('click');
    await flushPromises();
    expect(modals.stack.at(-1)?.component).toBe(RulesDialog);
    expect(modals.stack.at(-1)?.props).toEqual({ payeeId: 'p-krog' });
  });
  it('opens an other rule in the editor', async () => {
    respond({
      'rules.list': () => [
        {
          id: 'r-odd',
          stage: 'post',
          conditionsOp: 'and',
          conditions: [{ field: 'payee', op: 'is', value: 'p-krog' }],
          actions: [{ op: 'set', field: 'notes', value: 'x' }],
          schedule: null,
        },
      ],
    });
    const w = await settings();
    await w
      .findAll('a, button')
      .find((x) => x.text() === 'Other rule (edit in Rules)')
      ?.trigger('click');
    await flushPromises();
    expect((useModals().stack.at(-1)?.props['form'] as RuleForm).id).toBe('r-odd');
  });
  it('renames inline, straight away', async () => {
    const w = await settings();
    await button(w, 'Rename').trigger('click');
    const input = w.get('.payee-settings__name-input');
    (input.element as HTMLInputElement).value = 'Krogers';
    await input.trigger('input');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(host.calls('payees.rename')[0]).toEqual({ id: 'p-krog', name: 'Krogers' });
  });
  it('turns listing off and on', async () => {
    const w = await settings();
    const box = w
      .findAll('input[type="checkbox"]')
      .find((c) => c.element.closest('label')?.textContent.includes('List and Autocomplete'));
    (box?.element as HTMLInputElement).checked = false;
    await box?.trigger('change');
    expect(host.calls('payees.setEnabled')[0]).toEqual({ ids: ['p-krog'], enabled: false });
  });
  it('saves rule edits after a pause, and applies the rules after a confirmation', async () => {
    vi.useFakeTimers();
    const w = await settings();
    const value = w.get('input[data-rule-value]');
    (value.element as HTMLInputElement).value = 'KRG';
    await value.trigger('input');
    await value.trigger('blur');
    vi.advanceTimersByTime(600);
    vi.useRealTimers();
    await flushPromises();
    expect(host.calls('payees.setRenameRules')[0]).toEqual({
      id: 'p-krog',
      conditions: [{ op: 'contains', value: 'KRG' }],
    });
    await button(w, 'Rename Existing Payees').trigger('click');
    const asked = await answerDialog('rename');
    expect(asked.instruction).toBe(
      "2 transactions will have their payees renamed to 'Krogers #123':",
    );
    expect(asked.content).toBe("**Affected Payees:** 'Krogers #123', 'Shell'");
    expect(asked.footer).toBe('Rename these transactions?');
    expect(host.calls('payees.applyRenameRules').at(-1)).toEqual({ id: 'p-krog', dryRun: false });
  });
  it('says when the rules match nothing', async () => {
    respond({ 'payees.applyRenameRules': () => ({ count: 0, payeeNames: [] }) });
    const w = await settings();
    await button(w, 'Rename Existing Payees').trigger('click');
    expect(await answerDialog('ok')).toMatchObject({
      instruction: 'No transactions found to rename',
      content: 'These rules did not match the payees of any transactions',
    });
  });
  it('offers Add a New Rename Rule when there are none', async () => {
    respond({
      'payees.rules': () => ({ renameRules: [], autoCategoryId: null, otherRuleIds: [] }),
    });
    const w = await settings();
    await button(w, 'Add a New Rename Rule').trigger('click');
    expect(w.findAll('input[data-rule-value]')).toHaveLength(1);
  });
  it('closes with a search for the payee from the usage link (14 §4)', async () => {
    const w = await settings();
    await w
      .findAll('button')
      .find((b) => b.text().includes('4 transaction'))
      ?.trigger('click');
    expect(w.emitted('close')?.[0]).toEqual([{ search: 'Payee: Krogers #123,' }]);
  });
  it('keeps the list checkbox and Rename off for a transfer payee', async () => {
    const w = await settings('tp-sav');
    expect(w.findAll('button').some((b) => b.text() === 'Rename')).toBe(false);
    const box = w
      .findAll('label')
      .find((l) => l.text().includes('List and Autocomplete'))
      ?.find('input');
    expect(box?.attributes('disabled')).toBeDefined();
  });
  it('combines several payees, and disables or enables them', async () => {
    const w = await settings(null);
    const options = w.findAll('[role="option"] [data-check]');
    await options[0]?.trigger('click');
    await options[1]?.trigger('click');
    expect(w.text()).toContain('Multiple Payees Selected (2)');
    await button(w, 'Combine Now').trigger('click');
    await flushPromises();
    expect(host.calls('payees.combine')[0]).toEqual({
      ids: ['p-kroger', 'p-krog'],
      name: 'Kroger',
    });
    await options[2]?.trigger('click');
    await button(w, 'Disable for Selected Payees').trigger('click');
    expect(host.calls('payees.setEnabled').at(-1)).toMatchObject({ enabled: false });
  });
  it('saves the auto-fill preferences', async () => {
    const set = vi.spyOn(useSettings(), 'set').mockResolvedValue();
    const w = await settings();
    const notes = w
      .findAll('label')
      .find((l) => l.text() === 'Notes')
      ?.find('input');
    (notes?.element as HTMLInputElement).checked = true;
    await notes?.trigger('change');
    expect(set).toHaveBeenCalledWith('autofillNotes', true);
  });
  it('is read-only offline, except the selection', async () => {
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    const w = await settings();
    expect(button(w, 'Rename').attributes('disabled')).toBeDefined();
    expect(w.get('input[data-rule-value]').attributes('disabled')).toBeDefined();
    await w.findAll('[role="option"]')[0]?.trigger('click');
    expect(w.text()).toContain('(used in 0 transactions)');
  });
});
