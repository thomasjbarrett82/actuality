<script setup lang="ts">
// One rule row's value editor (23 §3.1–3.2): text, a list of texts, a picker, a date (with a Date / Month
// / Year choice for `is`), an amount (signed, with Outflow / Inflow, or a magnitude), two amounts, Yes /
// No, or nothing. It emits patches of the row's value fields.
import type { Id, ISODate, Money } from '@shared/domain/types';
import { X } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBudgetFormat } from '../../queries/budget-data';
import { todayDate } from '../../register/view-state';
import type { DateMode, ValueKind } from '../../rules/form';
import type { AutoCompleteEntry, AutoCompleteFilter } from '../common/autocomplete-list';
import DateField from '../common/DateField.vue';
import MoneyInput from '../common/MoneyInput.vue';
import UiSegmented from '../common/UiSegmented.vue';
import IdPicker from './IdPicker.vue';

export interface ValueFields {
  text: string;
  texts: string[];
  id: Id | null;
  ids: Id[];
  date: string;
  dateMode: DateMode;
  amount: Money;
  amount2: Money;
  bool: boolean;
}

const props = withDefaults(
  defineProps<{
    kind: ValueKind;
    value: Partial<ValueFields>;
    label: string;
    entries?: readonly AutoCompleteEntry[];
    filter?: AutoCompleteFilter | undefined;
    /** A date `is`: Date, Month or Year (23 §1.2). */
    dateModes?: boolean;
    /** Amount (inflow) / (outflow): magnitudes, no Outflow / Inflow choice (23 §1.2). */
    magnitudes?: boolean;
    disabled?: boolean;
    invalid?: boolean;
  }>(),
  {
    entries: () => [],
    dateModes: false,
    magnitudes: false,
    disabled: false,
    invalid: false,
  },
);
const emit = defineEmits<{ patch: [p: Partial<ValueFields>] }>();
const { t } = useI18n();
const format = useBudgetFormat();
const money = computed(() => format.value.money);
const today = todayDate();

const directions = computed(() => [
  { value: 'outflow' as const, label: t('register.columnOutflow') },
  { value: 'inflow' as const, label: t('register.columnInflow') },
]);
const isMagnitude = computed(
  () => props.kind === 'magnitude' || (props.kind === 'between' && props.magnitudes),
);
const directionOf = (m: Money | undefined): 'outflow' | 'inflow' =>
  (m ?? 0) < 0 ? 'outflow' : 'inflow';
const signed = (magnitude: number, d: 'outflow' | 'inflow'): Money =>
  d === 'outflow' ? -Math.abs(magnitude) : Math.abs(magnitude);
const dir1 = ref<'outflow' | 'inflow'>(
  props.value.amount ? directionOf(props.value.amount) : 'outflow',
);
const dir2 = ref<'outflow' | 'inflow'>(
  props.value.amount2 ? directionOf(props.value.amount2) : 'outflow',
);
// The row's field can change under the same editor: a non-zero amount's sign decides the direction.
watch(
  () => [props.value.amount, props.value.amount2] as const,
  ([a, b]) => {
    if (a) dir1.value = directionOf(a);
    if (b) dir2.value = directionOf(b);
  },
);
function setDir(which: 1 | 2, d: 'outflow' | 'inflow'): void {
  if (which === 1) {
    dir1.value = d;
    emit('patch', { amount: signed(props.value.amount ?? 0, d) });
  } else {
    dir2.value = d;
    emit('patch', { amount2: signed(props.value.amount2 ?? 0, d) });
  }
}

const newText = ref('');
function addText(): void {
  const v = newText.value.trim();
  if (v !== '' && !(props.value.texts ?? []).includes(v))
    emit('patch', { texts: [...(props.value.texts ?? []), v] });
  newText.value = '';
}

const mode = computed<DateMode>(() =>
  props.dateModes ? (props.value.dateMode ?? 'date') : 'date',
);
const modeOptions = computed(() => [
  { value: 'date' as const, label: t('app.rulesDateModeDate') },
  { value: 'month' as const, label: t('app.rulesDateModeMonth') },
  { value: 'year' as const, label: t('app.rulesDateModeYear') },
]);
function setMode(m: DateMode): void {
  const d = props.value.date ?? '';
  const date =
    m === 'year' ? d.slice(0, 4) : m === 'month' ? d.slice(0, 7) : d.length === 10 ? d : '';
  emit('patch', { dateMode: m, date });
}
</script>

