<script setup lang="ts">
// The Schedule dialog (12 §3.1): name, payee, account; the amount with its operator; category or split
// lines, and notes; the date (Once, or a recurrence with presets, interval, specific days, end and weekend
// move, and Actual's upcoming dates); "Automatically add transaction"; and the linked and matching
// transactions. It edits a copy: Save writes everything in one job, Cancel discards it.
import { categoryIndex, categoryLabel } from '@shared/domain/categories';
import { ENGLISH_TRANSFER_PREFIX } from '@shared/domain/payees';
import { remainingOf } from '@shared/domain/splits';
import type { Id, ISODate, RecurConfig, ScheduleMatch } from '@shared/domain/types';
import { dateShort } from '@shared/format';
import { FREQUENCIES, presetOf, withPreset, type Preset } from '@shared/schedule/frequency';
import { Plus, Trash2 } from 'lucide-vue-next';
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  toRaw,
  useId,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { announce } from '../../a11y/announcer';
import { useAccounts, useBudgetFormat, useCategories, usePayees } from '../../queries/budget-data';
import { applySplitRules, initialLines, reportWriteError } from '../../register/commit';
import { showOffline, tell } from '../../register/dialogs';
import {
  emptyLine,
  resolveCategory,
  resolvePayee,
  type EditLine,
  type NewCategory,
} from '../../register/editable';
import {
  ADD_CATEGORY_ITEM,
  categoryEntries,
  categoryFilter,
  payeeEntries,
  payeeFilter,
} from '../../register/entries';
import { frequencyLabel, weekdayName } from '../../register/frequency-text';
import { transferKindOf } from '../../register/rows';
import {
  amountsOf,
  dateOf,
  matchQueryOf,
  toEdit,
  type ScheduleForm,
} from '../../register/schedule-form';
import { todayDate } from '../../register/view-state';
import { errorInfo } from '../../rpc/errors';
import { host } from '../../rpc/host-client';
import { useConnection } from '../../stores/connection';
import { useModals } from '../../stores/modals';
import type { AutoCompleteItem } from '../common/autocomplete-list';
import AutoComplete, { type CommitReason } from '../common/AutoComplete.vue';
import DateField from '../common/DateField.vue';
import type { AutoCompleteApi } from '../common/exposed';
import MoneyAmount from '../common/MoneyAmount.vue';
import MoneyInput from '../common/MoneyInput.vue';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';
import UiSegmented from '../common/UiSegmented.vue';
import UiSmallButton from '../common/UiSmallButton.vue';
import AddCategoryDialog from './AddCategoryDialog.vue';
import NotesField from './NotesField.vue';

const props = defineProps<{
  form: ScheduleForm;
  /** Schedule a transfer: the payee list opens with `Transfer:` typed. */
  transfer?: boolean;
  /** Move to scheduler… (12 §4): the transaction the save deletes. */
  moveFrom?: Id | null;
}>();
const emit = defineEmits<{ close: [result: { id: Id } | null] }>();
const { t } = useI18n();
const id = useId();
const connection = useConnection();
const modals = useModals();
const accountsQ = useAccounts();
const categoriesQ = useCategories();
const payeesQ = usePayees();
const format = useBudgetFormat();
const today = todayDate();

const f = reactive<ScheduleForm>(structuredClone(toRaw(props.form)));
const d = computed(() => f.tx);
const isNew = f.id === null;

const accounts = computed(() => accountsQ.data.value ?? []);
const accountMap = computed(() => new Map(accounts.value.map((a) => [a.id, a])));
const groups = computed(() => categoriesQ.data.value ?? []);
const payees = computed(() => payeesQ.data.value ?? []);
const categories = computed(() => categoryIndex(groups.value));
const categoryText = (cid: Id | null): string => {
  const found = cid ? categories.value.get(cid) : undefined;
  return found ? categoryLabel(found.group, found.category) : '';
};
const money = computed(() => format.value.money);
const prefixes = computed(() => [t('app.transferPrefix'), ENGLISH_TRANSFER_PREFIX]);
const texts = computed(() => ({
  heading: t('app.editTransferHeading'),
  transfer: (name: string) => t('app.transferPayee', { account: name }),
}));

const own = computed(() => accountMap.value.get(d.value.accountId));
const onBudget = computed(() => own.value?.onBudget !== false);
const transferAccount = computed(() =>
  d.value.transferAccountId ? accountMap.value.get(d.value.transferAccountId) : undefined,
);
const onOnTransfer = computed(() => transferKindOf(own.value, transferAccount.value) === 'onOn');
const categoryDisabled = computed(() => !onBudget.value || onOnTransfer.value);

/** Work a field commit started (a refusal, Add New Category): Save waits for it. */
let fieldWork: Promise<boolean> = Promise.resolve(true);
function work(fn: () => Promise<boolean>): void {
  const before = fieldWork;
  fieldWork = before.then(async (ok) => (await fn()) && ok);
}

// --------------------------------------------------------------------------------- account & payee

/** The open accounts, and an existing schedule's own account if it was closed since. */
const accountOptions = computed(() =>
  accounts.value.filter((a) => !a.closed || a.id === props.form.tx.accountId),
);

