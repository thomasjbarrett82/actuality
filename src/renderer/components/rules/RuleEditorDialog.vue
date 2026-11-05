<script setup lang="ts">
// The rule editor (23 §3): stage, all/any, condition rows, action rows and splits, and the transactions
// the current conditions match, with Apply Actions. It edits a copy: Save writes the rule, Cancel
// discards it. A schedule's rule opens read-only, with Edit Schedule.
import {
  SET_FIELDS,
  SPLIT_SET_FIELDS,
  type RuleAction,
  type RuleMatch,
  type SetField,
} from '@shared/domain/rules';
import type { Id } from '@shared/domain/types';
import { dateShort } from '@shared/format';
import { Info, Minus, Plus } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBudgetFormat } from '../../queries/budget-data';
import { attempt, tell } from '../../register/dialogs';
import { categoryFilter } from '../../register/entries';
import { host } from '../../rpc/host-client';
import {
  actionComplete,
  actionsOf,
  actualField,
  COND_FIELDS,
  conditionComplete,
  conditionOf,
  hasConditionAndAction,
  invalidKeys,
  newAction,
  newCondition,
  newSplit,
  opsFor,
  ruleOf,
  setField,
  splitComplete,
  valueKind,
  type ActKind,
  type ActRow,
  type CondField,
  type CondRow,
  type IdEntity,
  type RuleForm,
  type ValueKind,
} from '../../rules/form';
import { actionLabel, actionText, conditionText, fieldLabel, opLabel } from '../../rules/text';
import { useRuleData } from '../../rules/use-rules';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import MoneyAmount from '../common/MoneyAmount.vue';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';
import UiSegmented from '../common/UiSegmented.vue';
import UiSmallButton from '../common/UiSmallButton.vue';
import RuleValue, { type ValueFields } from './RuleValue.vue';

const props = defineProps<{ form: RuleForm }>();
const emit = defineEmits<{ close: [result: { id: Id } | { scheduleId: Id } | null] }>();
const { t } = useI18n();
const connection = useConnection();
const dialogs = useDialogs();
const format = useBudgetFormat();
const { text, entries } = useRuleData();

// An existing rule's rows keep the conditions and actions they came from, which are reactive objects
// from the query cache: `structuredClone` can't copy a nested proxy, so the copy goes through JSON (rule
// data is JSON from the host).
const f = reactive<RuleForm>(JSON.parse(JSON.stringify(props.form)) as RuleForm);
const isNew = f.id === null;
const readOnly = f.schedule !== null;
const disabled = computed(() => readOnly || !connection.canEdit);
const invalid = ref<Set<number>>(new Set());
const title = readOnly
  ? t('app.rulesScheduleTitle')
  : isNew
    ? t('app.rulesNewTitle')
    : t('app.rulesEditTitle');

const stageOptions = computed(() => [
  { value: 'pre' as const, label: t('app.rulesStagePre') },
  { value: 'default' as const, label: t('app.rulesStageDefault') },
  { value: 'post' as const, label: t('app.rulesStagePost') },
]);
const stage = computed({
  get: () => f.stage ?? ('default' as const),
  set: (v: 'pre' | 'default' | 'post') => (f.stage = v === 'default' ? null : v),
});

// --------------------------------------------------------------------------------- conditions

const fieldOptions = computed(() =>
  COND_FIELDS.map((field) => ({
    value: field,
    label: fieldLabel(
      t,
      actualField(field),
      field === 'amountInflow'
        ? { inflow: true }
        : field === 'amountOutflow'
          ? { outflow: true }
          : undefined,
    ),
  })),
);
const entityOf = (field: string): IdEntity | null =>
  field === 'payee' || field === 'account' || field === 'category' || field === 'category_group'
    ? field
    : null;

function addCondition(): void {
  f.conditions.push(newCondition());
  void nextTick(() => {
    const rows = document.querySelectorAll<HTMLElement>('[data-condition] [data-rule-value]');
    rows[rows.length - 1]?.focus();
  });
}
const patch = (row: object, p: Partial<ValueFields>): void => {
  Object.assign(row, p);
};

// --------------------------------------------------------------------------------- actions

