<script setup lang="ts">
// An error badge (05 §4, 08 §2.2): a pill with the count of transactions that need attention, in the
// color of the worst level, ringed on a selected button. Its tooltip is also its name (22 §4.3), unless it is
// `decorative`: inside a sidebar row, which is named from its content and carries the sentence in visually
// hidden text; the badge's own number is hidden from assistive technology (22 §4.3, WCAG 2.5.3).

import type { ErrorLevel } from '@shared/domain/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  count: number;
  level: ErrorLevel;
  selected?: boolean;
  decorative?: boolean;
}>();
const { t } = useI18n();
const tooltip = computed(() => t('app.sidebarBadgeTooltip', props.count));
const name = computed(() => t('a11y.sidebarBadge', props.count));
</script>

<template>
  <span
    v-tooltip="tooltip"
    class="badge"
    :class="[`badge--${level}`, { 'badge--selected': selected }]"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : name"
    :aria-hidden="decorative ? 'true' : undefined"
    >{{ count }}</span
  >
</template>

<style scoped>
.badge {
  --badge-color: var(--error-badge);

  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--badge-h);
  height: var(--badge-h);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--badge-color);
  color: var(--badge-text);
  font-size: var(--font-sm);
  font-weight: 700;
  font-style: normal;
  line-height: 1;
}

.badge--forReview {
  --badge-color: var(--review-badge);
}

.badge--needsCategory {
  --badge-color: var(--needscat-badge);

  color: var(--needscat-badge-text);
}

.badge--selected {
  box-shadow: 0 0 0 1px var(--text-on-blue);
}
</style>