const payeeAc = ref<AutoCompleteApi | null>(null);
const categoryAc = ref<AutoCompleteApi | null>(null);
const payeeList = computed(() =>
  payeeEntries(payees.value, accounts.value, d.value.accountId, texts.value),
);
const payeeMatcher = computed(() => payeeFilter(t('app.transferPrefix')));

async function refusePayee(title: string, message: string, previous: string): Promise<boolean> {
  await tell(title, message);
  d.value.payeeText = previous;
  payeeAc.value?.reset();
  void nextTick(() => payeeAc.value?.focus());
  return false;
}

function onPayeeCommit(value: string): void {
  const previous = d.value.payeeText;
  const tx = d.value;
  const res = resolvePayee(value, prefixes.value, payees.value, accounts.value);
  work(async () => {
    if (res.kind === 'invalidTransfer')
      return refusePayee(
        t('app.editInvalidPayeeTitle'),
        t('app.editInvalidTransferMessage', { name: res.name }),
        previous,
      );
    if (res.kind === 'transfer') {
      if (tx.split)
        return refusePayee(
          t('app.editSplitNoTransferTitle'),
          t('app.editSplitNoTransferMessage'),
          previous,
        );
      if (res.account.id === tx.accountId)
        return refusePayee(
          t('app.editTransferSelfTitle'),
          t('app.editTransferSelfMessage'),
          previous,
        );
      tx.transferAccountId = res.account.id;
      tx.payeeText = texts.value.transfer(res.account.name);
      tx.payeeId = null;
      if (transferKindOf(own.value, res.account) === 'onOn') {
        tx.categoryId = null;
        tx.categoryText = '';
      }
    } else if (res.kind === 'payee') {
      tx.transferAccountId = null;
      tx.payeeText = res.name;
      tx.payeeId = res.payee?.id ?? null;
    } else {
      tx.transferAccountId = null;
      tx.payeeText = '';
      tx.payeeId = null;
    }
    return true;
  });
}

// --------------------------------------------------------------------------------- category & split

const categoryList = computed(() =>
  categoryEntries(groups.value, { split: t('register.splitCategoryOption') }),
);
const lineCategoryList = computed(() =>
  categoryEntries(groups.value, { addNew: t('register.addNewCategory') }),
);
const linePayeeList = computed(() =>
  payeeEntries(payees.value, accounts.value, d.value.accountId, texts.value, true),
);

async function applyCategory(
  value: string,
  item: AutoCompleteItem | null,
  line: EditLine | null,
  ac: AutoCompleteApi | null,
): Promise<boolean> {
  const tx = d.value;
  const target = line ?? tx;
  const previous = target.categoryText;
  const keep = (): false => {
    target.categoryText = previous;
    ac?.reset();
    void nextTick(() => ac?.focus());
    return false;
  };
  if (item?.id === ADD_CATEGORY_ITEM) return addCategory(target, '', '', ac, previous);
  const res = resolveCategory(value, t('register.splitCategoryOption'), groups.value);
  switch (res.kind) {
    case 'none':
      target.categoryId = null;
      target.categoryText = '';
      return true;
    case 'split':
      if (line) return keep();
      if (tx.transferAccountId) {
        await tell(t('app.editCannotSplitTitle'), t('app.editCannotSplitMessage'));
        return keep();
      }
      tx.split = true;
      tx.categoryId = null;
      tx.categoryText = '';
      if (tx.lines.length === 0) tx.lines = initialLines();
      return true;
    case 'category':
      target.categoryId = res.id;
      target.categoryText = res.text;
      return true;
    case 'new':
      if (res.isIncomeGroup || res.groupName.trim().toLocaleLowerCase() === 'income') {
        await tell(t('app.categoryNameDifferent'), t('app.categoryIncomeGroup'));
        return keep();
      }
      return addCategory(target, res.groupName, res.name, ac, previous);
  }
}

async function addCategory(
  target: { categoryId: Id | null; categoryText: string },
  groupName: string,
  name: string,
  ac: AutoCompleteApi | null,
  previous: string,
): Promise<boolean> {
  const created = await modals.open<NewCategory>(AddCategoryDialog, {
    groups: groups.value,
    groupName,
    name,
  });
  if (!created) {
    target.categoryText = previous;
    ac?.reset();
    void nextTick(() => ac?.focus());
    return false;
  }
  target.categoryId = created.id;
  target.categoryText = created.text;
  return true;
}

function onCategoryCommit(value: string, item: AutoCompleteItem | null): void {
  work(() => applyCategory(value, item, null, categoryAc.value));
}

const lineRefs = new Map<string, { category?: AutoCompleteApi | null }>();
function lineRef(key: string, el: unknown): void {
  lineRefs.set(key, { category: el as AutoCompleteApi | null });
}

