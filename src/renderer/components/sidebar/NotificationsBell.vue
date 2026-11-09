<script setup lang="ts">
// The notifications bell (24 §4.5, 08 §2.4): an icon button left of the privacy toggle that opens the
// Notifications dialog, with a badge counting the unread entries ("9+" from 10). The count is in the
// accessible name; the badge is hidden from assistive technology. Always enabled, offline too, and never
// shows an error. Not rendered while the news feed is off.
import { Bell } from 'lucide-vue-next';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { openNotifications } from '../../news/notifications';
import { useNews } from '../../news/use-news';

const { t } = useI18n();
const { isEnabled, unseenCount } = useNews();
const badge = computed(() =>
  unseenCount.value >= 10 ? t('app.newsBadgeOverflow') : String(unseenCount.value),
);
const name = computed(() =>
  unseenCount.value > 0 ? t('app.newsBellUnread', { n: unseenCount.value }) : t('app.newsTitle'),
);
</script>

<template>
  <button
    v-if="isEnabled"
    v-tooltip="name"
    type="button"
    class="bell"
    data-notifications-bell
    :aria-label="name"
    @click="openNotifications()"
  >
    <Bell class="bell__icon" aria-hidden="true" />
    <span v-if="unseenCount > 0" class="bell__badge" aria-hidden="true">{{ badge }}</span>
  </button>
</template>

<style scoped>
.bell {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-on-blue);
  cursor: pointer;
}

.bell:hover {
  background: color-mix(in srgb, var(--text-on-blue) 15%, transparent);
}

.bell__icon {
  width: var(--icon);
  height: var(--icon);
}

/* Top right of the icon, inside the button so no row clips it. */
.bell__badge {
  position: absolute;
  top: 0;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: var(--badge-h-sm);
  height: var(--badge-h-sm);
  padding: 0 var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--news-badge);
  color: var(--news-badge-text);
  font-size: var(--font-xs);
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
}
</style>
