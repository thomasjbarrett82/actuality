<script setup lang="ts">
// The inline transaction editor (11 §1–4, §7.1, §9): inputs aligned to the grid's columns, the split
// editor below, and the button row. It edits the register's draft; the commit pipeline (11 §6) writes it.
// Field commits that ask something (an invalid transfer, a new category) or look something up (auto-fill)
// finish before a commit goes ahead.
import { ENGLISH_TRANSFER_PREFIX, transferAccountName } from '@shared/domain/payees';
import { remainingOf } from '@shared/domain/splits';
import type { Account, Id } from '@shared/domain/types';
import { Lock, Plus, Trash2 } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { deleteTransactions } from '../../register/actions';
import { initialLines, type CommitOutcome } from '../../register/commit';
import { tell } from '../../register/dialogs';
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
import type { ColumnLayout } from '../../register/layout';
import { openPayeeSettings } from '../../register/payee-dialogs';
import { transferKindOf } from '../../register/rows';
import { openScheduleDialog } from '../../register/schedule-dialog';
import {
  useRegister,
  type CommitMode,
  type EditField,
  type EditorState,
} from '../../register/use-register';
import { useRegisterSession } from '../../register/view-state';
import { host } from '../../rpc/host-client';
import { useModals } from '../../stores/modals';
import AutoComplete, { type CommitReason } from '../common/AutoComplete.vue';
import DateField from '../common/DateField.vue';
import MoneyAmount from '../common/MoneyAmount.vue';
import MoneyInput from '../common/MoneyInput.vue';
import UiSmallButton from '../common/UiSmallButton.vue';
import type { AutoCompleteItem } from '../common/autocomplete-list';
import type { AutoCompleteApi, FieldApi, MoneyInputApi } from '../common/exposed';
import AddCategoryDialog from './AddCategoryDialog.vue';
import NotesField from './NotesField.vue';

const props = defineProps<{
  editor: EditorState;
  layout: readonly ColumnLayout[];
  rowIndex: number;
}>();
const { t } = useI18n();
const reg = useRegister();
const modals = useModals();

const draft = computed(() => props.editor.draft);
const isNew = computed(() => props.editor.id === null);
const stored = computed(() => (props.editor.id ? reg.stored(props.editor.id) : undefined));
const own = computed<Account | undefined>(() => reg.accountMap.get(draft.value.accountId));
const onBudget = computed(() => own.value?.onBudget !== false);
/** A transfer row a split elsewhere created: its amount and payee are changed from the split (11 §2). */
const splitCreated = computed(() => stored.value?.transferSide?.isSplitLine === true);
const transferAccount = computed(() =>
  draft.value.transferAccountId ? reg.accountMap.get(draft.value.transferAccountId) : undefined,
);
const onOnTransfer = computed(() => transferKindOf(own.value, transferAccount.value) === 'onOn');
const isIncome = (id: Id | null): boolean =>
  id !== null && reg.groups.some((g) => g.isIncome && g.categories.some((c) => c.id === id));
const money = computed(() => reg.format.money);
const prefixes = computed(() => [t('app.transferPrefix'), ENGLISH_TRANSFER_PREFIX]);
const texts = computed(() => ({
  heading: t('app.editTransferHeading'),
  transfer: (name: string) => t('app.transferPayee', { account: name }),
}));

// --------------------------------------------------------------------------------- refs & focus

const root = ref<HTMLElement | null>(null);
const accountAc = ref<AutoCompleteApi | null>(null);
const dateField = ref<FieldApi | null>(null);
const checkInput = ref<HTMLInputElement | null>(null);
const payeeAc = ref<AutoCompleteApi | null>(null);
const categoryAc = ref<AutoCompleteApi | null>(null);
const notesInput = ref<FieldApi | null>(null);
const outflowInput = ref<MoneyInputApi | null>(null);
const inflowInput = ref<MoneyInputApi | null>(null);

// The fields sit inside the columns' v-for, where a string ref would collect an array: set them by hand.
const fieldRefs = {
  accountAc,
  dateField,
  checkInput,
  payeeAc,
  categoryAc,
  notesInput,
  outflowInput,
  inflowInput,
};
function setRef(name: keyof typeof fieldRefs, el: unknown): void {
  (fieldRefs[name] as { value: unknown }).value = el ?? null;
}

function focusField(field: EditorState['focus']): void {
  const targets: Record<EditorState['focus'], (FieldApi | HTMLInputElement | null)[]> = {
    account: [accountAc.value, dateField.value],
    date: [dateField.value],
    check: [checkInput.value, dateField.value],
    payee: [payeeAc.value],
    category:
      onBudget.value && !onOnTransfer.value && !draft.value.split
        ? [categoryAc.value]
        : [payeeAc.value],
    notes: [notesInput.value],
    outflow: [outflowInput.value],
    inflow: [inflowInput.value],
  };
  targets[field].find((x) => x !== null)?.focus();
}