function onLinePayeeCommit(line: EditLine, value: string): void {
  const previous = line.payeeText;
  const res = resolvePayee(value, prefixes.value, payees.value, accounts.value);
  work(async () => {
    if (res.kind === 'invalidTransfer') {
      await tell(
        t('app.editInvalidPayeeTitle'),
        t('app.editInvalidTransferMessage', { name: res.name }),
      );
      line.payeeText = previous;
      return false;
    }
    if (res.kind === 'transfer') {
      if (res.account.id === d.value.accountId) {
        await tell(t('app.editTransferSelfTitle'), t('app.editTransferSelfMessage'));
        line.payeeText = previous;
        return false;
      }
      line.transferAccountId = res.account.id;
      line.payeeText = texts.value.transfer(res.account.name);
      if (transferKindOf(own.value, res.account) === 'onOn') {
        line.categoryId = null;
        line.categoryText = '';
      }
    } else {
      // Only transfers mean anything on a line (11 §7.1).
      line.transferAccountId = null;
      line.payeeText = '';
    }
    return true;
  });
}

function onLineCategoryCommit(line: EditLine, value: string, item: AutoCompleteItem | null): void {
  work(() => applyCategory(value, item, line, lineRefs.get(line.key)?.category ?? null));
}

const lineOnOn = (line: EditLine): boolean =>
  transferKindOf(
    own.value,
    line.transferAccountId ? accountMap.value.get(line.transferAccountId) : undefined,
  ) === 'onOn';

function setLineAmount(line: EditLine, v: number | null, sign: 1 | -1): void {
  line.amount = sign * (v ?? 0);
}
const remaining = computed(() => remainingOf(amountsOf(f).amount, d.value.lines));

// --------------------------------------------------------------------------------- amount

const opOptions = computed(() => [
  { value: 'is' as const, label: t('app.schedDlgOpIs') },
  { value: 'isapprox' as const, label: t('app.schedDlgOpApprox') },
  { value: 'isbetween' as const, label: t('app.schedDlgOpBetween') },
]);
const directionOptions = computed(() => [
  { value: 'outflow' as const, label: t('register.columnOutflow') },
  { value: 'inflow' as const, label: t('register.columnInflow') },
]);
const direction = computed({
  get: () => (f.outflow ? ('outflow' as const) : ('inflow' as const)),
  set: (v: 'outflow' | 'inflow') => (f.outflow = v === 'outflow'),
});

// --------------------------------------------------------------------------------- date

const presetOptions = computed(() => [
  ...(presetOf(f.config) === 'custom'
    ? [{ value: 'custom', label: frequencyLabel('custom') }]
    : []),
  ...FREQUENCIES.filter((x): x is Preset => x !== 'Once').map((x) => ({
    value: x,
    label: frequencyLabel(x),
  })),
]);
const preset = computed(() => presetOf(f.config));
function onPreset(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as Preset | 'custom';
  if (value !== 'custom') f.config = withPreset(value, f.config);
}

function onRepeats(on: boolean): void {
  if (on) f.config = { ...f.config, start: f.once };
  else f.once = f.config.start >= today ? f.config.start : today;
  f.repeats = on;
}

const UNITS: RecurConfig['frequency'][] = ['daily', 'weekly', 'monthly', 'yearly'];
const UNIT_KEYS: Record<RecurConfig['frequency'], string> = {
  daily: 'app.schedDlgUnitDay',
  weekly: 'app.schedDlgUnitWeek',
  monthly: 'app.schedDlgUnitMonth',
  yearly: 'app.schedDlgUnitYear',
};
function onUnit(e: Event): void {
  const unit = (e.target as HTMLSelectElement).value as RecurConfig['frequency'];
  const next: RecurConfig = { ...f.config, frequency: unit };
  // Specific days are monthly only (12 §3.1).
  if (unit !== 'monthly') delete next.patterns;
  f.config = next;
}

