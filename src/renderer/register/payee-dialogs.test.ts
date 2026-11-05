// Opening Payee Settings and Rename Payee (14 §3.1, §4): which payee is pre-selected, and the register
// search its transaction link leads to.
import { DEFAULT_BUDGET_SETTINGS } from '@shared/settings';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PayeeSettingsDialog from '../components/register/PayeeSettingsDialog.vue';
import RenamePayeeDialog from '../components/register/RenamePayeeDialog.vue';
import { queryClient } from '../rpc/query-client';
import { useAppStore } from '../stores/app';
import { useBudgetSettings } from '../stores/budget-settings';
import { useModals } from '../stores/modals';
import { answerModal, mockHost, payee } from '../testing/fixtures';
import { openPayeeSettings, openRenamePayee } from './payee-dialogs';
import { useRegisterSession } from './view-state';

describe('payee dialogs (14 §3.1, §4)', () => {
  beforeEach(() => {
    mockHost({
      'payees.list': () => [
        payee({ id: 'kroger', name: 'Kroger' }),
        payee({ id: 'shell', name: 'Shell' }),
      ],
    });
    useBudgetSettings().settings = {
      ...DEFAULT_BUDGET_SETTINGS,
      payeeSettings: { ...DEFAULT_BUDGET_SETTINGS.payeeSettings, lastPayeeId: 'shell' },
    };
  });
  afterEach(() => {
    queryClient.clear();
  });

  const initialId = async (p: Parameters<typeof openPayeeSettings>[0]): Promise<unknown> => {
    const opened = openPayeeSettings(p);
    await flushPromises();
    expect(useModals().stack[0]?.component).toBe(PayeeSettingsDialog);
    const props = await answerModal(null);
    await opened;
    return props['initialId'];
  };

  it('pre-selects a payee by id, by typed name, or the last one shown', async () => {
    expect(await initialId({ id: 'kroger' })).toBe('kroger');
    expect(await initialId('  kROGER ')).toBe('kroger');
    expect(await initialId('Someone new')).toBe('shell');
    expect(await initialId(null)).toBe('shell');
    expect(useModals().stack).toEqual([]);
  });

  it('pre-selects nothing when the last payee is gone', async () => {
    useBudgetSettings().settings.payeeSettings.lastPayeeId = 'gone';
    expect(await initialId(null)).toBeNull();
  });

  it("the transactions link opens All Accounts with the dialog's search", async () => {
    const opened = openPayeeSettings({ id: 'kroger' });
    await answerModal({ search: 'payee:"Kroger"' });
    await opened;
    expect(useModals().stack).toEqual([]);
    expect(useAppStore().activeAccountId).toBe('all');
    expect(useRegisterSession().view('all').search).toBe('payee:"Kroger"');
  });

  it('opens Rename Payee for the payee', async () => {
    const rename = openRenamePayee('kroger');
    expect(useModals().stack[0]).toMatchObject({
      component: RenamePayeeDialog,
      props: { payeeId: 'kroger' },
    });
    await answerModal(null);
    await rename;
  });
});