onMounted(() => {
  // Listeners on the row itself: the editor handles its keys (11 §9) and the locked amounts' clicks.
  root.value?.addEventListener('keydown', onKeydown);
  root.value?.addEventListener('mousedown', onAmountPointer, true);
  root.value?.addEventListener('keydown', onAmountKey, true);
  root.value?.addEventListener('keydown', onCommitKey, true);
  void nextTick(() => {
    focusField(props.editor.focus);
    if (props.editor.transfer) payeeAc.value?.open();
  });
});
onBeforeUnmount(() => {
  root.value?.removeEventListener('keydown', onKeydown);
  root.value?.removeEventListener('mousedown', onAmountPointer, true);
  root.value?.removeEventListener('keydown', onAmountKey, true);
  root.value?.removeEventListener('keydown', onCommitKey, true);
});

const glowing = ref(false);
watch(
  () => props.editor.glow,
  () => {
    glowing.value = false;
    void nextTick(() => {
      glowing.value = true;
      setTimeout(() => (glowing.value = false), 1000);
    });
  },
);

/** Work a field commit started; a commit waits for it, and doesn't go ahead if it failed. */
let fieldWork: Promise<boolean> = Promise.resolve(true);
function work(fn: () => Promise<boolean>): void {
  const before = fieldWork;
  fieldWork = before.then(async (ok) => (await fn()) && ok);
}

/** Moves focus to the control after `el` in the editor, for Tab/Enter commits (11 §2). */
function focusNext(el: Element | null | undefined): void {
  const list = focusablesIn();
  const at = el ? list.indexOf(el as HTMLElement) : -1;
  list[(at + 1) % list.length]?.focus();
}

function focusablesIn(): HTMLElement[] {
  return root.value
    ? [
        ...root.value.querySelectorAll<HTMLElement>(
          'input:not([disabled]):not([tabindex="-1"]), button[data-editor-button], .editor__buttons button:not([disabled])',
        ),
      ]
    : [];
}

// --------------------------------------------------------------------------------- account

const accountEntries = computed(() =>
  reg.accounts
    .filter((a) => !a.closed)
    .map((a) => ({ kind: 'item' as const, id: a.id, label: a.name })),
);
function onAccountCommit(value: string, item: AutoCompleteItem | null, reason: CommitReason): void {
  const found = item
    ? reg.accountMap.get(item.id)
    : reg.accounts.find(
        (a) => !a.closed && a.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
      );
  // A transfer a split elsewhere created changes account from its split (11 §2): refuse and revert.
  if (found && found.id !== draft.value.accountId && splitCreated.value) {
    work(async () => {
      await tell(t('app.editAccountLockedTitle'), t('app.editAccountLockedMessage'));
      accountAc.value?.reset();
      void nextTick(() => accountAc.value?.focus());
      return false;
    });
    return;
  }
  // Must match an account, otherwise it reverts (11 §2).
  if (found) draft.value.accountId = found.id;
  if (reason === 'enter') focusNext(accountAc.value?.element());
}
const accountName = computed(() => own.value?.name ?? '');

// --------------------------------------------------------------------------------- payee

const payeeList = computed(() =>
  payeeEntries(reg.payees, reg.accounts, draft.value.accountId, texts.value, props.editor.transfer),
);
const payeeMatcher = computed(() => payeeFilter(t('app.transferPrefix')));

async function refusePayee(title: string, message: string, previous: string): Promise<boolean> {
  await tell(title, message);
  draft.value.payeeText = previous;
  payeeAc.value?.reset();
  void nextTick(() => payeeAc.value?.focus());
  return false;
}

