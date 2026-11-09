<script setup lang="ts">
// Notifications (24 §4.6): the news feed's entries, newest first, with links to every release's notes and
// the blog. Opening it marks everything seen, so the bell's badge clears at once, but the unread dots keep
// the state from the moment it opened until it closes.
import { BLOG_URL, RELEASE_NOTES_URL } from '@shared/news/feed';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { announce } from '../../a11y/announcer';
import { useNews } from '../../news/use-news';
import AppSpinner from '../common/AppSpinner.vue';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';
import UiLink from '../common/UiLink.vue';
import NewsEntryCard from './NewsEntryCard.vue';

const emit = defineEmits<{ close: [result: null] }>();
const { t } = useI18n();
const news = useNews();
const { entries } = news;

/** The read state when the dialog opened: the markers come from it, not from the stored value. */
const seenAtOpen = news.lastSeen.value;
const unread = (date: string): boolean => seenAtOpen !== null && date > seenAtOpen;

watch(
  entries,
  (list) => {
    if (list.length > 0) void news.markAllSeen();
  },
  { immediate: true },
);

const state = computed<'loading' | 'error' | 'empty' | 'entries'>(() => {
  if (news.isLoaded.value) return entries.value.length > 0 ? 'entries' : 'empty';
  return news.isError.value ? 'error' : 'loading';
});
const loading = ref(state.value === 'loading');
watch(state, (s) => {
  loading.value = s === 'loading';
  if (s === 'error') announce(t('app.newsError'));
  else if (s === 'empty') announce(t('app.newsEmpty'));
  else if (s === 'entries') announce(t('a11y.newsLoaded', entries.value.length));
});
</script>

<template>
  <StandardDialog
    :title="t('app.newsTitle')"
    width="lg"
    height="36rem"
    @cancel="emit('close', null)"
    @submit="emit('close', null)"
  >
    <div class="news__links">
      <UiLink :href="RELEASE_NOTES_URL">{{ t('app.newsAllReleaseNotes') }}</UiLink>
      <UiLink :href="BLOG_URL">{{ t('app.newsBlog') }}</UiLink>
    </div>
    <div class="news__list" :aria-busy="loading ? 'true' : undefined">
      <div v-if="state === 'loading'" class="news__loading" role="status">
        <AppSpinner class="news__spinner" />
        <span class="visually-hidden">{{ t('a11y.newsLoading') }}</span>
      </div>
      <p v-else-if="state === 'error'" class="news__message">{{ t('app.newsError') }}</p>
      <p v-else-if="state === 'empty'" class="news__message">{{ t('app.newsEmpty') }}</p>
      <ul v-else class="news__entries">
        <li v-for="entry in entries" :key="entry.id">
          <NewsEntryCard :entry="entry" :unread="unread(entry.date)" />
        </li>
      </ul>
    </div>
    <template #footer>
      <UiButton primary @click="emit('close', null)">{{ t('taskDialog.CloseLabel') }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
/* The links stay in view while the list scrolls under them (the content's own padding is cancelled). */
.news__links {
  position: sticky;
  top: calc(-1 * var(--space-6));
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  margin-top: calc(-1 * var(--space-6));
  padding: var(--space-6) 0 var(--space-3);
  border-bottom: 1px solid var(--register-border);
  background: var(--panel-bg);
  z-index: 1;
}

.news__loading {
  display: flex;
  justify-content: center;
  padding: var(--space-7) 0;
}

/* Fades in after a moment, so a fast load doesn't flash it. */
.news__spinner {
  width: 4rem;
  height: 4rem;
  animation: news-spinner-in 200ms ease 400ms both;
}

@keyframes news-spinner-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.news__message {
  margin: var(--space-5) 0;
  color: var(--text-subtle);
}

.news__entries {
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
