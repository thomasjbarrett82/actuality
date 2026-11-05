// Small dialog helpers the register flows share (17 §1): the offline message, a plain message, and a
// write call that reports its failure.
import { i18n } from '../i18n';
import { errorInfo } from '../rpc/errors';
import { showUnexpected } from '../session';
import { useDialogs, type TaskDialogIcon } from '../stores/dialogs';

export const tr = (key: string, params: Record<string, unknown> | unknown[] = {}): string =>
  i18n.global.t(key, params as Record<string, unknown>);

/** A plural message: `n` picks the form, `params` fill it (`{n}` included). */
export const trn = (key: string, n: number, params: Record<string, unknown> = {}): string =>
  i18n.global.t(key, { n, ...params }, n);

/** "You're offline" (03 §5.1). */
export async function showOffline(): Promise<void> {
  await useDialogs().showTaskDialog({
    instruction: tr('app.offlineTitle'),
    content: tr('app.offlineMessage'),
    icon: 'warning',
    buttons: ['close'],
  });
}

export async function tell(
  instruction: string,
  content: string,
  icon: TaskDialogIcon = 'warning',
  button: 'close' | 'ok' = 'close',
): Promise<void> {
  await useDialogs().showTaskDialog({ instruction, content, icon, buttons: [button] });
}

/** Runs a host write; on failure shows the offline dialog or "Something went wrong". */
export async function attempt<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (errorInfo(e).code === 'offline') await showOffline();
    else await showUnexpected(e);
    return { ok: false };
  }
}