function onPayeeCommit(value: string, _item: AutoCompleteItem | null, reason: CommitReason): void {
  const previous = draft.value.payeeText;
  const d = draft.value;
  // Leaving the field with only the transfer prefix typed (e.g. clicking Cancel) means no payee was chosen.
  const bareTransfer = reason === 'blur' && transferAccountName(value, prefixes.value) === '';
  const res = bareTransfer
    ? ({ kind: 'none' } as const)
    : resolvePayee(value, prefixes.value, reg.payees, reg.accounts);
  work(async () => {
    if (res.kind === 'invalidTransfer')
      return refusePayee(
        t('app.editInvalidPayeeTitle'),
        t('app.editInvalidTransferMessage', { name: res.name }),
        previous,
      );
    const changed = value.trim().toLocaleLowerCase() !== previous.trim().toLocaleLowerCase();
    if (splitCreated.value && changed)
      return refusePayee(t('app.editPayeeLockedTitle'), t('app.editPayeeLockedMessage'), previous);
    if (res.kind === 'transfer') {
      if (d.split)
        return refusePayee(
          t('app.editSplitNoTransferTitle'),
          t('app.editSplitNoTransferMessage'),
          previous,
        );
      if (res.account.id === d.accountId)
        return refusePayee(
          t('app.editTransferSelfTitle'),
          t('app.editTransferSelfMessage'),
          previous,
        );
      d.transferAccountId = res.account.id;
      d.payeeText = texts.value.transfer(res.account.name);
      d.payeeId = null;
      if (transferKindOf(own.value, res.account) === 'onOn') {
        d.categoryId = null;
        d.categoryText = '';
      }
    } else if (res.kind === 'payee') {
      d.transferAccountId = null;
      d.payeeText = res.name;
      d.payeeId = res.payee?.id ?? null;
      await autofill(res.payee?.id ?? null, res.payee?.enabled === true);
    } else {
      d.transferAccountId = null;
      d.payeeText = '';
      d.payeeId = null;
    }
    return true;
  });
  if (reason === 'enter')
    void fieldWork.then((ok) => {
      if (ok) focusNext(payeeAc.value?.element());
    });
}

/** Payee auto-fill (11 §4.3, X13). */
async function autofill(payeeId: Id | null, enabled: boolean): Promise<void> {
  const d = draft.value;
  if (!payeeId || !enabled) return;
  const newLike = d.categoryId === null && d.notes.trim() === '' && d.amount === 0 && !d.split;
  const imported = stored.value?.importedPayee ?? null;
  const differsFromImported =
    imported !== null &&
    d.payeeText.toLocaleLowerCase() !== imported.toLocaleLowerCase() &&
    d.categoryId === null;
  if (!newLike && !differsFromImported) return;
  const { last, ruleCategoryId } = await host.call('transactions.lastForPayee', { payeeId });
  if (
    reg.autofill.category &&
    d.categoryId === null &&
    onBudget.value &&
    !onOnTransfer.value &&
    !d.split
  ) {
    const category = ruleCategoryId ?? last?.categoryId ?? null;
    if (category) {
      d.categoryId = category;
      d.categoryText = reg.categoryText(category);
    }
  }
  if (!last || !newLike) return;
  if (reg.autofill.notes && d.notes.trim() === '') d.notes = last.notes;
  if (reg.autofill.amount && d.amount === 0) d.amount = last.amount;
}

function editPayees(): void {
  payeeAc.value?.close();
  void openPayeeSettings(draft.value.payeeText.trim() || null);
}

// --------------------------------------------------------------------------------- category

const categoryList = computed(() =>
  categoryEntries(reg.groups, { split: t('register.splitCategoryOption') }),
);
const lineCategoryList = computed(() =>
  categoryEntries(reg.groups, { addNew: t('register.addNewCategory') }),
);
const categoryPlaceholder = computed(() =>
  onOnTransfer.value ? t('app.regCategoryNotNeeded') : t('app.editPlaceholderCategory'),
);