const clampCount = (v: string): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 999) : 1;
};
function onInterval(e: Event): void {
  const el = e.target as HTMLInputElement;
  f.config.interval = clampCount(el.value);
  el.value = String(f.config.interval);
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const patternTypes = computed(() => [
  { value: 'day', label: t('app.schedDlgDayOfMonth') },
  ...WEEKDAYS.map((w) => ({ value: w, label: weekdayName(w) })),
]);
const NTH_KEYS = ['app.freqNth1', 'app.freqNth2', 'app.freqNth3', 'app.freqNth4', 'app.freqNth5'];
function patternValues(type: string): { value: number; label: string }[] {
  const last = { value: -1, label: t('app.schedDlgLast') };
  if (type === 'day')
    return [
      ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
      last,
    ];
  return [...NTH_KEYS.map((k, i) => ({ value: i + 1, label: t(k) })), last];
}
const patterns = computed(() => f.config.patterns ?? []);
function addPattern(): void {
  const day = Number(f.config.start.slice(8, 10));
  f.config.patterns = [...patterns.value, { type: 'day', value: day }];
}
function setPatternType(i: number, type: string): void {
  const list = [...patterns.value];
  const p = list[i];
  if (!p) return;
  list[i] = { ...p, type, value: type !== 'day' && p.value > 5 ? 1 : p.value };
  f.config.patterns = list;
}
function setPatternValue(i: number, value: number): void {
  const list = [...patterns.value];
  const p = list[i];
  if (p) list[i] = { ...p, value };
  f.config.patterns = list;
}
function removePattern(i: number): void {
  const list = patterns.value.filter((_, k) => k !== i);
  if (list.length > 0) f.config.patterns = list;
  else delete f.config.patterns;
}
/** Actual skips months without the day (12 §3.1). */
const lateDayHint = computed(
  () =>
    f.config.frequency === 'monthly' &&
    (patterns.value.length > 0
      ? patterns.value.some((p) => p.type === 'day' && p.value >= 29)
      : Number(f.config.start.slice(8, 10)) >= 29),
);

const endMode = computed({
  get: () => f.config.endMode ?? 'never',
  set: (mode: NonNullable<RecurConfig['endMode']>) => {
    f.config.endMode = mode;
    if (mode === 'after_n_occurrences' && f.config.endOccurrences === undefined)
      f.config.endOccurrences = 1;
    if (mode === 'on_date' && f.config.endDate === undefined) f.config.endDate = f.config.start;
  },
});
function onOccurrences(e: Event): void {
  const el = e.target as HTMLInputElement;
  f.config.endOccurrences = clampCount(el.value);
  el.value = String(f.config.endOccurrences);
}
const skipWeekend = computed({
  get: () => f.config.skipWeekend === true,
  set: (on: boolean) => {
    f.config.skipWeekend = on;
    if (on && f.config.weekendSolveMode === undefined) f.config.weekendSolveMode = 'after';
  },
});

// Upcoming dates (12 §3.1): Actual's next five, 300 ms after the date fields change.
const upcoming = ref<ISODate[] | null>(null);
const previewAvailable = ref(true);
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewSeq = 0;
watch(
  () => JSON.stringify(dateOf(f)),
  () => {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshPreview(), 300);
  },
);
async function refreshPreview(): Promise<void> {
  const seq = ++previewSeq;
  try {
    const dates = await host.call('schedules.preview', { date: dateOf(f), count: 5 });
    if (seq === previewSeq) upcoming.value = dates;
  } catch (e) {
    if (seq !== previewSeq) return;
    if (errorInfo(e).detail === 'internal-handler-unavailable') previewAvailable.value = false;
    upcoming.value = null;
  }
}

// --------------------------------------------------------------------------------- transactions

type Tab = 'linked' | 'find';
const tab = ref<Tab>(isNew ? 'find' : 'linked');
const tabOptions = computed(() => [
  { value: 'linked' as const, label: t('app.schedDlgLinked') },
  { value: 'find' as const, label: t('app.schedDlgFind') },
]);
const linked = ref<ScheduleMatch[]>([]);
const link = ref(new Set<Id>());
const unlink = ref(new Set<Id>());
const matches = ref<ScheduleMatch[] | null>([]);
// A failed load says so instead of reading as an empty list (12 §3.1).
const linkedFailed = ref(false);
const matchesFailed = ref(false);
const checked = ref(new Set<Id>());
watch(tab, (next) => {
  checked.value = new Set();
  if (next === 'linked' && linkedFailed.value) void loadLinked();
});

async function loadLinked(): Promise<void> {
  if (!f.id) return;
  try {
    const rows = await host.call('schedules.linked', { id: f.id });
    const taken = new Set(rows.map((m) => m.id));
    const pending = linked.value.filter((m) => link.value.has(m.id) && !taken.has(m.id));
    linked.value = [...rows.filter((m) => !unlink.value.has(m.id)), ...pending].sort(byDateDesc);
    linkedFailed.value = false;
  } catch {
    linkedFailed.value = true;
  }
}

const byDateDesc = (a: ScheduleMatch, b: ScheduleMatch): number =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
const shownRows = computed(() => {
  if (tab.value === 'linked') return linked.value;
  const taken = new Set(linked.value.map((m) => m.id));
  return (matches.value ?? []).filter((m) => !taken.has(m.id));
});
const tableFailed = computed(() =>
  tab.value === 'linked' ? linkedFailed.value : matchesFailed.value,
);

let matchTimer: ReturnType<typeof setTimeout> | null = null;
let matchSeq = 0;
watch(
  () => (tab.value === 'find' ? JSON.stringify(matchQueryOf(f, payees.value)) : ''),
  (key) => {
    if (matchTimer) clearTimeout(matchTimer);
    if (key) matchTimer = setTimeout(() => void refreshMatches(), 300);
  },
  { immediate: true },
);
async function refreshMatches(): Promise<void> {
  const seq = ++matchSeq;
  try {
    const rows = await host.call('schedules.matches', matchQueryOf(f, payees.value));
    if (seq !== matchSeq) return;
    matches.value = rows;
    matchesFailed.value = false;
  } catch {
    if (seq !== matchSeq) return;
    matches.value = [];
    matchesFailed.value = true;
  }
}

function toggleChecked(mid: Id): void {
  const next = new Set(checked.value);
  if (next.has(mid)) next.delete(mid);
  else next.add(mid);
  checked.value = next;
}

/** Link to schedule: the checked matches move to the Linked list; Save writes them (12 §3.1). */
function linkChecked(): void {
  const rows = shownRows.value.filter((m) => checked.value.has(m.id));
  for (const m of rows) {
    if (unlink.value.has(m.id)) unlink.value.delete(m.id);
    else link.value.add(m.id);
  }
  linked.value = [...linked.value, ...rows].sort(byDateDesc);
  checked.value = new Set();
}
function unlinkChecked(): void {
  for (const mid of checked.value) {
    if (link.value.has(mid)) link.value.delete(mid);
    else unlink.value.add(mid);
  }
  linked.value = linked.value.filter((m) => !checked.value.has(m.id));
  checked.value = new Set();
}

