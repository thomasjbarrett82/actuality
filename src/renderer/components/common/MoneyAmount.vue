<script setup lang="ts">
// An amount on screen (06 §7): the formatted value, or in privacy mode a squiggly-line mask of fixed width
// named "Hidden amount". The real value is then nowhere in the DOM, so copying the cell copies nothing.
import type { Money } from '@shared/domain/types';
import type { MoneySettings } from '@shared/money';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { moneyText } from '../../money-display';
import { useAppStore } from '../../stores/app';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** null shows nothing. */
    value: Money | null;
    settings: MoneySettings;
    /** With the currency symbol. */
    symbol?: boolean;
    /** "+" on positive values. */
    plus?: boolean;
    /** Zero shows nothing. */
    blankZero?: boolean;
  }>(),
  { symbol: false, plus: false, blankZero: false },
);

const { t } = useI18n();
const app = useAppStore();
const masked = computed(
  () => app.privacyMode && props.value !== null && !(props.blankZero && props.value === 0),
);
const text = computed(() =>
  props.value === null
    ? ''
    : moneyText(props.value, props.settings, {
        symbol: props.symbol,
        plus: props.plus,
        blankZero: props.blankZero,
      }),
);
</script>

<template>
  <span v-if="masked" class="money-mask" role="img" :aria-label="t('a11y.hiddenAmount')"
    ><svg viewBox="0 0 40 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M1 4 Q3.5 0 6 4 T11 4 T16 4 T21 4 T26 4 T31 4 T36 4 T39 4" /></svg
  ></span>
  <template v-else>{{ text }}</template>
</template>

<style scoped>
.money-mask {
  display: inline-block;
  width: 3.5em;
  height: 1em;
  vertical-align: middle;
  user-select: none;
}

.money-mask svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.money-mask path {
  vector-effect: non-scaling-stroke;
}
</style>
