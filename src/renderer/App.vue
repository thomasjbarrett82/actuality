<script setup lang="ts">
// The app root (06 §2): connection banner, the current route, and the overlay hosts. Keeps the window
// title (06 §1), the menu state (06 §4) and the palette (05 §1.9) in step, announces connection changes
// (22 §4.5), routes menu commands (06 §4), hosts the session's modals (03 §6.3, §7) and runs the quit flow
// (06 §5).
import { INITIAL_MENU_STATE } from '@shared/shell-api';
import { onBeforeUnmount, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { announce } from './a11y/announcer';
import TheAnnouncer from './a11y/TheAnnouncer.vue';
import { connectionAnnouncement, connectionMenuState, windowTitle } from './app-state';
import { exportBackup } from './budget-file/backup';
import { onInterruptedSlateWipe, wipeSlateClean } from './budget-file/slate-wipe';
import { commands } from './commands';
import AboutDialog from './components/budget-file/AboutDialog.vue';
import KeyboardShortcutsDialog from './components/budget-file/KeyboardShortcutsDialog.vue';
import CalloutHost from './components/common/CalloutHost.vue';
import ConnectionBanner from './components/common/ConnectionBanner.vue';
import DialogHost from './components/common/DialogHost.vue';
import LoadingOverlay from './components/common/LoadingOverlay.vue';
import ModalHost from './components/common/ModalHost.vue';
import TooltipHost from './components/common/TooltipHost.vue';
import SessionHost from './components/session/SessionHost.vue';
import { exportData } from './export/export-flow';
import { budgetWeekStart } from './i18n';
import { importTransactions } from './import/import-flow';
import { isTextInput, keyboard } from './keyboard/dispatcher';
import { useAccounts, useBudgetFormat } from './queries/budget-data';
import { openPayeeSettings } from './register/payee-dialogs';
import { host } from './rpc/host-client';
import { openRules } from './rules/dialogs';
import { closeBudgetToList, openFromMenu, retryConnection, showStartScreen } from './session';
import { quit } from './session-flows';
import { useAppStore } from './stores/app';
import { useConnection } from './stores/connection';
import { useDialogs } from './stores/dialogs';
import { useModals } from './stores/modals';
import { useSettings } from './stores/settings';
import { useTheme } from './theme';

const { t } = useI18n();
const router = useRouter();
const appStore = useAppStore();
const connection = useConnection();
const dialogs = useDialogs();
const settings = useSettings();

useTheme(() => settings.app);

// The calendars start the week on the budget's chosen day (07 §4).
const budgetFormat = useBudgetFormat();
watchEffect(() => {
  budgetWeekStart.value = connection.info.budget ? budgetFormat.value.firstDayOfWeek : null;
});

watchEffect(() => {
  const title = windowTitle(connection.info, t);
  // The document's title too, for assistive technology (WCAG 2.4.2); main ignores page title changes.
  document.title = title;
  void window.app.shell.setTitle(title);
});
const accounts = useAccounts();
watchEffect(() => {
  const single =
    appStore.screen === 'register' &&
    appStore.activeAccountId !== null &&
    appStore.activeAccountId !== 'all';
  window.app.shell.setMenuState({
    ...INITIAL_MENU_STATE,
    ...connectionMenuState(connection.info, connection.hostStatus),
    singleAccount: single,
    accountClosed:
      single &&
      accounts.data.value?.find((a) => a.id === appStore.activeAccountId)?.closed === true,
  });
});
// Host status and readiness on <html>, for the E2E checks.
watchEffect(() => {
  document.documentElement.dataset['hostStatus'] = connection.hostStatus;
  document.documentElement.dataset['hostReady'] = String(connection.hostReady);
});
watch(
  () => connection.info,
  (after, before) => {
    const a = connectionAnnouncement(before, after);
    if (a) announce(t(a.key), a.politeness);
  },
);

// The host stopped restarting after repeated crashes (03 §6.5).
watch(
  () => connection.hostStatus,
  async (status) => {
    if (status !== 'failed') return;
    const { button } = await dialogs.showTaskDialog({
      instruction: t('app.somethingWentWrong'),
      content: t('app.hostFailedMessage'),
      icon: 'error',
      buttons: [
        { id: 'logs', label: t('app.showLogsFolder') },
        { id: 'quit', label: t('app.quit'), isDefault: true },
      ],
    });
    if (button === 'logs') await window.app.shell.showLogsFolder();
    await window.app.shell.quit();
  },
);

const retrying = ref(false);
async function retry(): Promise<void> {
  retrying.value = true;
  try {
    await retryConnection();
  } finally {
    retrying.value = false;
  }
}

const cleanups = [
  commands.register('file.syncNow', async () => {
    await host.call('session.syncNow', {});
    announce(t('a11y.synced'));
  }),
  commands.register('file.closeBudget', async () => {
    await closeBudgetToList();
  }),
  commands.register('file.open', () => {
    openFromMenu();
  }),
  commands.register('file.newBudget', () => {
    showStartScreen('setup');
  }),
  commands.register('file.budgetProperties', () => {
    showStartScreen('properties');
  }),
  commands.register('file.preferences', () => {
    showStartScreen('preferences');
  }),
  commands.register('view.goBudget', () => {
    appStore.toBudget();
  }),
  commands.register('view.goReports', () => {
    appStore.toReports();
  }),
  // The register replaces this while it shows, to pre-select the selected transaction's payee (14 §4).
  commands.register('view.goPayeeSettings', async () => {
    if (connection.info.budget) await openPayeeSettings(null);
  }),
  commands.register('view.goRules', async () => {
    if (connection.info.budget) await openRules();
  }),
  // The register and Budget panels replace these while they show (16 §1–3).
  commands.register('file.importTransactions', async () => {
    await importTransactions(null);
  }),
  commands.register('file.export', async () => {
    await exportData({ screen: 'other' });
  }),
  commands.register('file.exportBackup', async () => {
    await exportBackup();
  }),
  commands.register('file.slateWipe', async () => {
    await wipeSlateClean();
  }),
  commands.register('help.about', async () => {
    await useModals().open(AboutDialog);
  }),
  commands.register('help.keyboardShortcuts', async () => {
    await useModals().open(KeyboardShortcutsDialog);
  }),
  // ? opens Keyboard Shortcuts anywhere outside a text field (06 §6.1).
  keyboard.push((e) => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isTextInput(e.target)) return false;
    void commands.run('help.keyboardShortcuts');
    return true;
  }),
  onInterruptedSlateWipe(),
  window.app.shell.onMenuCommand((command) => void commands.run(command)),
  window.app.shell.onCloseRequested(() => void quit()),
];

if (import.meta.env.DEV) {
  // Development shortcut: Ctrl/Cmd+Shift+G toggles the component gallery.
  cleanups.push(
    commands.register('dev.gallery', async () => {
      await router.push(router.currentRoute.value.name === 'gallery' ? '/' : '/dev/gallery');
    }),
    keyboard.push((e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        void commands.run('dev.gallery');
        return true;
      }
      return false;
    }),
  );
}

onBeforeUnmount(() => {
  for (const c of cleanups) c();
});
</script>

<template>
  <ConnectionBanner :busy="retrying" @retry="retry" @sign-in="retry" />
  <RouterView />
  <SessionHost />
  <ModalHost />
  <DialogHost />
  <CalloutHost />
  <TooltipHost />
  <LoadingOverlay />
  <TheAnnouncer />
</template>