<template>
  <div class="rule-value" :class="{ 'is-invalid': invalid }">
    <template v-if="kind === 'text'">
      <input
        class="rule-value__input"
        type="text"
        :value="value.text ?? ''"
        :aria-label="label"
        :aria-invalid="invalid"
        :disabled="disabled"
        data-rule-value
        @input="emit('patch', { text: ($event.target as HTMLInputElement).value })"
      />
    </template>

    <template v-else-if="kind === 'texts'">
      <ul v-if="(value.texts ?? []).length > 0" class="rule-value__chips">
        <li v-for="x in value.texts" :key="x" class="rule-value__chip">
          <span>{{ x }}</span>
          <button
            type="button"
            class="rule-value__remove"
            :disabled="disabled"
            :aria-label="`${t('app.rulesRemoveRow')} ${x}`"
            @click="emit('patch', { texts: (value.texts ?? []).filter((y) => y !== x) })"
          >
            <X aria-hidden="true" />
          </button>
        </li>
      </ul>
      <input
        v-model="newText"
        class="rule-value__input"
        type="text"
        :aria-label="label"
        :aria-invalid="invalid"
        :disabled="disabled"
        data-own-enter
        data-rule-value
        @keydown.enter.prevent="addText"
        @blur="addText"
      />
    </template>

    <IdPicker
      v-else-if="kind === 'id' || kind === 'ids'"
      :id="value.id ?? null"
      :ids="value.ids ?? []"
      :entries="entries"
      :label="label"
      :disabled="disabled"
      :multiple="kind === 'ids'"
      v-bind="filter ? { filter } : {}"
      @update:id="(v: Id | null) => emit('patch', { id: v })"
      @update:ids="(v: Id[]) => emit('patch', { ids: v })"
    />

    <template v-else-if="kind === 'date'">
      <select
        v-if="dateModes"
        class="rule-value__input rule-value__mode"
        :value="mode"
        :aria-label="label"
        :disabled="disabled"
        @change="setMode(($event.target as HTMLSelectElement).value as DateMode)"
      >
        <option v-for="o in modeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <span v-if="mode === 'date'" class="rule-value__date" data-own-enter>
        <DateField
          :model-value="value.date && value.date.length === 10 ? (value.date as ISODate) : null"
          :label="label"
          :date-format="format.dateFormat"
          :today="today"
          :disabled="disabled"
          @update:model-value="(v: ISODate | null) => emit('patch', { date: v ?? '' })"
        />
      </span>
      <input
        v-else-if="mode === 'month'"
        class="rule-value__input"
        type="month"
        :value="value.date ?? ''"
        :aria-label="label"
        :aria-invalid="invalid"
        :disabled="disabled"
        @change="emit('patch', { date: ($event.target as HTMLInputElement).value })"
      />
      <input
        v-else
        class="rule-value__input rule-value__year"
        type="number"
        min="1900"
        max="9999"
        :value="value.date ?? ''"
        :aria-label="label"
        :aria-invalid="invalid"
        :disabled="disabled"
        @change="emit('patch', { date: ($event.target as HTMLInputElement).value })"
      />
    </template>

    <template v-else-if="kind === 'money' || kind === 'magnitude' || kind === 'between'">
      <UiSegmented
        v-if="kind === 'money' || (kind === 'between' && !magnitudes)"
        :model-value="dir1"
        :options="directions"
        :label="label"
        :disabled="disabled"
        @update:model-value="(d: 'outflow' | 'inflow') => setDir(1, d)"
      />
      <span class="rule-value__money">
        <MoneyInput
          :model-value="Math.abs(value.amount ?? 0)"
          :label="label"
          :settings="money"
          :disabled="disabled"
          @update:model-value="
            (v: number | null) =>
              emit('patch', {
                amount: isMagnitude ? Math.abs(v ?? 0) : signed(v ?? 0, dir1),
              })
          "
        />
      </span>
      <template v-if="kind === 'between'">
        <span>{{ t('app.schedDlgAnd') }}</span>
        <UiSegmented
          v-if="!magnitudes"
          :model-value="dir2"
          :options="directions"
          :label="label"
          :disabled="disabled"
          @update:model-value="(d: 'outflow' | 'inflow') => setDir(2, d)"
        />
        <span class="rule-value__money">
          <MoneyInput
            :model-value="Math.abs(value.amount2 ?? 0)"
            :label="t('app.schedDlgAmount2')"
            :settings="money"
            :disabled="disabled"
            @update:model-value="
              (v: number | null) =>
                emit('patch', { amount2: magnitudes ? Math.abs(v ?? 0) : signed(v ?? 0, dir2) })
            "
          />
        </span>
      </template>
    </template>

    <select
      v-else-if="kind === 'bool'"
      class="rule-value__input"
      :value="value.bool === false ? 'no' : 'yes'"
      :aria-label="label"
      :disabled="disabled"
      @change="emit('patch', { bool: ($event.target as HTMLSelectElement).value === 'yes' })"
    >
      <option value="yes">{{ t('app.rulesYes') }}</option>
      <option value="no">{{ t('app.rulesNo') }}</option>
    </select>
  </div>
</template>

<style scoped>
.rule-value {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 12rem;
}

.rule-value__input {
  flex: 1;
  min-width: 8rem;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
}

.rule-value.is-invalid .rule-value__input {
  outline: 2px solid var(--status-error);
}

.rule-value__mode {
  flex: none;
  width: 7rem;
}

.rule-value__year {
  flex: none;
  width: 7rem;
}

.rule-value__date,
.rule-value__money {
  flex: none;
  width: 9rem;
}

.rule-value__chips {
  display: flex;
  flex-basis: 100%;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.rule-value__chip {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  padding: 0 var(--space-1) 0 var(--space-2);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--register-gray-bg);
}

.rule-value__remove {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.rule-value__remove svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
