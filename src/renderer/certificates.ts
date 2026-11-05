// Trust a certificate file… (07 §7, 03 §9.1): choose a CA file for a self-signed server certificate. It
// applies to the API host after a restart, so the user is offered Restart now.
import { i18n } from './i18n';
import { confirmLeave } from './session-flows';
import { useDialogs } from './stores/dialogs';

/** Resolves true when a file was chosen. */
export async function trustCertificate(): Promise<boolean> {
  const path = await window.app.shell.chooseCertificateFile();
  if (!path) return false;
  const { t } = i18n.global;
  const { button } = await useDialogs().showTaskDialog({
    instruction: path,
    content: t('app.certificateHint'),
    icon: 'info',
    buttons: [{ id: 'restart', label: t('app.restartNow'), isDefault: true }, 'close'],
  });
  if (button === 'restart' && (await confirmLeave('quit'))) await window.app.shell.relaunch();
  return true;
}
