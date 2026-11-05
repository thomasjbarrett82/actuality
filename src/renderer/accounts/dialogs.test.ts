// Opening the account dialogs (13 §2, §4) and the account header requests (13 §3): what each one leads to.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CloseAccountDialog from '../components/accounts/CloseAccountDialog.vue';
import CreateAccountDialog from '../components/accounts/CreateAccountDialog.vue';
import { setEditGuard } from '../register/edit-guard';
import { useAppStore } from '../stores/app';
import { useModals } from '../stores/modals';
import { account, answerModal } from '../testing/fixtures';
import { askClose, closeAccountFlow, createAccount } from './dialogs';
import { closeAccount } from './flows';
import { headerRequest, requestHeaderAction, takeHeaderRequest } from './header-request';

vi.mock(import('./flows'), async (original) => ({
  ...(await original()),
  closeAccount: vi.fn(() => Promise.resolve('closed' as const)),
}));

const checking = account({ id: 'chk', name: 'Checking' });

describe('account dialogs (13 §2, §4)', () => {
  beforeEach(() => {
    vi.mocked(closeAccount).mockClear();
  });

  it('Add Account opens the new account, or nothing on Cancel', async () => {
    const created = createAccount();
    expect(useModals().stack[0]?.component).toBe(CreateAccountDialog);
    expect(await answerModal('new-id')).toEqual({});
    await created;
    expect(useAppStore().activeAccountId).toBe('new-id');

    const cancelled = createAccount();
    await answerModal(null);
    await cancelled;
    expect(useAppStore().activeAccountId).toBe('new-id');
  });

  it('asks Close Account in its dialog', async () => {
    const asked = askClose(checking);
    expect(useModals().stack[0]?.component).toBe(CloseAccountDialog);
    expect(await answerModal({ action: 'forceClose' })).toEqual({ account: checking });
    await expect(asked).resolves.toEqual({ action: 'forceClose' });
  });

  it('runs Close Account with that dialog', async () => {
    await expect(closeAccountFlow(checking)).resolves.toBe('closed');
    expect(closeAccount).toHaveBeenCalledWith(checking, askClose);
  });
});

describe('account header requests (13 §3)', () => {
  it("opens the account's register and leaves the action for its header, once", async () => {
    await requestHeaderAction('chk', 'note');
    expect(useAppStore().activeAccountId).toBe('chk');
    expect(takeHeaderRequest('sav')).toBeNull();
    expect(takeHeaderRequest('chk')).toBe('note');
    expect(takeHeaderRequest('chk')).toBeNull();
    expect(headerRequest.value).toBeNull();
  });

  it('waits for an open edit, and leaves nothing when the edit is kept', async () => {
    // An edit with changes asks to commit; once committed, nothing is open any more.
    let open = true;
    let commit: (ok: boolean) => void = () => undefined;
    const remove = setEditGuard(() =>
      open
        ? new Promise<boolean>((resolve) => {
            commit = (ok) => {
              open = !ok;
              resolve(ok);
            };
          })
        : true,
    );
    const kept = requestHeaderAction('sav', 'rename');
    commit(false);
    await kept;
    expect(useAppStore().activeAccountId).not.toBe('sav');
    expect(headerRequest.value).toBeNull();

    const committed = requestHeaderAction('sav', 'rename');
    commit(true);
    await committed;
    expect(useAppStore().activeAccountId).toBe('sav');
    expect(headerRequest.value).toEqual({ accountId: 'sav', action: 'rename' });
    remove();
    headerRequest.value = null;
  });
});