const payeeName = (pid: Id | null): string => {
  const p = pid ? payees.value.find((x) => x.id === pid) : undefined;
  if (!p) return '';
  const a = p.transferAccountId ? accountMap.value.get(p.transferAccountId) : undefined;
  return a ? texts.value.transfer(a.name) : p.name;
};

// --------------------------------------------------------------------------------- save

const busy = ref(false);

const ERRORS: Record<string, [string, string]> = {
  'name-taken': ['app.schedDlgNameTakenTitle', 'app.schedDlgNameTakenMessage'],
  'no-upcoming': ['app.schedDlgNoUpcomingTitle', 'app.schedDlgNoUpcomingMessage'],
  'end-before-start': ['app.schedDlgEndBeforeStartTitle', 'app.schedDlgEndBeforeStartMessage'],
  'date-before-today': ['app.schedDlgDateBeforeTodayTitle', 'app.schedDlgDateBeforeTodayMessage'],
  'transfer-to-self': ['app.editTransferSelfTitle', 'app.editTransferSelfMessage'],
};

async function save(): Promise<void> {
  if (busy.value) return;
  // Let a pending field commit (blur) land first, then its own dialogs.
  (document.activeElement as HTMLElement | null)?.blur();
  await nextTick();
  if (!(await fieldWork)) {
    fieldWork = Promise.resolve(true);
    return;
  }
  if (!connection.canEdit) {
    await showOffline();
    return;
  }
  busy.value = true;
  try {
    d.value.amount = amountsOf(f).amount;
    if (!(await applySplitRules(d.value, { categoryText, money: money.value }))) return;
    // A split that collapsed takes its line's amount (11 §7.3).
    if (!d.value.split && d.value.amount !== amountsOf(f).amount) {
      f.outflow = d.value.amount < 0;
      f.magnitude = Math.abs(d.value.amount);
    }
    const edit = toEdit(f, payees.value, {
      link: [...link.value],
      unlink: [...unlink.value],
      moveFrom: props.moveFrom ?? null,
    });
    const { id: saved } = await host.call('schedules.save', edit);
    announce(t(isNew ? 'a11y.scheduleAdded' : 'a11y.scheduleSaved'));
    emit('close', { id: saved });
  } catch (e) {
    const known = ERRORS[errorInfo(e).detail ?? ''];
    if (known) await tell(t(known[0]), t(known[1], { name: f.name.trim() }));
    else await reportWriteError(e);
  } finally {
    busy.value = false;
  }
}

// --------------------------------------------------------------------------------- lifecycle

onMounted(async () => {
  void refreshPreview();
  if (props.transfer) void nextTick(() => payeeAc.value?.open());
  if (!isNew) await loadLinked();
});
onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
  if (matchTimer) clearTimeout(matchTimer);
});
</script>

