<script setup lang="ts">
// A notes cell (10 §2, §6.2; 11 §5): the note text with each Actual tag drawn as a colored `#name` pill, and the
// protected `#needs-review` marker as a pill at the end for a transaction that needs approval. A pill is a button
// that filters the register by its tag. The color is the tag entity's (04 §5.2), or `--tag-default-bg`.
import { noteSegments } from '@shared/metadata/notes-codec';
import { REVIEW_TAG, REVIEW_TAG_COLOR } from '@shared/metadata/tags';
import { tagTextColor } from '@shared/tag-color';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTagMap } from '../../queries/budget-data';
import { useDefaultTagText } from '../../register/tag-default';

const props = defineProps<{ notes: string; needsReview?: boolean }>();
const emit = defineEmits<{ tag: [tag: string] }>();
const { t } = useI18n();
const entities = useTagMap();
const defaultText = useDefaultTagText();

const segments = computed(() => noteSegments(props.notes));

/** The inline style for a pill; a tag with no readable color uses the palette's default (05 §1.7). */
function pillStyle(tag: string, fallback: string | null = null): Record<string, string> {
  const color = entities.value.get(tag)?.color ?? fallback;
  const text = color ? tagTextColor(color) : null;
  return color && text ? { background: color, color: text } : { color: defaultText.value };
}
const reviewText = `#${REVIEW_TAG}`;
const reviewStyle = computed(() => pillStyle(REVIEW_TAG, REVIEW_TAG_COLOR));
</script>

<template>
  <span class="note-text">
    <template v-for="(s, i) in segments" :key="i">
      <button
        v-if="s.tag !== undefined"
        type="button"
        tabindex="-1"
        class="note-pill"
        :style="pillStyle(s.tag)"
        :aria-label="t('a11y.filterByTag', { tag: s.text })"
        @click.stop="emit('tag', s.tag)"
      >
        {{ s.text }}
      </button>
      <template v-else>{{ s.text }}</template>
    </template>
    <span v-if="needsReview" class="note-pill note-pill--static" :style="reviewStyle">{{
      reviewText
    }}</span>
  </span>
</template>

<style scoped>
.note-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-pill {
  display: inline;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--tag-default-bg);
  font: inherit;
  font-size: var(--font-sm);
  cursor: pointer;
}

.note-pill--static {
  cursor: default;
}
</style>
