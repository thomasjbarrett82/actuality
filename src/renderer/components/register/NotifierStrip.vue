<script setup lang="ts">
// The notifier strip (10 §5), above the toolbar when needed: errors, needs-category and review counts
// (short text in a narrow strip), each a button applying its search, and the right-aligned Undo notifier.
// The strip starts the toolbar region (22 §2.3).
import { CalendarClock, CircleAlert, Clock, TriangleAlert, Undo2 } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { undoText } from '../../register/actions';
import { programmatic } from '../../register/search';
import { useRegister } from '../../register/use-register';
import { useRegisterSession } from '../../register/view-state';

const emit = defineEmits<{ undo: [] }>();
const { t } = useI18n();
const reg = useRegister();
const session = useRegisterSession();

const strip = ref<HTMLElement | null>(null);
const narrow = ref(false);
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!strip.value) return;
  observer = new ResizeObserver(([entry]) => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
    narrow.value = (entry?.contentRect.width ?? 0) < 56 * rem;
  });
  observer.observe(strip.value);
});
onBeforeUnmount(() => observer?.disconnect());

const n = computed(() => reg.notifiers);
const errorText = computed(() =>
  narrow.value
    ? t('app.regErrorShort', { n: n.value.error }, n.value.error)
    : n.value.error === 1
      ? t('register.categorizedTransferSingle')
      : t('register.categorizedTransfersPlural', { count: n.value.error }),
);
const needsText = computed(() => {
  const c = n.value.needsCategory;
  if (narrow.value)
    return c === 1
      ? t('register.transactionNeedingCategoryShort')
      : t('register.transactionsNeedingCategoryShortPlural', { count: c });
  return c === 1
    ? t('register.transactionNeedingCategory')
    : t('register.transactionsNeedingCategoryPlural', { count: c });
});
const reviewText = computed(() => {
  const c = n.value.forReview;
  if (narrow.value)
    return c === 1
      ? t('register.transactionNeedingApprovalShort')
      : t('register.transactionsNeedingApprovalShortPlural', { count: c });
  return c === 1
    ? t('register.transactionNeedingApproval')
    : t('register.transactionsNeedingApprovalPlural', { count: c });
});
const undo = computed(() => session.state.undo);
const matched = computed(() => session.state.matched);
const shown = computed(
  () =>
    n.value.error > 0 ||
    n.value.needsCategory > 0 ||
    n.value.forReview > 0 ||
    undo.value !== null ||
    matched.value !== null,
);

function show(value: 'error' | 'needsCategory' | 'reminder'): void {
  reg.searchText = programmatic.is(reg.words, value);
}
</script>

<template>
  <div v-if="shown" ref="strip" class="notifiers">
    <button
      v-if="n.error > 0"
      type="button"
      class="notifier notifier--error"
      @click="show('error')"
    >
      <CircleAlert class="notifier__icon" aria-hidden="true" />
      <span>{{ errorText }}</span>
      <span class="notifier__link">{{ t('app.regNotifierShow') }}</span>
    </button>
    <button
      v-if="n.needsCategory > 0"
      type="button"
      class="notifier notifier--needscat"
      @click="show('needsCategory')"
    >
      <TriangleAlert class="notifier__icon" aria-hidden="true" />
      <span>{{ needsText }}</span>
      <span class="notifier__link">{{ t('app.regNotifierShow') }}</span>
    </button>
    <button
      v-if="n.forReview > 0"
      type="button"
      class="notifier notifier--review"
      @click="show('reminder')"
    >
      <Clock class="notifier__icon" aria-hidden="true" />
      <span>{{ reviewText }}</span>
      <span class="notifier__link">{{ t('app.regNotifierShow') }}</span>
    </button>
    <span class="notifiers__spacer" />
    <span v-if="matched" class="notifier notifier--matched" role="status" data-undo-notifier>
      <CalendarClock class="notifier__icon" aria-hidden="true" />
      <span>{{ matched }}</span>
    </span>
    <button
      v-if="undo"
      type="button"
      class="notifier notifier--undo"
      data-undo-notifier
      @click="emit('undo')"
    >
      <Undo2 class="notifier__icon" aria-hidden="true" />
      <span>{{ undoText(undo) }}</span>
      <span class="notifier__link">{{ t('app.regNotifierUndo') }}</span>
    </button>
  </div>
</template>

<style scoped>
.notifiers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-1) 0;
}

.notifiers__spacer {
  flex: 1;
}

.notifier {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--hit-min);
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--text);
  font-size: var(--font-sm);
  cursor: pointer;
}

.notifier__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.notifier__link {
  color: var(--link);
  text-decoration: underline;
}

.notifier--error {
  border-color: var(--notifier-error-border);
  background: var(--notifier-error-bg);
}

.notifier--needscat {
  border-color: var(--needscat-row-border);
  background: var(--needscat-row-bg);
}

.notifier--review {
  border-color: var(--review-row-border);
  background: var(--review-row-bg);
}

.notifier--undo,
.notifier--matched {
  border-color: var(--register-border);
  background: var(--register-gray-bg);
}

.notifier--matched {
  cursor: default;
}
</style>