<template>
  <StandardDialog
    :title="isNew ? t('app.schedDlgAddTitle') : t('app.schedDlgEditTitle')"
    width="xl"
    @cancel="emit('close', null)"
    @submit="save"
  >
    <div class="sd" data-schedule-dialog>
      <div class="sd__grid">
        <label class="sd__field">
          <span class="sd__label">{{ t('app.schedDlgName') }}</span>
          <input
            v-model="f.name"
            class="input"
            type="text"
            maxlength="200"
            :placeholder="t('app.schedDlgNamePlaceholder')"
            data-field="name"
          />
        </label>
        <div class="sd__field" data-own-enter data-field="payee">
          <span class="sd__label">{{ t('register.columnPayee') }}</span>
          <AutoComplete
            ref="payeeAc"
            v-model="f.tx.payeeText"
            :entries="payeeList"
            :filter="payeeMatcher"
            :label="t('register.columnPayee')"
            :placeholder="t('app.editPlaceholderPayee')"
            min-width="15.5rem"
            @commit="(v: string, _i: AutoCompleteItem | null, _r: CommitReason) => onPayeeCommit(v)"
          />
        </div>
        <label class="sd__field">
          <span class="sd__label">{{ t('app.regAccountHeader') }}</span>
          <select v-model="f.tx.accountId" class="input" data-field="account">
            <option v-for="a in accountOptions" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
      </div>

      <fieldset class="sd__group">
        <legend class="sd__label">{{ t('app.schedDlgAmount') }}</legend>
        <div class="sd__row">
          <select
            v-model="f.amountOp"
            class="input"
            :aria-label="t('app.schedDlgAmount')"
            data-field="op"
          >
            <option v-for="o in opOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <UiSegmented
            v-model="direction"
            :options="directionOptions"
            :label="t('app.schedDlgDirection')"
          />
          <span class="sd__money" data-field="amount">
            <MoneyInput
              :model-value="f.magnitude"
              :label="t('app.schedDlgAmount')"
              :settings="money"
              @update:model-value="(v: number | null) => (f.magnitude = Math.abs(v ?? 0))"
            />
          </span>
          <template v-if="f.amountOp === 'isbetween'">
            <span>{{ t('app.schedDlgAnd') }}</span>
            <span class="sd__money" data-field="amount2">
              <MoneyInput
                :model-value="f.magnitude2"
                :label="t('app.schedDlgAmount2')"
                :settings="money"
                @update:model-value="(v: number | null) => (f.magnitude2 = Math.abs(v ?? 0))"
              />
            </span>
          </template>
        </div>
        <p v-if="f.amountOp === 'isapprox'" class="sd__hint">{{ t('app.schedDlgApproxHint') }}</p>
      </fieldset>

      <div class="sd__grid sd__grid--two">
        <div class="sd__field" data-own-enter data-field="category">
          <span class="sd__label">{{ t('register.columnCategory') }}</span>
          <AutoComplete
            ref="categoryAc"
            v-model="f.tx.categoryText"
            :entries="categoryList"
            :filter="categoryFilter"
            :label="t('register.columnCategory')"
            :disabled="categoryDisabled || f.tx.split"
            :placeholder="
              categoryDisabled
                ? t('app.regCategoryNotNeeded')
                : f.tx.split
                  ? t('register.splitCategoryOption')
                  : t('app.editPlaceholderCategory')
            "
            highlight-first
            @commit="(v: string, i: AutoCompleteItem | null) => onCategoryCommit(v, i)"
          />
        </div>
        <div class="sd__field" data-field="notes">
          <span class="sd__label">{{ t('register.columnNotes') }}</span>
          <NotesField v-model="f.tx.notes" :label="t('register.columnNotes')" />
        </div>
      </div>

      <div
        v-if="f.tx.split"
        class="sd__lines"
        role="table"
        :aria-label="t('register.splitCategoryOption')"
      >
        <div
          v-for="line in f.tx.lines"
          :key="line.key"
          class="sd__line"
          role="row"
          :data-line="line.key"
        >
          <span role="cell" data-own-enter>
            <AutoComplete
              v-model="line.payeeText"
              :entries="linePayeeList"
              :filter="payeeMatcher"
              :label="t('register.columnPayee')"
              :placeholder="t('app.editPlaceholderPayee')"
              @commit="(v: string) => onLinePayeeCommit(line, v)"
            />
          </span>
          <span role="cell" data-own-enter>
            <AutoComplete
              :ref="(el) => lineRef(line.key, el)"
              v-model="line.categoryText"
              :entries="lineCategoryList"
              :filter="categoryFilter"
              :label="t('register.columnCategory')"
              :disabled="!onBudget || lineOnOn(line)"
              :placeholder="
                lineOnOn(line) ? t('app.regCategoryNotNeeded') : t('app.editPlaceholderCategory')
              "
              highlight-first
              @commit="(v: string, i: AutoCompleteItem | null) => onLineCategoryCommit(line, v, i)"
            />
          </span>
          <span role="cell">
            <input
              v-model="line.notes"
              class="input"
              type="text"
              :aria-label="t('register.columnNotes')"
            />
          </span>
          <span role="cell" class="sd__money">
            <MoneyInput
              :model-value="line.amount < 0 ? -line.amount : 0"
              :label="t('register.columnOutflow')"
              :settings="money"
              blank-zero
              @update:model-value="(v: number | null) => setLineAmount(line, v, -1)"
            />
          </span>
          <span role="cell" class="sd__money">
            <MoneyInput
              :model-value="line.amount > 0 ? line.amount : 0"
              :label="t('register.columnInflow')"
              :settings="money"
              blank-zero
              @update:model-value="(v: number | null) => setLineAmount(line, v, 1)"
            />
          </span>
          <span role="cell">
            <button
              type="button"
              class="sd__icon-button"
              :aria-label="t('a11y.deleteLine')"
              @click="f.tx.lines = f.tx.lines.filter((l) => l !== line)"
            >
              <Trash2 class="sd__icon" aria-hidden="true" />
            </button>
          </span>
        </div>
        <div class="sd__lines-foot">
          <UiSmallButton @click="f.tx.lines.push(emptyLine())">
            <Plus class="sd__icon" aria-hidden="true" />{{ t('app.splitAddLine') }}
          </UiSmallButton>
          <span>
            {{ t('app.splitRemaining') }}
            <MoneyAmount :value="remaining" :settings="money" />
          </span>
        </div>
      </div>

      <fieldset class="sd__group" data-section="date">
        <legend class="sd__label">{{ t('app.schedDlgDate') }}</legend>
        <label class="sd__check">
          <input
            type="checkbox"
            :checked="f.repeats"
            data-field="repeats"
            @change="onRepeats(($event.target as HTMLInputElement).checked)"
          />
          {{ t('app.schedDlgRepeats') }}
        </label>
        <div v-if="!f.repeats" class="sd__row" data-own-enter>
          <DateField
            :model-value="f.once"
            :label="t('app.schedDlgDate')"
            :date-format="format.dateFormat"
            :today="today"
            scheduler
            @update:model-value="(v: ISODate | null) => v && (f.once = v)"
          />
        </div>
        <div v-else class="sd__recur">
          <div class="sd__row">
            <label class="sd__inline">
              {{ t('app.schedDlgFrequency') }}
              <select class="input" :value="preset" data-field="preset" @change="onPreset">
                <option v-for="o in presetOptions" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
            </label>
            <span class="sd__inline" data-own-enter>
              {{ t('app.schedDlgStarts') }}
              <DateField
                :model-value="f.config.start"
                :label="t('app.schedDlgStarts')"
                :date-format="format.dateFormat"
                :today="today"
                @update:model-value="(v: ISODate | null) => v && (f.config.start = v)"
              />
            </span>
          </div>
          <div class="sd__row">
            <label class="sd__inline">
              {{ t('app.schedDlgEvery') }}
              <input
                class="input sd__number"
                type="number"
                min="1"
                max="999"
                :value="f.config.interval ?? 1"
                data-field="interval"
                @change="onInterval"
              />
            </label>
            <select
              class="input"
              :value="f.config.frequency"
              :aria-label="t('app.schedDlgUnit')"
              data-field="unit"
              @change="onUnit"
            >
              <option v-for="u in UNITS" :key="u" :value="u">
                {{ t(UNIT_KEYS[u], f.config.interval ?? 1) }}
              </option>
            </select>
          </div>
          <div v-if="f.config.frequency === 'monthly'" class="sd__patterns">
            <div v-for="(p, i) in patterns" :key="i" class="sd__row" data-pattern>
              <select
                class="input"
                :value="p.value"
                :aria-label="t('app.schedDlgDayValue')"
                @change="setPatternValue(i, Number(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="o in patternValues(p.type)" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
              <select
                class="input"
                :value="p.type"
                :aria-label="t('app.schedDlgDayKind')"
                @change="setPatternType(i, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="o in patternTypes" :key="o.value" :value="o.value">
                  {{ o.label }}
                </option>
              </select>
              <button
                type="button"
                class="sd__icon-button"
                :aria-label="t('app.schedDlgRemoveDay')"
                @click="removePattern(i)"
              >
                <Trash2 class="sd__icon" aria-hidden="true" />
              </button>
            </div>
            <UiSmallButton @click="addPattern">
              <Plus class="sd__icon" aria-hidden="true" />{{ t('app.schedDlgAddDays') }}
            </UiSmallButton>
          </div>
          <p v-if="lateDayHint" class="sd__hint">{{ t('app.schedDlgLateDayHint') }}</p>
          <div class="sd__row" role="radiogroup" :aria-label="t('app.schedDlgEnds')">
            <span class="sd__label">{{ t('app.schedDlgEnds') }}</span>
            <label class="sd__check">
              <input v-model="endMode" type="radio" :name="`${id}-end`" value="never" />
              {{ t('app.schedDlgEndNever') }}
            </label>
            <label class="sd__check">
              <input
                v-model="endMode"
                type="radio"
                :name="`${id}-end`"
                value="after_n_occurrences"
              />
              {{ t('app.schedDlgEndAfter') }}
            </label>
            <input
              class="input sd__number"
              type="number"
              min="1"
              max="999"
              :value="f.config.endOccurrences ?? 1"
              :disabled="endMode !== 'after_n_occurrences'"
              :aria-label="t('app.schedDlgOccurrences', f.config.endOccurrences ?? 1)"
              data-field="occurrences"
              @change="onOccurrences"
            />
            <span>{{ t('app.schedDlgOccurrences', f.config.endOccurrences ?? 1) }}</span>
            <label class="sd__check">
              <input v-model="endMode" type="radio" :name="`${id}-end`" value="on_date" />
              {{ t('app.schedDlgEndOn') }}
            </label>
            <span data-own-enter>
              <DateField
                :model-value="f.config.endDate ?? f.config.start"
                :label="t('app.schedDlgEndDate')"
                :date-format="format.dateFormat"
                :today="today"
                :disabled="endMode !== 'on_date'"
                @update:model-value="(v: ISODate | null) => v && (f.config.endDate = v)"
              />
            </span>
          </div>
          <div class="sd__row">
            <label class="sd__check">
              <input v-model="skipWeekend" type="checkbox" data-field="weekend" />
              {{ t('app.schedDlgWeekend') }}
            </label>
            <select
              class="input"
              :value="f.config.weekendSolveMode ?? 'after'"
              :disabled="!skipWeekend"
              :aria-label="t('app.schedDlgWeekend')"
              @change="
                f.config.weekendSolveMode = ($event.target as HTMLSelectElement).value as
                  'before' | 'after'
              "
            >
              <option value="before">{{ t('app.schedDlgWeekendBefore') }}</option>
              <option value="after">{{ t('app.schedDlgWeekendAfter') }}</option>
            </select>
          </div>
        </div>
        <div v-if="previewAvailable" class="sd__upcoming" data-section="upcoming">
          <span class="sd__label">{{ t('app.schedDlgUpcoming') }}</span>
          <ul v-if="upcoming && upcoming.length > 0" class="sd__dates">
            <li v-for="u in upcoming" :key="u">{{ dateShort(u, format.dateFormat) }}</li>
          </ul>
          <span v-else-if="upcoming" class="sd__hint">{{ t('app.schedDlgNoUpcoming') }}</span>
        </div>
      </fieldset>

      <div class="sd__auto">
        <label class="sd__check">
          <input v-model="f.postsTransaction" type="checkbox" data-field="auto" />
          {{ t('app.schedDlgAutoAdd') }}
        </label>
        <p class="sd__hint">{{ t('app.schedDlgAutoAddHelp') }}</p>
      </div>

      <div class="sd__tx" data-section="transactions">
        <div class="sd__row">
          <UiSegmented v-model="tab" :options="tabOptions" :label="t('app.schedDlgTransactions')" />
          <UiSmallButton
            v-if="tab === 'linked'"
            :disabled="checked.size === 0"
            @click="unlinkChecked"
            >{{ t('app.schedDlgUnlink') }}</UiSmallButton
          >
          <UiSmallButton v-else :disabled="checked.size === 0" @click="linkChecked">{{
            t('app.schedDlgLink')
          }}</UiSmallButton>
        </div>
        <div
          class="sd__table"
          role="table"
          :aria-label="tab === 'linked' ? t('app.schedDlgLinked') : t('app.schedDlgFind')"
        >
          <div class="sd__trow sd__trow--head" role="row">
            <span role="columnheader"
              ><span class="visually-hidden">{{ t('app.schedDlgSelect') }}</span></span
            >
            <span role="columnheader">{{ t('register.columnDate') }}</span>
            <span role="columnheader">{{ t('register.columnPayee') }}</span>
            <span role="columnheader">{{ t('app.regAccountHeader') }}</span>
            <span role="columnheader">{{ t('register.columnNotes') }}</span>
            <span role="columnheader" class="sd__num">{{ t('app.schedDlgAmount') }}</span>
          </div>
          <div v-for="m in shownRows" :key="m.id" class="sd__trow" role="row" :data-match-id="m.id">
            <span role="cell">
              <input
                type="checkbox"
                :checked="checked.has(m.id)"
                :aria-label="t('a11y.selectTransaction')"
                @change="toggleChecked(m.id)"
              />
            </span>
            <span role="cell">{{ dateShort(m.date, format.dateFormat) }}</span>
            <span role="cell" class="sd__text">{{ payeeName(m.payeeId) }}</span>
            <span role="cell" class="sd__text">{{ accountMap.get(m.accountId)?.name ?? '' }}</span>
            <span role="cell" class="sd__text">{{ m.notes }}</span>
            <span role="cell" class="sd__num"
              ><MoneyAmount :value="m.amount" :settings="money"
            /></span>
          </div>
          <p v-if="tableFailed" class="sd__empty" role="alert" data-load-failed>
            {{ tab === 'linked' ? t('app.schedDlgLinkedFailed') : t('app.schedDlgMatchesFailed') }}
          </p>
          <p v-else-if="shownRows.length === 0" class="sd__empty" role="status">
            {{
              tab === 'linked'
                ? t('app.schedDlgNoLinked')
                : matches === null
                  ? t('app.schedDlgMatchesUnavailable')
                  : t('app.schedDlgNoMatches')
            }}
          </p>
        </div>
      </div>
    </div>
    <template #footer>
      <UiButton tone="cancel" @click="emit('close', null)">{{
        t('taskDialog.CancelLabel')
      }}</UiButton>
      <UiButton primary tone="save" :disabled="busy" @click="save">{{
        isNew ? t('app.schedDlgAdd') : t('app.editSave')
      }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.sd {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.sd__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.sd__grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.sd__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

/* The register's fields are sized for a grid row; in the form they match the other inputs. */
.sd__field :deep(input:not([type='checkbox'])),
.sd__line :deep(input),
.sd__money :deep(input) {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-md);
}

.sd__label {
  font-weight: 600;
}

.sd__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
}

