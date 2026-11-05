<script setup lang="ts">
// A month column's header (09 §5.1): the date box, the explanation lines (collapsible for all months at
// once), "= amount" with Available to Budget / Overbudgeted, and the right strip with the month note and
// Quick Budget icons. Read by screen readers as one group (22 §4.3). A null view is a placeholder column
// past the budget's range (09 §3).
import { addMonths } from '@shared/dates';
import type { BudgetMonthView, Money, Month } from '@shared/domain/types';
import { StickyNote, Zap } from 'lucide-vue-next';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { shortMonth } from '../../budget/actions';
import { useBudget } from '../../budget/use-budget';
import { moneyLabel } from '../../money-display';
import MoneyAmount from '../common/MoneyAmount.vue';

const props = defineProps<{
  month: Month | null;
  view: BudgetMonthView | null;
  note: string | null;
}>();
const emit = defineEmits<{
  income: [anchor: HTMLElement];
  note: [anchor: HTMLElement];
  quick: [anchor: HTMLElement];
}>();
const { t } = useI18n();
const b = useBudget();

const past = computed(() => props.month !== null && props.month < b.current);
const isCurrent = computed(() => props.month === b.current);
const isNext = computed(() => props.month === addMonths(b.current, 1));
const money = computed(() => b.format.money);

interface Line {
  key: string;
  label: string;
  amount: Money;
  /** The operator shown before the amount, or ''. */
  op: string;
  /** The amount in full, for screen readers. */
  spoken: string;
  link?: boolean;
}

const lines = computed((): Line[] => {
  const v = props.view;
  const m = props.month;
  if (!v || !m) return [];
  const prev = shortMonth(addMonths(m, -1));
  const mon = shortMonth(m);
  const line = (
    key: string,
    label: string,
    value: Money,
    op: '+' | '-' | null,
    link = false,
  ): Line => ({
    key,
    label,
    amount: value,
    // The operator is shown only before values ≥ 0; negatives show their own "-" (09 §5.1).
    op: op !== null && value >= 0 ? op : '',
    spoken: moneyLabel(value, money.value, { symbol: true }),
    link,
  });
  return [
    line(
      'notBudgeted',
      t(v.notBudgetedPrev < 0 ? 'app.budOverbudgetedIn' : 'app.budNotBudgetedIn', { month: prev }),
      v.notBudgetedPrev,
      null,
    ),
    line('overspent', t('app.budOverspentIn', { month: prev }), v.overspentPrev, '+'),
    line('income', t('app.budIncomeFor', { month: mon }), v.income, '+', true),
    line('budgeted', t('app.budBudgetedIn', { month: mon }), v.budgeted, '-'),
    ...(v.heldForNext !== 0
      ? [
          line(
            'held',
            t('app.budHeldFor', { month: shortMonth(addMonths(m, 1)) }),
            v.heldForNext,
            '-',
          ),
        ]
      : []),
    ...(v.otherAdjustments !== 0
      ? [line('other', t('app.budOtherAdjustments'), v.otherAdjustments, '+')]
      : []),
  ];
});

const result = computed(() => {
  const v = props.view;
  if (!v) return null;
  const value = v.toBudget;
  const negative = value < 0;
  const label = t(negative ? 'budget.overbudgeted' : 'budget.availableToBudget');
  let tone = 'future';
  if (past.value) tone = 'past';
  else if (isCurrent.value) tone = negative ? 'negative' : 'positive';
  else if (isNext.value && negative) tone = 'negative';
  return { value, spoken: moneyLabel(value, money.value, { symbol: true }), label, tone };
});

const monthName = computed(() => (props.month ? shortMonth(props.month).toLocaleUpperCase() : ''));
const year = computed(() => props.month?.slice(0, 4) ?? '');

/** "{Month} {Year}. {label}: {amount}. … Available to Budget: {amount}." (22 §4.3). */
const spoken = computed(() => {
  if (!props.month || !result.value) return '';
  const parts = [`${monthName.value} ${year.value}.`];
  for (const l of lines.value)
    parts.push(t('a11y.budgetHeaderLine', { label: l.label, amount: l.spoken }));
  parts.push(
    t('a11y.budgetHeaderLine', { label: result.value.label, amount: result.value.spoken }),
  );
  return parts.join(' ');
});
</script>