/** Resolves typed category text for the main row (`line` null) or a split line (11 §4.2). */
async function applyCategory(
  value: string,
  item: AutoCompleteItem | null,
  line: EditLine | null,
  ac: AutoCompleteApi | null,
): Promise<boolean> {
  const d = draft.value;
  const target = line ?? d;
  const previous = target.categoryText;
  const keep = (): false => {
    target.categoryText = previous;
    ac?.reset();
    void nextTick(() => ac?.focus());
    return false;
  };
  if (item?.id === ADD_CATEGORY_ITEM) return addCategory(target, '', '', ac, previous);
  const res = resolveCategory(value, t('register.splitCategoryOption'), reg.groups);
  switch (res.kind) {
    case 'none':
      target.categoryId = null;
      target.categoryText = '';
      return true;
    case 'split':
      if (line) return keep();
      if (d.transferAccountId) {
        await tell(t('app.editCannotSplitTitle'), t('app.editCannotSplitMessage'));
        return keep();
      }
      d.split = true;
      d.categoryId = null;
      d.categoryText = '';
      if (d.lines.length === 0) d.lines = initialLines();
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
    groups: reg.groups,
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

function onCategoryCommit(
  value: string,
  item: AutoCompleteItem | null,
  reason: CommitReason,
): void {
  work(() => applyCategory(value, item, null, categoryAc.value));
  if (reason === 'enter')
    void fieldWork.then((ok) => {
      if (ok) focusNext(categoryAc.value?.element());
    });
}

// --------------------------------------------------------------------------------- amounts

const outflow = computed(() => (draft.value.amount < 0 ? -draft.value.amount : 0));
const inflow = computed(() => (draft.value.amount > 0 ? draft.value.amount : 0));
function setOutflow(v: number | null): void {
  draft.value.amount = -(v ?? 0);
}
function setInflow(v: number | null): void {
  draft.value.amount = v ?? 0;
}
/** A transfer from a split elsewhere: its amount is changed from the split (11 §2). */
const inLockedAmount = (e: Event): boolean =>
  splitCreated.value &&
  e.target instanceof HTMLElement &&
  e.target.closest('[data-main] [data-field="outflow"], [data-main] [data-field="inflow"]') !==
    null;
function onAmountPointer(e: MouseEvent): void {
  if (!inLockedAmount(e)) return;
  e.preventDefault();
  void tell(t('app.editAmountLockedTitle'), t('app.editAmountLockedMessage'));
}
function onAmountKey(e: KeyboardEvent): void {
  if (!inLockedAmount(e) || e.key === 'Tab' || e.key === 'Escape' || e.key === 'Enter') return;
  e.preventDefault();
  e.stopPropagation();
  void tell(t('app.editAmountLockedTitle'), t('app.editAmountLockedMessage'));
}

// --------------------------------------------------------------------------------- check number

let focusValue = '';
function rememberValue(e: FocusEvent): void {
  focusValue = (e.target as HTMLInputElement).value;
}

async function nextCheck(): Promise<string> {
  return (
    (await host.call('transactions.nextCheckNumber', { accountId: draft.value.accountId })) ?? '1'
  );
}

async function onCheckKey(e: KeyboardEvent): Promise<void> {
  const d = draft.value;
  const n = /^\d+$/.test(d.checkNumber.trim()) ? Number(d.checkNumber.trim()) : null;
  const key = e.key;
  if (
    (e.altKey && key.toLowerCase() === 'n') ||
    ((e.ctrlKey || e.metaKey) && e.shiftKey && key.toLowerCase() === 'n')
  ) {
    e.preventDefault();
    e.stopPropagation();
    d.checkNumber = await nextCheck();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (key === 'ArrowUp' || key === '+' || key === 'ArrowDown') {
    e.preventDefault();
    if (d.checkNumber.trim() === '') d.checkNumber = await nextCheck();
    else if (n !== null) d.checkNumber = String(key === 'ArrowDown' ? Math.max(1, n - 1) : n + 1);
    return;
  }
  revertOnEscape(e, (v) => (d.checkNumber = v));
}

/** The first Esc reverts a plain text field (11 §1 step 4). */
function revertOnEscape(e: KeyboardEvent, set: (v: string) => void): void {
  if (e.key !== 'Escape') return;
  const value = (e.target as HTMLInputElement).value;
  if (value === focusValue) return;
  e.preventDefault();
  e.stopPropagation();
  set(focusValue);
}

function onNotesKey(e: KeyboardEvent, line: EditLine | null): void {
  // An income category: Tab from Notes goes to Inflow (11 §2).
  if (e.key === 'Tab' && !e.shiftKey && isIncome(line ? line.categoryId : draft.value.categoryId)) {
    const target = line
      ? root.value?.querySelector<HTMLElement>(
          `[data-line="${line.key}"] [data-field="inflow"] input`,
        )
      : root.value?.querySelector<HTMLElement>('[data-main] [data-field="inflow"] input');
    if (target) {
      e.preventDefault();
      target.focus();
      return;
    }
  }
  revertOnEscape(e, (v) => {
    if (line) line.notes = v;
    else draft.value.notes = v;
  });
}

// --------------------------------------------------------------------------------- cleared

function toggleCleared(): void {
  const d = draft.value;
  if (d.cleared === 'R') return;
  d.cleared = d.cleared === 'U' ? 'C' : 'U';
  if (d.cleared === 'C') d.needsReview = false;
}

// --------------------------------------------------------------------------------- split lines

const remaining = computed(() => remainingOf(draft.value.amount, draft.value.lines));
const lineRefs = new Map<
  string,
  { payee?: AutoCompleteApi | null; category?: AutoCompleteApi | null }
>();
function lineRef(key: string, field: 'payee' | 'category', el: unknown): void {
  const entry = lineRefs.get(key) ?? {};
  entry[field] = el as AutoCompleteApi | null;
  lineRefs.set(key, entry);
}

const linePayeeList = computed(() =>
  payeeEntries(reg.payees, reg.accounts, draft.value.accountId, texts.value, true),
);

function onLinePayeeCommit(line: EditLine, value: string): void {
  const previous = line.payeeText;
  const res = resolvePayee(value, prefixes.value, reg.payees, reg.accounts);
  work(async () => {
    if (res.kind === 'invalidTransfer') {
      await tell(
        t('app.editInvalidPayeeTitle'),
        t('app.editInvalidTransferMessage', { name: res.name }),
      );
      line.payeeText = previous;
      lineRefs.get(line.key)?.payee?.reset();
      return false;
    }
    if (res.kind === 'transfer') {
      if (res.account.id === draft.value.accountId) {
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

function setLineAmount(line: EditLine, v: number | null, sign: 1 | -1): void {
  line.amount = sign * (v ?? 0);
  // An amount in the last line adds a new empty line (11 §7.1).
  const last = draft.value.lines.at(-1);
  if (last === line && line.amount !== 0) draft.value.lines.push(emptyLine());
}

function addLine(): void {
  draft.value.lines.push(emptyLine());
  const key = draft.value.lines.at(-1)?.key;
  void nextTick(() => key && lineRefs.get(key)?.payee?.focus());
}

function removeLine(line: EditLine): void {
  draft.value.lines = draft.value.lines.filter((l) => l !== line);
}

const lineOnOn = (line: EditLine): boolean =>
  transferKindOf(
    own.value,
    line.transferAccountId ? reg.accountMap.get(line.transferAccountId) : undefined,
  ) === 'onOn';

// --------------------------------------------------------------------------------- buttons & keys

type ButtonDef = {
  mode: CommitMode | 'cancel' | 'delete';
  label: string;
  tone?: 'save' | 'cancel';
};
const buttons = computed<ButtonDef[]>(() => {
  if (isNew.value)
    return [
      { mode: 'saveAdd', label: t('app.editSaveAddAnother'), tone: 'save' },
      { mode: 'save', label: t('app.editSave'), tone: 'save' },
      { mode: 'cancel', label: t('app.editCancel'), tone: 'cancel' },
    ];
  if (stored.value?.needsReview)
    return [
      { mode: 'approveNext', label: t('app.editApproveFindNext'), tone: 'save' },
      { mode: 'approve', label: t('app.editApprove'), tone: 'save' },
      { mode: 'delete', label: t('app.editDelete'), tone: 'cancel' },
      { mode: 'cancel', label: t('app.editCancel'), tone: 'cancel' },
    ];
  return [
    { mode: 'done', label: t('app.editDone'), tone: 'save' },
    { mode: 'cancel', label: t('app.editCancel'), tone: 'cancel' },
  ];
});

async function press(mode: ButtonDef['mode']): Promise<CommitOutcome | null> {
  if (mode === 'cancel') {
    reg.cancelEdit();
    return null;
  }
  if (mode === 'delete') {
    const row = stored.value;
    if (!row) return null;
    reg.cancelEdit();
    await deleteTransactions([row]);
    return null;
  }
  // Let a pending field commit (blur) land first, then its own lookups and dialogs.
  (document.activeElement as HTMLElement | null)?.blur();
  await nextTick();
  if (!(await fieldWork)) {
    fieldWork = Promise.resolve(true);
    return null;
  }
  return reg.commit(mode);
}

/** Ctrl+Shift+Enter in a new transaction's editor (11 §9): saves the new transaction, then Make recurring… on it. */
async function saveAndSchedule(): Promise<void> {
  const outcome = await press('save');
  // A blank new transaction just closes, with no id.
  if (outcome?.status !== 'saved' || !outcome.id) return;
  const saved = await openScheduleDialog({
    kind: 'fromTransaction',
    transactionId: outcome.id,
    mode: 'recurring',
  });
  if (saved) useRegisterSession().state.scheduled = saved;
}

/**
 * Ctrl+Enter saves and closes from any field, even an open auto-complete list; Ctrl+Shift+Enter in the
 * new transaction's editor also makes it recurring (11 §9). Capture phase, so the field never sees the key.
 */
function onCommitKey(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  e.preventDefault();
  e.stopPropagation();
  if (!e.shiftKey) void press(isNew.value ? 'save' : 'done');
  else if (isNew.value) void saveAndSchedule();
}

/** Focuses a field in a split line, or the line's payee when that field can't take focus. */
function focusInLine(line: HTMLElement, field: EditField): void {
  const input = (f: string): HTMLElement | null =>
    line.querySelector<HTMLElement>(
      `[data-field="${f}"] input:not(:disabled), [data-field="${f}"] textarea:not(:disabled)`,
    );
  (input(field) ?? input('payee'))?.focus();
}

/**
 * Shift+Enter moves up, as in Actual (11 §9): from a split line to the same field in the line above;
 * from the main row, saves and edits the transaction above in the same field.
 */
async function moveUp(from: HTMLElement): Promise<void> {
  const field = (from.closest<HTMLElement>('[data-field]')?.dataset.field ?? 'date') as EditField;
  const line = from.closest<HTMLElement>('[data-line]');
  if (line) {
    const prev = line.previousElementSibling;
    if (prev instanceof HTMLElement && prev.matches('[data-line]')) focusInLine(prev, field);
    else focusField(field);
    return;
  }
  const id = props.editor.id;
  const above = id === null ? null : reg.idAbove(id);
  const outcome = await press(id === null ? 'save' : 'done');
  if (outcome?.status === 'saved' && above) await reg.beginEdit(above, field);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    reg.cancelEdit();
    return;
  }
  if (
    e.key === 'Enter' &&
    e.shiftKey &&
    e.target instanceof HTMLElement &&
    !(e.target instanceof HTMLButtonElement)
  ) {
    e.preventDefault();
    void moveUp(e.target);
    return;
  }
  if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    const first = buttons.value[0];
    if (first) void press(first.mode);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    toggleCleared();
    return;
  }
  if (e.key === 'Tab') {
    const list = focusablesIn();
    const at = list.indexOf(e.target as HTMLElement);
    if (!e.shiftKey && at === list.length - 1) {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.shiftKey && at === 0) {
      e.preventDefault();
      list.at(-1)?.focus();
    }
  }
}
</script>

<template>
  <div
    ref="root"
    class="editor"
    role="row"
    :aria-rowindex="rowIndex"
    :aria-label="t('a11y.editingTransaction')"
    data-editor
  >
    <div class="editor__row" data-main>
      <template v-for="c in layout" :key="c.field">
        <div v-if="c.field === 'select'" class="editor__cell editor__cell--icon" role="gridcell">
          <input type="checkbox" disabled :aria-label="t('a11y.selectTransaction')" />
        </div>
        <div
          v-else-if="c.field === 'account'"
          class="editor__cell"
          role="gridcell"
          data-field="account"
        >
          <AutoComplete
            :ref="(el) => setRef('accountAc', el)"
            :model-value="accountName"
            :entries="accountEntries"
            :label="t('app.regAccountHeader')"
            highlight-first
            @commit="onAccountCommit"
          />
        </div>
        <div v-else-if="c.field === 'date'" class="editor__cell" role="gridcell" data-field="date">
          <DateField
            :ref="(el) => setRef('dateField', el)"
            :model-value="draft.date"
            :label="t('register.columnDate')"
            :date-format="reg.format.dateFormat"
            :today="reg.today"
            @update:model-value="(d) => d && (draft.date = d)"
          />
        </div>
        <div
          v-else-if="c.field === 'check'"
          class="editor__cell"
          role="gridcell"
          data-field="check"
        >
          <input
            :ref="(el) => setRef('checkInput', el)"
            v-model="draft.checkNumber"
            class="editor__input"
            type="text"
            :aria-label="t('register.columnCheckNumber')"
            @focus="rememberValue"
            @keydown="onCheckKey"
          />
        </div>
        <div
          v-else-if="c.field === 'payee'"
          class="editor__cell"
          role="gridcell"
          data-field="payee"
        >
          <AutoComplete
            :ref="(el) => setRef('payeeAc', el)"
            :model-value="draft.payeeText"
            :entries="payeeList"
            :filter="payeeMatcher"
            :label="t('register.columnPayee')"
            :placeholder="t('app.editPlaceholderPayee')"
            :empty-text="t('app.editPayeesEmpty')"
            min-width="15.5rem"
            @commit="onPayeeCommit"
          >
            <template #header>{{ t('app.editMemorizedPayees') }}</template>
            <template #footer>
              <button type="button" class="editor__link" @mousedown.prevent="editPayees">
                {{ t('app.editEditPayees') }}
              </button>
            </template>
          </AutoComplete>
        </div>
        <div
          v-else-if="c.field === 'category'"
          class="editor__cell"
          role="gridcell"
          data-field="category"
        >
          <template v-if="onBudget">
            <span v-if="draft.split" class="editor__static">{{
              t('register.splitCategoryOption')
            }}</span>
            <AutoComplete
              v-else
              :ref="(el) => setRef('categoryAc', el)"
              :model-value="draft.categoryText"
              :entries="categoryList"
              :filter="categoryFilter"
              :label="t('register.columnCategory')"
              :placeholder="categoryPlaceholder"
              :disabled="onOnTransfer"
              highlight-first
              min-width="16rem"
              @commit="onCategoryCommit"
            >
              <template #header>{{ t('app.editBudgetCategories') }}</template>
              <template #footer>
                <button
                  type="button"
                  class="editor__link"
                  @mousedown.prevent="
                    work(() => addCategory(draft, '', '', categoryAc, draft.categoryText))
                  "
                >
                  {{ t('app.editAddCategory') }}
                </button>
              </template>
            </AutoComplete>
          </template>
        </div>
        <div
          v-else-if="c.field === 'notes'"
          class="editor__cell"
          role="gridcell"
          data-field="notes"
        >
          <NotesField
            :ref="(el) => setRef('notesInput', el)"
            v-model="draft.notes"
            class="editor__input"
            :label="t('register.columnNotes')"
            :placeholder="t('app.editPlaceholderNotes')"
            @focus="rememberValue"
            @keydown="onNotesKey($event, null)"
          />
        </div>
        <div
          v-else-if="c.field === 'outflow'"
          class="editor__cell"
          role="gridcell"
          data-field="outflow"
        >
          <MoneyInput
            :ref="(el) => setRef('outflowInput', el)"
            :model-value="outflow"
            :label="t('register.columnOutflow')"
            :placeholder="t('app.editPlaceholderOutflow')"
            :settings="money"
            :readonly="splitCreated"
            blank-zero
            @commit="setOutflow"
          />
        </div>
        <div
          v-else-if="c.field === 'inflow'"
          class="editor__cell"
          role="gridcell"
          data-field="inflow"
        >
          <MoneyInput
            :ref="(el) => setRef('inflowInput', el)"
            :model-value="inflow"
            :label="t('register.columnInflow')"
            :placeholder="t('app.editPlaceholderInflow')"
            :settings="money"
            :readonly="splitCreated"
            blank-zero
            @commit="setInflow"
          />
        </div>
        <div
          v-else-if="c.field === 'cleared'"
          class="editor__cell editor__cell--icon"
          role="gridcell"
        >
          <!-- Stays focusable while Reconciled so it announces the state (11 §2); the scheduler has no Cleared column. -->
          <button
            type="button"
            class="editor__icon-button editor__cleared"
            :class="`is-${draft.cleared}`"
            :aria-label="
              t(
                draft.cleared === 'R'
                  ? 'a11y.reconciledState'
                  : draft.cleared === 'C'
                    ? 'a11y.clearedState'
                    : 'a11y.unclearedState',
              )
            "
            :aria-disabled="draft.cleared === 'R' || undefined"
            data-editor-button
            @click="toggleCleared"
          >
            <Lock v-if="draft.cleared === 'R'" class="editor__icon" aria-hidden="true" />
            <span v-else class="editor__c" aria-hidden="true">{{
              t('register.columnCleared')
            }}</span>
          </button>
        </div>
        <div v-else class="editor__cell" role="gridcell" />
      </template>
    </div>

    <template v-if="draft.split">
      <div
        v-for="line in draft.lines"
        :key="line.key"
        class="editor__row editor__row--line"
        :data-line="line.key"
      >
        <template v-for="c in layout" :key="c.field">
          <div
            v-if="c.field === 'payee'"
            class="editor__cell editor__cell--indent"
            role="gridcell"
            data-field="payee"
          >
            <AutoComplete
              :ref="(el: unknown) => lineRef(line.key, 'payee', el)"
              :model-value="line.payeeText"
              :entries="linePayeeList"
              :filter="payeeMatcher"
              :label="t('register.columnPayee')"
              :placeholder="t('app.editPlaceholderPayee')"
              min-width="21.5rem"
              @commit="(v: string) => onLinePayeeCommit(line, v)"
            />
          </div>
          <div
            v-else-if="c.field === 'category'"
            class="editor__cell"
            role="gridcell"
            data-field="category"
          >
            <AutoComplete
              :ref="(el: unknown) => lineRef(line.key, 'category', el)"
              :model-value="line.categoryText"
              :entries="lineCategoryList"
              :filter="categoryFilter"
              :label="t('register.columnCategory')"
              :placeholder="
                lineOnOn(line) ? t('app.regCategoryNotNeeded') : t('app.editPlaceholderCategory')
              "
              :disabled="lineOnOn(line)"
              highlight-first
              min-width="16rem"
              @commit="
                (v: string, item: AutoCompleteItem | null) => onLineCategoryCommit(line, v, item)
              "
            />
          </div>
          <div
            v-else-if="c.field === 'notes'"
            class="editor__cell"
            role="gridcell"
            data-field="notes"
          >
            <NotesField
              v-model="line.notes"
              class="editor__input"
              :label="t('register.columnNotes')"
              :placeholder="t('app.editPlaceholderNotes')"
              @focus="rememberValue"
              @keydown="onNotesKey($event, line)"
            />
          </div>
          <div
            v-else-if="c.field === 'outflow'"
            class="editor__cell"
            role="gridcell"
            data-field="outflow"
          >
            <MoneyInput
              :model-value="line.amount < 0 ? -line.amount : 0"
              :label="t('register.columnOutflow')"
              :placeholder="t('app.editPlaceholderOutflow')"
              :settings="money"
              blank-zero
              @commit="(v: number | null) => setLineAmount(line, v, -1)"
            />
          </div>
          <div
            v-else-if="c.field === 'inflow'"
            class="editor__cell"
            role="gridcell"
            data-field="inflow"
          >
            <MoneyInput
              :model-value="line.amount > 0 ? line.amount : 0"
              :label="t('register.columnInflow')"
              :placeholder="t('app.editPlaceholderInflow')"
              :settings="money"
              blank-zero
              @commit="(v: number | null) => setLineAmount(line, v, 1)"
            />
          </div>
          <div v-else class="editor__cell" role="gridcell" />
        </template>
        <button
          type="button"
          tabindex="-1"
          class="editor__icon-button editor__trash"
          :aria-label="t('a11y.deleteLine')"
          @click="removeLine(line)"
        >
          <Trash2 class="editor__icon" aria-hidden="true" />
        </button>
      </div>
      <div class="editor__row editor__row--add">
        <template v-for="c in layout" :key="c.field">
          <div v-if="c.field === 'payee'" class="editor__cell editor__cell--indent" role="gridcell">
            <button type="button" class="editor__link" data-editor-button @click="addLine">
              <Plus class="editor__icon" aria-hidden="true" />{{ t('app.splitAddLine') }}
            </button>
          </div>
          <div
            v-else-if="c.field === 'notes'"
            class="editor__cell editor__cell--right"
            role="gridcell"
          >
            {{ t('app.splitRemaining') }}
          </div>
          <div
            v-else-if="c.field === 'outflow'"
            class="editor__cell editor__cell--money"
            role="gridcell"
          >
            <MoneyAmount v-if="remaining < 0" :value="Math.abs(remaining)" :settings="money" />
          </div>
          <div
            v-else-if="c.field === 'inflow'"
            class="editor__cell editor__cell--money"
            role="gridcell"
          >
            <MoneyAmount v-if="remaining >= 0" :value="remaining" :settings="money" />
          </div>
          <div v-else class="editor__cell" role="gridcell" />
        </template>
      </div>
    </template>

    <div class="editor__buttons" :class="{ 'is-glowing': glowing }">
      <UiSmallButton
        v-for="b in buttons"
        :key="b.mode"
        :tone="b.tone"
        :disabled="editor.busy"
        @click="press(b.mode)"
      >
        {{ b.label }}
      </UiSmallButton>
    </div>
  </div>
</template>

<style scoped>
.editor {
  border: 1px solid var(--row-edit-border);
  background: var(--row-edit-bg);
}

.editor__row {
  display: grid;
  grid-template-columns: var(--reg-cols);
  min-height: var(--row-h);
}

.editor__row--line,
.editor__row--add {
  border-top: 1px solid var(--split-border);
}

.editor__row--line {
  position: relative;
}

.editor__trash {
  position: absolute;
  top: 0;
  right: 0;
}

.editor__cell {
  display: flex;
  align-items: center;
  min-width: 0;
  border-right: 1px solid var(--grid-line-v);
}

.editor__cell--icon {
  justify-content: center;
}

.editor__cell--indent {
  padding-left: var(--space-4);
}

.editor__cell--money,
.editor__cell--right {
  justify-content: flex-end;
  padding: 0 var(--space-2);
}

.editor__cell :deep(input[type='text']) {
  width: 100%;
  min-height: var(--row-h);
  border: 0;
  background: transparent;
}

/* The date column is narrow: the calendar button overlays the field's end while it's hovered or focused. */
.editor__cell :deep(.date-field) {
  position: relative;
  border: 0;
  background: transparent;
}

.editor__cell :deep(.date-field__input) {
  padding: 0 var(--space-1);
}

.editor__cell :deep(.date-field__button) {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  background: var(--row-edit-bg);
  opacity: 0;
}

.editor__cell:hover :deep(.date-field__button),
.editor__cell:focus-within :deep(.date-field__button) {
  opacity: 1;
}

.editor__input {
  width: 100%;
  min-height: var(--row-h);
  padding: 0 var(--space-2);
  border: 0;
  background: transparent;
  color: var(--text);
}

.editor__select {
  cursor: pointer;
}

.editor__static {
  padding: 0 var(--space-2);
  color: var(--text-muted);
}

.editor__icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--icon);
  height: var(--row-h);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.editor__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.editor__cleared.is-C,
.editor__cleared.is-R {
  color: var(--cleared-on);
}

.editor__c {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-sm);
  height: var(--icon-sm);
  border: 1px solid currentcolor;
  border-radius: 50%;
  font-size: var(--font-xs);
  font-weight: 700;
}

.editor__cleared.is-C .editor__c {
  background: var(--cleared-on);
  color: var(--panel-bg);
}

.editor__link {
  border: 0;
  background: transparent;
  color: var(--link);
  cursor: pointer;
  text-decoration: underline;
}

.editor__buttons {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--row-edit-border);
}

.editor__buttons.is-glowing {
  animation: editor-glow 1s ease-out;
}

@keyframes editor-glow {
  from {
    box-shadow: 0 0 0.6rem 0.2rem var(--accent-blue);
  }

  to {
    box-shadow: 0 0 0 0 transparent;
  }
}
</style>