.sd__group > legend {
  padding: 0 var(--space-1);
}

.sd__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.sd__recur,
.sd__patterns {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sd__patterns {
  align-items: flex-start;
}

.sd__inline,
.sd__check {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
}

.sd__number {
  width: 4.5rem;
}

.sd__money {
  width: 8rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.sd__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.sd__hint,
.sd__empty {
  margin: 0;
  color: var(--text-subtle);
  font-size: var(--font-sm);
}

.sd__empty {
  padding: var(--space-2);
}

.sd__lines {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sd__line {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 2fr) minmax(0, 2fr) 7rem 7rem var(--hit-min);
  gap: var(--space-2);
  align-items: center;
}

.sd__lines-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sd__icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.sd__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.sd__upcoming {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: baseline;
}

.sd__dates {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
  font-variant-numeric: tabular-nums;
}

.sd__auto {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sd__tx {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sd__table {
  max-height: 12rem;
  border: 1px solid var(--register-border);
  overflow: hidden auto;
}

.sd__trow {
  display: grid;
  grid-template-columns: 2rem 6rem minmax(0, 2fr) minmax(0, 1.5fr) minmax(0, 2fr) 7rem;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--grid-line-h);
}

.sd__trow > * {
  position: relative;
  min-width: 0;
}

.sd__trow--head {
  position: sticky;
  top: 0;
  background: var(--grid-header-bg);
  color: var(--text-on-blue);
  font-weight: 600;
}

.sd__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