<template>
  <div
    class="month-header"
    :class="{ 'month-header--past': past, 'month-header--empty': !view }"
    role="group"
    :aria-label="spoken || undefined"
    :data-month-header="month ?? ''"
  >
    <div class="month-header__date" aria-hidden="true">
      <span class="month-header__month">{{ monthName }}</span>
      <span class="month-header__year">{{ year }}</span>
    </div>
    <div v-if="view && result" class="month-header__body">
      <div
        class="month-header__lines"
        :class="{ 'month-header__lines--collapsed': !b.headerExpanded }"
      >
        <template v-for="l in lines" :key="l.key">
          <button
            v-if="l.link"
            v-tooltip="t('app.budIncomeLinkTooltip')"
            type="button"
            class="month-header__line month-header__line--link"
            :tabindex="b.headerExpanded ? 0 : -1"
            @click="emit('income', $event.currentTarget as HTMLElement)"
          >
            <span class="month-header__amount"
              >{{ l.op }}<MoneyAmount :value="l.amount" :settings="money"
            /></span>
            <span class="month-header__label">{{ l.label }}</span>
          </button>
          <div v-else class="month-header__line">
            <span class="month-header__amount"
              >{{ l.op }}<MoneyAmount :value="l.amount" :settings="money"
            /></span>
            <span class="month-header__label">{{ l.label }}</span>
          </div>
        </template>
      </div>
      <button
        v-tooltip="t(b.headerExpanded ? 'app.budCollapseDetails' : 'app.budExpandDetails')"
        type="button"
        class="month-header__result"
        :aria-expanded="b.headerExpanded"
        @click="b.toggleHeader()"
      >
        <span class="month-header__total">
          <span
            class="month-header__equals"
            :class="{ 'month-header__equals--hidden': !b.headerExpanded }"
            aria-hidden="true"
            >=</span
          >
          <span class="month-header__value" :class="`month-header__value--${result.tone}`"
            ><MoneyAmount :value="result.value" :settings="money" symbol
          /></span>
        </span>
        <span class="month-header__summary">{{ result.label }}</span>
      </button>
    </div>
    <div v-if="view" class="month-header__strip">
      <button
        v-tooltip="note ?? t('app.budAddNoteTooltip')"
        type="button"
        class="month-header__icon"
        :aria-label="t(note ? 'a11y.budgetNote' : 'a11y.budgetAddNote')"
        @click="emit('note', $event.currentTarget as HTMLElement)"
      >
        <StickyNote aria-hidden="true" />
      </button>
      <button
        v-tooltip="t('app.budQuickBudgetTooltip')"
        type="button"
        class="month-header__icon month-header__icon--quick"
        aria-haspopup="menu"
        :aria-label="t('a11y.quickBudget')"
        @click="emit('quick', $event.currentTarget as HTMLElement)"
      >
        <Zap aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.month-header {
  display: grid;
  grid-template-columns: var(--control-h-lg) minmax(0, 1fr) var(--hit-min);
  min-height: var(--control-h-lg);
  border-radius: var(--radius);
  background: linear-gradient(var(--header-bg-current), var(--header-bg-current-end));
  color: var(--atb-future);
}

.month-header--past {
  background: linear-gradient(var(--header-bg-past), var(--header-bg-past-end));
  color: var(--atb-past);
}

.month-header--empty {
  background: var(--register-gray-bg);
}

.month-header__date {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: var(--control-h-lg);
  height: var(--control-h-lg);
}

.month-header__month {
  font-size: var(--font-xl);
  font-weight: 700;
}

.month-header__year {
  color: var(--header-explanation-amount);
  font-size: var(--font-sm);
  font-weight: 700;
}

.month-header__body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: var(--space-2) var(--space-2);
}

.month-header__lines {
  display: grid;
  grid-template-rows: 1fr;
  overflow: hidden;
  max-height: 12rem;
  transition: max-height 200ms ease;
}

.month-header__lines--collapsed {
  max-height: var(--space-1);
}

.month-header__line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: var(--space-2);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.month-header__line--link {
  cursor: pointer;
}

.month-header__amount {
  color: var(--header-explanation-amount);
  font-size: var(--font-sm);
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
}

.month-header__label {
  overflow: hidden;
  color: var(--header-explanation-label);
  font-size: var(--font-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.month-header__result {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.month-header__total {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
}

.month-header__equals {
  overflow: hidden;
  max-width: 2rem;
  color: var(--header-equals-sign);
  font-size: var(--font-xl);
  font-weight: 700;
  transition: max-width 200ms ease;
}

.month-header__equals--hidden {
  max-width: 0;
}

.month-header__value {
  font-size: var(--font-2xl);
  font-weight: 700;
}

.month-header__value--positive {
  color: var(--atb-positive);
}

.month-header__value--negative {
  color: var(--atb-negative);
}

.month-header__value--future {
  color: var(--atb-future);
}

.month-header__value--past {
  color: var(--atb-past);
}

.month-header__summary {
  color: var(--atb-future);
  font-size: var(--font-body);
  font-weight: 600;
}

.month-header__strip {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: var(--space-1) 0;
}

.month-header__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--hit-min);
  height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--atb-future);
  cursor: pointer;
}

.month-header__icon--quick {
  opacity: 0.5;
}

.month-header__icon--quick:hover,
.month-header__icon--quick:focus-visible {
  opacity: 1;
}

.month-header__icon svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.month-header--past .month-header__year,
.month-header--past .month-header__amount,
.month-header--past .month-header__label,
.month-header--past .month-header__equals,
.month-header--past .month-header__summary {
  color: var(--atb-past);
}

.month-header__line--link:hover .month-header__amount,
.month-header__line--link:hover .month-header__label {
  text-decoration: underline;
}

@media (prefers-reduced-motion: reduce) {
  .month-header__lines,
  .month-header__equals {
    transition: none;
  }
}
</style>
