<script setup lang="ts">
// One feed entry in the Notifications dialog (24 §4.6): the type pill, the title (h3), the unread dot,
// the publication date, the body, the full list of changes on demand (releases), and Read on the blog.
import type { NewsEntry } from '@shared/news/feed';
import { ChevronDown, ChevronRight } from 'lucide-vue-next';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import UiLink from '../common/UiLink.vue';
import MarkdownView from './MarkdownView.vue';

const props = defineProps<{ entry: NewsEntry; unread: boolean }>();
const { t, locale } = useI18n();
const id = useId();
const expanded = ref(false);
const details = computed(() => (props.entry.type === 'release' ? props.entry.details : undefined));

/**
 * Feed dates are instants, not budget dates: the one exception to the `YYYY-MM-DD` rule. The Date is in
 * the local time zone, and Intl formats it there in the app language, so a late-UTC instant shows the
 * local date it fell on. The budget's date format isn't used: no budget may be open.
 */
const date = computed(() => {
  const instant = new Date(props.entry.date);
  try {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(instant);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(instant);
  }
});
</script>

<template>
  <article class="entry" :aria-labelledby="`${id}-title`">
    <header class="entry__header">
      <span class="entry__pill" :class="`entry__pill--${entry.type}`">{{
        entry.type === 'release' ? t('app.newsTypeRelease') : t('app.newsTypePost')
      }}</span>
      <h3 :id="`${id}-title`" class="entry__title">{{ entry.title }}</h3>
      <span v-if="unread" class="entry__unread"
        ><span class="entry__dot" aria-hidden="true" /><span class="visually-hidden">{{
          t('a11y.newsUnread')
        }}</span></span
      >
      <time class="entry__date" :datetime="entry.date">{{ date }}</time>
    </header>
    <MarkdownView class="entry__body" :source="entry.body" />
    <template v-if="details">
      <div class="entry__disclosure">
        <button
          type="button"
          class="entry__toggle"
          :aria-expanded="expanded"
          :aria-controls="`${id}-details`"
          @click="expanded = !expanded"
        >
          <component
            :is="expanded ? ChevronDown : ChevronRight"
            class="entry__toggle-icon"
            aria-hidden="true"
          />
          {{ expanded ? t('app.newsHideChanges') : t('app.newsShowChanges') }}
        </button>
      </div>
      <div :id="`${id}-details`" class="entry__details" :hidden="!expanded">
        <MarkdownView :source="details" />
      </div>
    </template>
    <p class="entry__more">
      <UiLink :href="entry.url">{{ t('app.newsReadOnBlog') }}</UiLink>
    </p>
  </article>
</template>

<style scoped>
.entry {
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--grid-line-h);
}

.entry__header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  margin-bottom: var(--space-3);
}

.entry__pill {
  flex: none;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--font-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.entry__pill--release {
  background: var(--news-pill-release-bg);
  color: var(--news-pill-release-text);
}

.entry__pill--post {
  background: var(--news-pill-post-bg);
  color: var(--news-pill-post-text);
}

.entry__title {
  flex: 1 1 12rem;
  min-width: 0;
  margin: 0;
  font-size: var(--font-lg);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.entry__unread {
  display: inline-flex;
  flex: none;
  align-items: center;
}

.entry__dot {
  width: var(--space-3);
  height: var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--accent-blue);
}

.entry__date {
  flex: none;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.entry__disclosure,
.entry__more {
  margin: var(--space-3) 0 0;
}

.entry__toggle {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--link);
  font-size: var(--font-sm);
  cursor: pointer;
}

.entry__toggle-icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.entry__details {
  margin-top: var(--space-3);
  padding-left: var(--space-4);
  border-left: 3px solid var(--register-border);
}
</style>