const ACT_KINDS: { kind: ActKind; field?: SetField }[] = [
  ...SET_FIELDS.map((field) => ({ kind: 'set' as const, field })),
  { kind: 'prepend-notes' },
  { kind: 'append-notes' },
  { kind: 'delete-transaction' },
];
const SPLIT_KINDS: { kind: ActKind; field?: SetField }[] = [
  ...SPLIT_SET_FIELDS.map((field) => ({ kind: 'set' as const, field })),
  { kind: 'prepend-notes' },
  { kind: 'append-notes' },
];
const kindValue = (k: { kind: ActKind; field?: SetField }): string =>
  k.kind === 'set' ? `set:${k.field ?? ''}` : k.kind;
const kindOptions = (list: typeof ACT_KINDS): { value: string; label: string }[] =>
  list.map((k) => ({ value: kindValue(k), label: actionLabel(t, k.kind, k.field) }));
const actionOptions = computed(() => kindOptions(ACT_KINDS));
const splitActionOptions = computed(() => kindOptions(SPLIT_KINDS));

function setKind(row: ActRow, value: string): void {
  const [kind, field] = value.split(':') as [ActKind, SetField | undefined];
  Object.assign(row, newAction(kind, field ?? 'notes'), { key: row.key, source: row.source });
}

function actionKind(row: ActRow): ValueKind {
  if (row.kind === 'prepend-notes' || row.kind === 'append-notes') return 'text';
  if (row.kind !== 'set') return 'none';
  if (row.field === 'notes') return 'text';
  if (row.field === 'date') return 'date';
  if (row.field === 'cleared') return 'bool';
  if (row.field === 'amount') return 'money';
  return 'id';
}

function addSplitAction(actions: ActRow[]): void {
  actions.push(newAction('set', 'category'));
}

const methodOptions = computed(() => [
  { value: 'fixed-amount' as const, label: t('app.rulesSplitFixed') },
  { value: 'fixed-percent' as const, label: t('app.rulesSplitPercent') },
  { value: 'remainder' as const, label: t('app.rulesSplitRemainder') },
]);

// --------------------------------------------------------------------------------- read-only rows

const conditionReadOnly = (c: CondRow): string =>
  c.source ? conditionText(text.value, c.source) : '';
const actionReadOnly = (a: ActRow): string => (a.source ? actionText(text.value, a.source) : '');
const sourceText = (a: RuleAction | null): string => (a ? actionText(text.value, a) : '');
const templateOf = (a: ActRow): string | undefined => {
  const o = a.source?.options as { template?: unknown; formula?: unknown } | undefined;
  const v = o?.template ?? o?.formula;
  return typeof v === 'string' ? v : undefined;
};

// --------------------------------------------------------------------------------- matches

const matches = ref<RuleMatch[]>([]);
const more = ref(false);
type MatchState = 'ok' | 'loading' | 'incomplete' | 'unavailable' | 'failed';
const matchState = ref<MatchState>('ok');
const checked = ref<Set<Id>>(new Set());
/** The conditions `matches` were listed for; Apply Actions needs them to be the current ones. */
let matchesKey = '';
let matchTimer: ReturnType<typeof setTimeout> | null = null;
let matchSeq = 0;

const conditionsKey = computed(() =>
  f.conditions.every(conditionComplete)
    ? JSON.stringify({ op: f.conditionsOp, c: f.conditions.map(conditionOf) })
    : '',
);
// Any change to the conditions drops the listed matches and the checked rows at once, and a request
// still in flight is ignored, so Apply Actions never acts on rows the current conditions don't match.
watch(
  conditionsKey,
  (key) => {
    if (matchTimer) clearTimeout(matchTimer);
    matchSeq++;
    matches.value = [];
    more.value = false;
    checked.value = new Set();
    matchesKey = '';
    if (key === '') {
      matchState.value = 'incomplete';
      return;
    }
    matchState.value = 'loading';
    matchTimer = setTimeout(() => void refreshMatches(), 300);
  },
  { immediate: true },
);

