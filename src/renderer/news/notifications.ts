// The Notifications dialog and the two toasts (24 §3.3, §4.6–4.7). `useNotificationEffects` is mounted
// once in App.vue, so the toasts work on every screen, start screens included.
import { releasePostUrl } from '@shared/news/feed';
import { releaseToNotify } from '@shared/news/read-state';
import { watch } from 'vue';
import { useI18n } from 'vue-i18n';
import NotificationsDialog from '../components/news/NotificationsDialog.vue';
import { useModals } from '../stores/modals';
import { useSettings } from '../stores/settings';
import { useToasts } from '../stores/toasts';
import { useNews, useUpdateStatus } from './use-news';

export const UPDATE_TOAST = 'update-available';
export const WHATS_NEW_TOAST = 'whats-new';

/**
 * Opens the Notifications dialog: from the bell, Help ▸ Notifications… or the "what's new" toast. Not
 * while the feed is off. Opening it by any route removes the "what's new" toast, which is now redundant.
 */
export async function openNotifications(): Promise<void> {
  if (!useSettings().app.showNewsFeed) return;
  useToasts().remove(WHATS_NEW_TOAST);
  const modals = useModals();
  if (modals.stack.some((m) => m.component === NotificationsDialog)) return;
  await modals.open(NotificationsDialog);
}

export function useNotificationEffects(): void {
  const { t, locale } = useI18n();
  const settings = useSettings();
  const toasts = useToasts();
  const news = useNews();
  const updates = useUpdateStatus();

  // The first-run baseline (24 §4.4) and the "what's new" toast after an upgrade (24 §4.7).
  watch(
    [news.isEnabled, news.entries, news.lastSeen, updates.clientVersion, locale],
    () => {
      if (!news.isEnabled.value) {
        toasts.remove(WHATS_NEW_TOAST);
        return;
      }
      const entries = news.entries.value;
      if (entries.length === 0) return;
      // A new install, or the first version with this feature: nothing is unread, and nothing is shown.
      if (news.lastSeen.value === null) {
        void news.markAllSeen();
        return;
      }
      const client = updates.clientVersion.value;
      if (client === null) return;
      const release = releaseToNotify(entries, news.lastSeen.value, client);
      if (!release) {
        toasts.remove(WHATS_NEW_TOAST);
        return;
      }
      toasts.show({
        id: WHATS_NEW_TOAST,
        title: t('app.whatsNewTitle', { version: release.version }),
        message: t('app.whatsNewMessage'),
        action: { label: t('app.whatsNewAction'), run: openNotifications },
        // Up to this release only: a newer release or a later post stays unread.
        onClose: () => news.markSeenUpTo(release.date),
      });
    },
    { immediate: true },
  );

  // The update toast (24 §3.3): at most once per version on this device.
  watch(
    [updates.status, updates.latest, () => settings.app.updateNotificationShownForVersion, locale],
    () => {
      const latest = updates.latest.value;
      if (
        updates.status.value !== 'outdated' ||
        latest === null ||
        settings.app.updateNotificationShownForVersion === latest
      ) {
        toasts.remove(UPDATE_TOAST);
        return;
      }
      toasts.show({
        id: UPDATE_TOAST,
        title: t('app.updateToastTitle'),
        message: t('app.updateToastMessage', { version: latest }),
        // The release post links the download page; the toast stays.
        action: {
          label: t('app.updateToastAction'),
          run: () => window.app.shell.openExternal(releasePostUrl(latest)),
        },
        onClose: () => settings.set('updateNotificationShownForVersion', latest),
      });
    },
    { immediate: true },
  );
}