async function refreshMatches(): Promise<void> {
  const key = conditionsKey.value;
  if (key === '') return;
  const seq = ++matchSeq;
  try {
    const result = await host.call('rules.matches', {
      conditionsOp: f.conditionsOp,
      conditions: f.conditions.map(conditionOf),
    });
    if (seq !== matchSeq || key !== conditionsKey.value) return;
    matches.value = result?.rows ?? [];
    more.value = result?.more ?? false;
    matchState.value = result === null ? 'unavailable' : 'ok';
    matchesKey = key;
    const ids = new Set(matches.value.map((m) => m.id));
    checked.value = new Set([...checked.value].filter((x) => ids.has(x)));
  } catch {
    if (seq !== matchSeq) return;
    matches.value = [];
    matchState.value = 'failed';
  }
}

const payeeName = (id: Id | null): string => (id ? (text.value.payee(id) ?? '') : '');
const categoryName = (id: Id | null): string => (id ? (text.value.category(id) ?? '') : '');
const allChecked = computed(
  () => matches.value.length > 0 && matches.value.every((m) => checked.value.has(m.id)),
);
function toggleAll(): void {
  checked.value = allChecked.value ? new Set() : new Set(matches.value.map((m) => m.id));
}
function toggle(id: Id): void {
  const next = new Set(checked.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  checked.value = next;
}

const actionsReady = computed(
  () =>
    (f.actions.length > 0 || f.splits.length > 0) &&
    f.actions.every(actionComplete) &&
    f.splits.every((s) => splitComplete(s) && s.actions.every(actionComplete)),
);

const matchesCurrent = (): boolean =>
  matchState.value === 'ok' && matchesKey !== '' && matchesKey === conditionsKey.value;

async function applyActions(): Promise<void> {
  const ids = matches.value.filter((m) => checked.value.has(m.id)).map((m) => m.id);
  if (ids.length === 0 || !actionsReady.value || !matchesCurrent()) return;
  const { button } = await dialogs.showTaskDialog({
    instruction: t('app.rulesApplyConfirm', { n: ids.length }, ids.length),
    content: t('app.rulesApplyContent'),
    icon: 'warning',
    buttons: [{ id: 'apply', label: t('app.rulesApply'), isDefault: true }, 'cancel'],
  });
  if (button !== 'apply' || !matchesCurrent()) return;
  const result = await attempt(() =>
    host.call('rules.applyActions', { ids, actions: actionsOf(f) }),
  );
  if (result.ok) {
    checked.value = new Set();
    await refreshMatches();
  }
}

// --------------------------------------------------------------------------------- save

const busy = ref(false);
async function save(): Promise<void> {
  if (disabled.value || busy.value) return;
  const bad = invalidKeys(f);
  invalid.value = bad;
  if (bad.size > 0 || !hasConditionAndAction(f)) {
    await tell(t('app.rulesIncompleteTitle'), t('app.rulesIncompleteMessage'));
    return;
  }
  busy.value = true;
  const result = await attempt(() => host.call('rules.save', ruleOf(f)));
  busy.value = false;
  if (result.ok) emit('close', result.value);
}

function submit(): void {
  if (readOnly) emit('close', null);
  else void save();
}

onBeforeUnmount(() => {
  if (matchTimer) clearTimeout(matchTimer);
});
</script>

<template>
  <StandardDialog :title="title" width="xl" @cancel="emit('close', null)" @submit="submit">
    <div class="re" data-rule-editor>
      <div class="re__row">
        <span class="re__label">{{ t('app.rulesStage') }}</span>
        <UiSegmented
          v-model="stage"
          :options="stageOptions"
          :label="t('app.rulesStage')"
          :disabled="disabled"
        />
        <Info
          v-tooltip="t('app.rulesStageInfo')"
          class="re__info"
          :aria-label="t('app.rulesStageInfo')"
        />
      </div>

      <fieldset class="re__group">
        <legend class="re__row re__legend">
          <span>{{ t('app.rulesConditionsBefore') }}</span>
          <select
            v-model="f.conditionsOp"
            class="re__input re__narrow"
            :aria-label="`${t('app.rulesConditionsBefore')} … ${t('app.rulesConditionsAfter')}`"
            :disabled="disabled"
            data-field="conditionsOp"
          >
            <option value="and">{{ t('app.rulesAll') }}</option>
            <option value="or">{{ t('app.rulesAny') }}</option>
          </select>
          <span>{{ t('app.rulesConditionsAfter') }}</span>
        </legend>
        <div
          v-for="(c, i) in f.conditions"
          :key="c.key"
          class="re__line"
          :class="{ 'is-invalid': invalid.has(c.key) }"
          data-condition
          :aria-invalid="invalid.has(c.key) || undefined"
        >
          <template v-if="c.field === null">
            <span v-tooltip="t('app.rulesReadOnlyTooltip')" class="re__readonly">{{
              conditionReadOnly(c)
            }}</span>
          </template>
          <template v-else>
            <select
              class="re__input re__field"
              :value="c.field"
              :aria-label="t('app.rulesFieldHeader', { index: i + 1 })"
              :disabled="disabled"
              data-field="field"
              @change="setField(c, ($event.target as HTMLSelectElement).value as CondField)"
            >
              <option v-for="o in fieldOptions" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
            <select
              v-model="c.op"
              class="re__input re__op"
              :aria-label="t('app.rulesOpHeader', { index: i + 1 })"
              :disabled="disabled"
              data-field="op"
            >
              <option v-for="op in opsFor(c.field)" :key="op" :value="op">
                {{ opLabel(t, op, actualField(c.field)) }}
              </option>
            </select>
            <RuleValue
              :kind="valueKind(c.field, c.op)"
              :value="c"
              :label="fieldLabel(t, actualField(c.field))"
              :entries="entries[entityOf(actualField(c.field)) ?? 'payee']"
              v-bind="actualField(c.field) === 'category' ? { filter: categoryFilter } : {}"
              :date-modes="c.op === 'is'"
              :magnitudes="c.field === 'amountInflow' || c.field === 'amountOutflow'"
              :disabled="disabled"
              :invalid="invalid.has(c.key)"
              @patch="(p) => patch(c, p)"
            />
          </template>
          <button
            type="button"
            class="re__icon"
            :disabled="disabled"
            :aria-label="t('app.rulesRemoveRow')"
            @click="f.conditions.splice(i, 1)"
          >
            <Minus aria-hidden="true" />
          </button>
        </div>
        <div class="re__row">
          <UiSmallButton :disabled="disabled" @click="addCondition">
            <Plus class="re__small-icon" aria-hidden="true" />{{ t('app.rulesAddCondition') }}
          </UiSmallButton>
        </div>
      </fieldset>

      <fieldset class="re__group">
        <legend class="re__legend">{{ t('app.rulesThen') }}</legend>
        <template v-for="(a, i) in f.actions" :key="a.key">
          <div
            class="re__line"
            :class="{ 'is-invalid': invalid.has(a.key) }"
            data-action
            :aria-invalid="invalid.has(a.key) || undefined"
          >
            <span
              v-if="a.kind === null"
              v-tooltip="templateOf(a) ?? t('app.rulesReadOnlyTooltip')"
              class="re__readonly"
              >{{ actionReadOnly(a) }}</span
            >
            <template v-else>
              <select
                class="re__input re__field"
                :value="kindValue({ kind: a.kind, field: a.field })"
                :aria-label="t('app.rulesActionHeader', { index: i + 1 })"
                :disabled="disabled"
                data-field="action"
                @change="setKind(a, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="o in actionOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
              <RuleValue
                :kind="actionKind(a)"
                :value="a"
                :label="actionLabel(t, a.kind, a.field)"
                :entries="entries[entityOf(a.field) ?? 'payee']"
                v-bind="a.field === 'category' ? { filter: categoryFilter } : {}"
                :disabled="disabled"
                :invalid="invalid.has(a.key)"
                @patch="(p) => patch(a, p)"
              />
            </template>
            <button
              type="button"
              class="re__icon"
              :disabled="disabled"
              :aria-label="t('app.rulesRemoveRow')"
              @click="f.actions.splice(i, 1)"
            >
              <Minus aria-hidden="true" />
            </button>
          </div>
          <p v-if="a.kind === 'set' && a.field === 'notes'" class="re__hint">
            {{ t('app.rulesNotesCaution') }}
          </p>
        </template>
        <div class="re__row">
          <UiSmallButton :disabled="disabled" @click="f.actions.push(newAction())">
            <Plus class="re__small-icon" aria-hidden="true" />{{ t('app.rulesAddAction') }}
          </UiSmallButton>
          <UiSmallButton :disabled="disabled" @click="f.splits.push(newSplit())">
            <Plus class="re__small-icon" aria-hidden="true" />{{ t('app.rulesAddSplit') }}
          </UiSmallButton>
        </div>

        <section
          v-for="(s, si) in f.splits"
          :key="s.key"
          class="re__split"
          :class="{ 'is-invalid': invalid.has(s.key) }"
          data-split
        >
          <div class="re__row">
            <h3 class="re__split-title">{{ t('app.rulesSplitTitle', { index: si + 1 }) }}</h3>
            <span
              v-if="s.method === null"
              v-tooltip="t('app.rulesReadOnlyTooltip')"
              class="re__readonly"
              >{{ sourceText(s.source) }}</span
            >
            <template v-else>
              <select
                v-model="s.method"
                class="re__input re__field"
                :aria-label="t('app.rulesSplitMethod')"
                :disabled="disabled"
                data-field="method"
              >
                <option v-for="o in methodOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
              <RuleValue
                v-if="s.method === 'fixed-amount'"
                kind="money"
                :value="s"
                :label="t('app.rulesSplitFixed')"
                :disabled="disabled"
                @patch="(p) => patch(s, p)"
              />
              <span v-else-if="s.method === 'fixed-percent'" class="re__percent">
                <input
                  v-model.number="s.percent"
                  class="re__input"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  :aria-label="t('app.rulesSplitPercent')"
                  :aria-invalid="invalid.has(s.key) || undefined"
                  :disabled="disabled"
                />{{ t('app.rulesPercentSuffix') }}
              </span>
            </template>
            <span class="re__spacer" />
            <UiSmallButton :disabled="disabled" @click="f.splits.splice(si, 1)">{{
              t('app.rulesRemoveSplit')
            }}</UiSmallButton>
          </div>
          <div
            v-for="(a, i) in s.actions"
            :key="a.key"
            class="re__line"
            :class="{ 'is-invalid': invalid.has(a.key) }"
            data-split-action
          >
            <span
              v-if="a.kind === null"
              v-tooltip="templateOf(a) ?? t('app.rulesReadOnlyTooltip')"
              class="re__readonly"
              >{{ actionReadOnly(a) }}</span
            >
            <template v-else>
              <select
                class="re__input re__field"
                :value="kindValue({ kind: a.kind, field: a.field })"
                :aria-label="t('app.rulesActionHeader', { index: i + 1 })"
                :disabled="disabled"
                @change="setKind(a, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="o in splitActionOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
              <RuleValue
                :kind="actionKind(a)"
                :value="a"
                :label="actionLabel(t, a.kind, a.field)"
                :entries="entries[entityOf(a.field) ?? 'payee']"
                v-bind="a.field === 'category' ? { filter: categoryFilter } : {}"
                :disabled="disabled"
                :invalid="invalid.has(a.key)"
                @patch="(p) => patch(a, p)"
              />
            </template>
            <button
              type="button"
              class="re__icon"
              :disabled="disabled"
              :aria-label="t('app.rulesRemoveRow')"
              @click="s.actions.splice(i, 1)"
            >
              <Minus aria-hidden="true" />
            </button>
          </div>
          <div class="re__row">
            <UiSmallButton :disabled="disabled" @click="addSplitAction(s.actions)">
              <Plus class="re__small-icon" aria-hidden="true" />{{ t('app.rulesAddAction') }}
            </UiSmallButton>
          </div>
        </section>
      </fieldset>

      <section class="re__matches" data-section="matches">
        <div class="re__row">
          <h3 class="re__split-title">{{ t('app.rulesMatching') }}</h3>
          <span class="re__spacer" />
          <UiSmallButton
            v-if="!readOnly"
            :disabled="
              !connection.canEdit || checked.size === 0 || !actionsReady || matchState !== 'ok'
            "
            @click="applyActions"
            >{{ t('app.rulesApply') }}</UiSmallButton
          >
        </div>
        <div class="re__table" role="table" :aria-label="t('app.rulesMatching')">
          <div class="re__trow re__trow--head" role="row">
            <span role="columnheader">
              <input
                type="checkbox"
                :checked="allChecked"
                :disabled="matches.length === 0"
                :aria-label="t('app.rulesSelectAll')"
                @change="toggleAll"
              />
            </span>
            <span role="columnheader">{{ t('register.columnDate') }}</span>
            <span role="columnheader">{{ t('app.regAccountHeader') }}</span>
            <span role="columnheader">{{ t('register.columnPayee') }}</span>
            <span role="columnheader">{{ t('register.columnCategory') }}</span>
            <span role="columnheader">{{ t('register.columnNotes') }}</span>
            <span role="columnheader" class="re__num">{{ t('app.schedDlgAmount') }}</span>
          </div>
          <div v-for="m in matches" :key="m.id" class="re__trow" role="row" :data-match-id="m.id">
            <span role="cell">
              <input
                type="checkbox"
                :checked="checked.has(m.id)"
                :aria-label="t('a11y.selectTransaction')"
                @change="toggle(m.id)"
              />
            </span>
            <span role="cell">{{ dateShort(m.date, format.dateFormat) }}</span>
            <span role="cell" class="re__text">{{ text.account(m.accountId) ?? '' }}</span>
            <span role="cell" class="re__text">{{ payeeName(m.payeeId) }}</span>
            <span role="cell" class="re__text">{{ categoryName(m.categoryId) }}</span>
            <span role="cell" class="re__text">{{ m.notes }}</span>
            <span role="cell" class="re__num"
              ><MoneyAmount :value="m.amount" :settings="format.money"
            /></span>
          </div>
        </div>
        <p v-if="matchState === 'failed'" class="re__empty" role="alert">
          {{ t('app.rulesMatchesFailed') }}
        </p>
        <p
          v-else-if="matchState !== 'loading' && (matchState !== 'ok' || matches.length === 0)"
          class="re__empty"
          role="status"
        >
          {{
            matchState === 'incomplete'
              ? t('app.rulesMatchesIncomplete')
              : matchState === 'unavailable'
                ? t('app.rulesMatchesUnavailable')
                : t('app.rulesMatchesNone')
          }}
        </p>
        <p v-if="more" class="re__hint">{{ t('app.rulesMatchesMore') }}</p>
      </section>
    </div>
    <template #footer>
      <template v-if="readOnly">
        <UiButton v-if="f.schedule" @click="emit('close', { scheduleId: f.schedule.id })">{{
          t('app.rulesEditSchedule')
        }}</UiButton>
        <UiButton primary @click="emit('close', null)">{{ t('app.rulesClose') }}</UiButton>
      </template>
      <template v-else>
        <UiButton @click="emit('close', null)">{{ t('taskDialog.CancelLabel') }}</UiButton>
        <UiButton primary :disabled="disabled || busy" @click="save">{{
          t('app.editSave')
        }}</UiButton>
      </template>
    </template>
  </StandardDialog>
</template>

<style scoped>
.re {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.re__row,
.re__line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.re__line {
  padding: var(--space-1);
  border-radius: var(--radius-sm);
}

.re__line.is-invalid,
.re__split.is-invalid {
  outline: 2px solid var(--status-error);
}

.re__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--register-border);
}

.re__legend {
  padding: 0 var(--space-1);
  font-weight: 600;
}

.re__label {
  font-weight: 600;
}

.re__input {
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
}

.re__narrow {
  width: 6rem;
}

.re__field {
  width: 11rem;
}

.re__op {
  width: 13rem;
}

.re__percent {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  width: 7rem;
}

.re__readonly {
  flex: 1;
  color: var(--text-muted);
  font-style: italic;
}

.re__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 1px solid var(--register-border);
  border-radius: 50%;
  background: var(--button-bg);
  color: var(--text);
  cursor: pointer;
}

.re__small-icon,
.re__info {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.re__info {
  color: var(--text-muted);
}

.re__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.re__split {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--register-border);
}

.re__split-title {
  margin: 0;
  font-size: var(--font-md);
}

.re__spacer {
  flex: 1;
}

.re__table {
  max-height: 14rem;
  overflow: auto;
  border: 1px solid var(--register-border);
}

.re__trow {
  display: grid;
  grid-template-columns: 2rem 6rem 8rem minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 7rem;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-2);
}

.re__trow--head {
  position: sticky;
  top: 0;
  background: var(--register-gray-bg);
  font-weight: 600;
}

.re__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.re__num {
  text-align: right;
}

.re__empty {
  margin: 0;
  padding: var(--space-3);
  color: var(--text-subtle);
}
</style>
