<script setup lang="ts">
// The register's panel (10): one account, or All Accounts. The notifier strip and toolbar, the search info
// bar, the grid with its inline editor (11), the footer (or the reconciliation footer, 13 §6.2) and the
// Scheduled Transactions pane (12 §3) under a splitter. It owns the register's and the scheduler's state,
// the keyboard table (10 §9), jumps to a transaction (10 §9.1), the Undo notifier, reconciliation and the
// File ▸ Import / Export / Print commands for the register. Ready once its data has loaded.
import type { Id } from '@shared/domain/types';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { announce } from '../../a11y/announcer';
import { reconcileTexts } from '../../accounts/flows';
import { commands } from '../../commands';
import AccountHeader from '../../components/register/AccountHeader.vue';
import NotifierStrip from '../../components/register/NotifierStrip.vue';
import ReconcileDialog from '../../components/register/ReconcileDialog.vue';
import ReconcileFooter from '../../components/register/ReconcileFooter.vue';
import RegisterFooter from '../../components/register/RegisterFooter.vue';
import RegisterGrid from '../../components/register/RegisterGrid.vue';
import RegisterToolbar from '../../components/register/RegisterToolbar.vue';
import SchedulerPane from '../../components/register/SchedulerPane.vue';
import SearchInfoBar from '../../components/register/SearchInfoBar.vue';
import { exportData } from '../../export/export-flow';
import { importTransactions } from '../../import/import-flow';
import { isTextInput, keyboard } from '../../keyboard/dispatcher';
import { printRegister } from '../../print/print-flow';
import {
  approve,
  deleteTransactions,
  dismissUndo,
  toggleCleared,
  undo,
} from '../../register/actions';
import { attempt } from '../../register/dialogs';
import { useJump } from '../../register/jump';
import { openPayeeSettings } from '../../register/payee-dialogs';
import { createRegister, provideRegister, type EditField } from '../../register/use-register';
import { createScheduler, provideScheduler, SCHEDULER_MIN_H } from '../../register/use-scheduler';
import { useRegisterSession } from '../../register/view-state';
import { host } from '../../rpc/host-client';
import { useDialogs } from '../../stores/dialogs';
import { useModals } from '../../stores/modals';
import PanelHeading from './PanelHeading.vue';

const props = defineProps<{ accountId: string; shown: boolean }>();
const emit = defineEmits<{ ready: [] }>();
const { t } = useI18n();
const reg = createRegister(toRef(props, 'accountId'));
provideRegister(reg);
const sched = createScheduler(toRef(props, 'accountId'), reg);
provideScheduler(sched);
const jump = useJump();
const session = useRegisterSession();
const queryClient = useQueryClient();

const root = ref<HTMLElement | null>(null);
const toolbar = ref<InstanceType<typeof RegisterToolbar> | null>(null);
const grid = ref<InstanceType<typeof RegisterGrid> | null>(null);
const toolbarRegion = ref<HTMLElement | null>(null);
const footerRegion = ref<HTMLElement | null>(null);

/** The Reconciling title (10 §7.3): its own line below the account header, which doesn't change. */
const reconcilingTitle = computed(() =>
  reg.reconciling ? t('app.recHeading', { account: reg.account?.name ?? '' }) : null,
);

watch(
  () => reg.loaded,
  (loaded) => {
    if (loaded) emit('ready');
  },
  { immediate: true },
);

// ----------------------------------------------------------------------------------- jump (10 §9.1)

watch(
  () => [jump.pending, reg.loaded, props.accountId] as const,
  () => {
    if (!reg.loaded) return;
    const target = jump.take(props.accountId);
    if (!target) return;
    const row = reg.byId.get(target.transactionId);
    if (!row) return;
    // Clear the filters only if they'd hide it; show reconciled rows if it's reconciled.
    if (!reg.shown.some((s) => s.row.t.id === target.transactionId)) {
      if (reg.reconciling) reg.stopReconcile();
      reg.searchText = '';
      if (reg.dateFiltered) void reg.setDateFilter({ preset: 'all', from: null, to: null });
    }
    if (row.t.cleared === 'R' && !reg.showReconciled) void reg.setShowReconciled(true);
    if (target.expand) reg.toggleExpanded(target.transactionId, true);
    reg.select(target.transactionId);
    reg.focusRow = target.transactionId;
  },
  { immediate: true },
);

// ----------------------------------------------------------------------------------- undo (10 §5)

async function runUndo(): Promise<void> {
  const ids = await undo();
  const first = ids ? Object.values(ids)[0] : undefined;
  if (first) {
    reg.select(first);
    reg.focusRow = first;
  }
}

/** Any mouse-down elsewhere hides the Undo and Matched notifiers (10 §5). */
function onDocumentPointer(e: PointerEvent): void {
  if (!session.state.undo && !session.state.matched) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('[data-undo-notifier]')) return;
  dismissUndo();
  session.state.matched = null;
}

// ----------------------------------------------------------------------------------- scheduler (12 §3)

/** The pane hides itself when the panel can't fit both minimums, unless asked for (10 §1). */
const fits = ref(true);
const forced = ref(false);
const paneShown = computed(
  () => !reg.reconciling && sched.shownPref && (fits.value || forced.value),
);
/** The pane's live height while the splitter is dragged, in rem. */
const dragHeight = ref<number | null>(null);
const paneHeight = computed(() => dragHeight.value ?? sched.height);

const remPx = (): number =>
  Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
let resize: ResizeObserver | null = null;

async function toggleScheduler(): Promise<void> {
  if (paneShown.value) {
    forced.value = false;
    await sched.setVisible(false);
    return;
  }
  forced.value = !fits.value;
  await sched.setVisible(true);
}

function startSplit(e: PointerEvent): void {
  e.preventDefault();
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);
  const startY = e.clientY;
  const start = paneHeight.value;
  const move = (ev: PointerEvent): void => {
    dragHeight.value = Math.max(SCHEDULER_MIN_H, start + (startY - ev.clientY) / remPx());
  };
  const up = (): void => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    const h = dragHeight.value;
    dragHeight.value = null;
    if (h !== null) void sched.setHeight(h);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
}

/** The splitter's pointer and arrow keys, bound when it appears. */
let splitter: HTMLElement | null = null;
function bindSplitter(el: unknown): void {
  const next = el instanceof HTMLElement ? el : null;
  if (next === splitter) return;
  splitter?.removeEventListener('pointerdown', startSplit);
  splitter?.removeEventListener('keydown', onSplitKey);
  splitter = next;
  splitter?.addEventListener('pointerdown', startSplit);
  splitter?.addEventListener('keydown', onSplitKey);
}

function onSplitKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  void sched.setHeight(paneHeight.value + (e.key === 'ArrowUp' ? 1 : -1));
}

const scheduledCount = computed(() =>
  reg.isAll
    ? reg.accounts.reduce((n, a) => n + a.scheduledCount, 0)
    : (reg.account?.scheduledCount ?? 0),
);

/** Enter in register now: select the new rows and scroll to them (12 §3). */
async function onEntered(ids: Id[]): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['register'] });
  const view = session.view(props.accountId);
  view.selection = new Set(ids.filter((id) => reg.byId.has(id)));
  const [first] = ids;
  if (first) reg.focusRow = first;
}

// Make recurring… / Move to scheduler…, after the Schedule dialog saved: open the pane and select the
// schedule (10 §6.1, 12 §4).
watch(
  () => session.state.scheduled,
  async (made) => {
    if (!made || !props.shown) return;
    session.state.scheduled = null;
    if (!paneShown.value) await toggleScheduler();
    await sched.refresh();
    sched.select(made);
    sched.focusRow = made;
  },
);

// ----------------------------------------------------------------------------------- reconcile (13 §6)

async function startReconcile(): Promise<void> {
  const account = reg.account;
  if (!account || reg.isAll) return;
  if (!(await reg.settleOpenEdit())) return;
  const result = await useModals().open<{ statementDate: string; target: number }>(
    ReconcileDialog,
    {
      account,
      today: reg.today,
      current: reg.reconcile
        ? { statementDate: reg.reconcile.statementDate, target: reg.reconcile.target }
        : null,
    },
  );
  if (!result) return;
  const started = !reg.reconciling;
  reg.beginReconcile(result.statementDate as never, result.target);
  if (started && reconcilingTitle.value) announce(reconcilingTitle.value);
}

async function finishReconcile(): Promise<void> {
  const r = reg.reconcile;
  const account = reg.account;
  if (!r || !account) return;
  if (!(await reg.settleOpenEdit())) return;
  let createAdjustment = false;
  if (reg.reconcileTotals.difference !== 0) {
    const { button } = await useDialogs().showTaskDialog({
      instruction: t('app.recUnbalancedTitle'),
      content: t('app.recUnbalancedMessage'),
      icon: 'warning',
      buttons: [
        { id: 'adjust', label: t('app.recCreateAdjustment') },
        { id: 'continue', label: t('app.recContinueReconciling'), isDefault: true },
      ],
    });
    if (button !== 'adjust') return;
    createAdjustment = true;
  }
  const done = await attempt(() =>
    host.call('reconcile.finish', {
      accountId: account.id,
      statementDate: r.statementDate,
      target: r.target,
      createAdjustment,
      texts: reconcileTexts(),
    }),
  );
  if (done.ok) reg.stopReconcile();
}

// ----------------------------------------------------------------------------------- keys (10 §9)

const mac = window.app.shell.platform === 'darwin';
const inRegister = (target: EventTarget | null): boolean =>
  target instanceof Node && root.value?.contains(target) === true;
const inEditor = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('[data-editor]') !== null;
const inSearch = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('[data-register-search]') !== null;
const inScheduler = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('[data-scheduler]') !== null;
/** The row keys (Enter, Delete, ↑/↓, the letters) need focus in the grid, or nowhere (10 §9). */
const inGrid = (target: EventTarget | null): boolean =>
  target === document.body ||
  (target instanceof HTMLElement && target.closest('[data-register-grid]') !== null);

/** Edits the single selected transaction, starting in `field` (Enter/F2, and E, P, N, M: 10 §9). */
async function editSelected(field?: EditField): Promise<void> {
  const [only] = reg.selection;
  if (reg.selection.size === 1 && only) await reg.beginEdit(only, field);
}

/** M (10 §9): the amount field the transaction uses, Inflow for a deposit, otherwise Outflow. */
function amountField(): EditField {
  const [only] = reg.selectedRows;
  return only && only.amount > 0 ? 'inflow' : 'outflow';
}

/** E (10 §9): Change Date… for two or more, the Date field of the editor for one. */
function changeDate(): void {
  if (reg.selection.size >= 2) void grid.value?.runMenuItem('date');
  else void editSelected('date');
}

/** Single-letter keys in the grid (10 §9), most of them an actions menu item (10 §6.1). */
const LETTERS: Record<string, () => void> = {
  t: () => void reg.beginNew(),
  e: changeDate,
  p: () => void editSelected('payee'),
  n: () => void editSelected('notes'),
  m: () => void editSelected(amountField()),
  c: () => void grid.value?.runMenuItem('categorize'),
  a: () => void grid.value?.runMenuItem('move'),
  l: () => {
    if (reg.canEdit) void toggleCleared(reg.selectedRows);
  },
  v: () => {
    if (reg.canEdit) void approveSelection();
  },
  s: () => void grid.value?.runMenuItem('recurring'),
  g: () => void grid.value?.runMenuItem('match'),
  d: () => {
    if (reg.canEdit && reg.selection.size > 0) void deleteTransactions(reg.selectedRows);
  },
};

async function approveSelection(): Promise<void> {
  const editing = reg.editor?.id ?? null;
  if (editing && reg.editor) {
    // The row being edited: approve it, then move the editor on (10 §6.1).
    await reg.commit('approveNext');
    return;
  }
  await approve(reg.selectedRows);
}

/** Keys with focus in the scheduler pane (10 §9): Enter/F2 edit, Delete removes, no confirmation. */
function onSchedulerKey(e: KeyboardEvent): boolean {
  if (inEditor(e.target) || isTextInput(e.target)) return false;
  if ((e.key === 'Enter' || e.key === 'F2') && !e.altKey) {
    const [only] = sched.selection;
    if (sched.selection.size === 1 && only) void sched.openEditor({ id: only });
    return true;
  }
  if (e.key === 'Delete' || (mac && e.key === 'Backspace')) {
    if (reg.canEdit && sched.selection.size > 0) void sched.remove([...sched.selection]);
    return true;
  }
  return false;
}

function onKey(e: KeyboardEvent): boolean {
  if (!props.shown || (!inRegister(e.target) && e.target !== document.body)) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key;
  const text = isTextInput(e.target);
  if (ctrl && !e.shiftKey && key.toLowerCase() === 'n') {
    void reg.beginNew();
    return true;
  }
  if (ctrl && !e.shiftKey && key.toLowerCase() === 'f') {
    toolbar.value?.focusSearch();
    return true;
  }
  if (inScheduler(e.target)) return onSchedulerKey(e);
  if (inEditor(e.target)) return false;
  if (key === 'F5') {
    reg.applySort();
    return true;
  }
  if (inSearch(e.target)) return false;
  if (ctrl && !e.shiftKey && key.toLowerCase() === 'a' && !text) {
    // Selects every row, or clears the selection when every row is already selected.
    const all = reg.shown.length > 0 && reg.selection.size === reg.shown.length;
    reg.selectAll(!all);
    return true;
  }
  if (ctrl && e.shiftKey && key.toLowerCase() === 'c') {
    if (reg.canEdit) void toggleCleared(reg.selectedRows);
    return true;
  }
  // While the Undo notifier shows, Ctrl+Z outside a text field is its Undo (10 §5).
  if (ctrl && !e.shiftKey && key.toLowerCase() === 'z' && !text && session.state.undo) {
    void runUndo();
    return true;
  }
  if (text || !inGrid(e.target)) return false;
  if ((key === 'Enter' || key === 'F2') && !e.altKey) {
    void editSelected();
    return true;
  }
  if (key === 'Delete' || (mac && key === 'Backspace')) {
    if (reg.canEdit && reg.selection.size > 0) void deleteTransactions(reg.selectedRows);
    return true;
  }
  const lower = key.toLowerCase();
  const down = key === 'ArrowDown' || (lower === 'j' && !ctrl && !e.altKey);
  if (down || key === 'ArrowUp' || (lower === 'k' && !ctrl && !e.altKey)) {
    const id = reg.moveSelection(down ? 1 : -1, e.shiftKey);
    if (id) grid.value?.setFocus(id);
    return true;
  }
  const letter = !ctrl && !e.altKey && !e.shiftKey ? LETTERS[lower] : undefined;
  if (letter) {
    letter();
    return true;
  }
  return false;
}

// ----------------------------------------------------------------------------------- File menu

const runImport = (): Promise<void> => importTransactions(reg.isAll ? null : props.accountId);
const runExport = (): Promise<void> => exportData({ screen: 'register', register: reg });
const runPrint = (): Promise<void> => printRegister(reg);

const cleanups: (() => void)[] = [];
onMounted(() => {
  cleanups.push(keyboard.push(onKey));
  if (toolbarRegion.value)
    cleanups.push(keyboard.registerRegion('register-toolbar', 40, toolbarRegion.value));
  if (footerRegion.value)
    cleanups.push(keyboard.registerRegion('register-footer', 60, footerRegion.value));
  cleanups.push(
    commands.register('view.goPayeeSettings', async () => {
      const [first] = reg.selectedRows;
      await openPayeeSettings(first?.payeeId ? { id: first.payeeId } : null);
    }),
    commands.register('file.importTransactions', runImport),
    commands.register('file.export', runExport),
    commands.register('file.print', runPrint),
  );
  document.addEventListener('pointerdown', onDocumentPointer, true);
  const el = root.value;
  if (el) {
    const update = (): void => {
      const rem = remPx();
      // The register's minimum (19 rem) plus the pane's (10 §1).
      fits.value = el.clientHeight >= (19 + SCHEDULER_MIN_H) * rem;
    };
    update();
    resize = new ResizeObserver(update);
    resize.observe(el);
  }
});
onBeforeUnmount(() => {
  for (const c of cleanups) c();
  resize?.disconnect();
  document.removeEventListener('pointerdown', onDocumentPointer, true);
  dismissUndo();
});
</script>

<template>
  <section ref="root" class="register" :class="{ 'is-forced': forced && paneShown }">
    <!-- A single account's heading is in its account header, once the account is known (22 §4.1). -->
    <PanelHeading
      v-if="reg.isAll || !reg.account"
      :text="reg.isAll ? t('app.sidebarAllAccounts') : ''"
      :ready="shown"
    />
    <div
      ref="toolbarRegion"
      class="register__top"
      role="region"
      :aria-label="t('a11y.regionToolbar')"
    >
      <AccountHeader v-if="!reg.isAll && reg.account" :account="reg.account" :ready="shown" />
      <p v-if="reconcilingTitle" class="register__reconciling">{{ reconcilingTitle }}</p>
      <NotifierStrip @undo="runUndo" />
      <RegisterToolbar ref="toolbar" @menu="grid?.openMenu(false)" @import="runImport" />
    </div>
    <SearchInfoBar />
    <RegisterGrid ref="grid" />
    <div ref="footerRegion" class="register__bottom">
      <ReconcileFooter
        v-if="reg.reconciling"
        @finish="finishReconcile"
        @adjust="startReconcile"
        @stop="reg.stopReconcile()"
      />
      <RegisterFooter
        v-else
        :scheduler-shown="paneShown"
        :scheduled-count="scheduledCount"
        @toggle-scheduler="toggleScheduler"
        @reconcile="startReconcile"
      />
    </div>
    <div
      class="register__scheduler"
      :class="{ 'is-dragging': dragHeight !== null }"
      :style="{ height: paneShown ? `${String(paneHeight)}rem` : '0' }"
    >
      <template v-if="paneShown">
        <div
          :ref="bindSplitter"
          class="register__splitter"
          role="separator"
          tabindex="0"
          aria-orientation="horizontal"
          :aria-label="t('a11y.splitterScheduler')"
          :aria-valuenow="Math.round(paneHeight)"
          :aria-valuemin="SCHEDULER_MIN_H"
        />
        <SchedulerPane @entered="onEntered" />
      </template>
    </div>
  </section>
</template>

<style scoped>
.register {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 19rem;
  padding: var(--space-1) var(--space-3) 0;
  box-sizing: border-box;
}

.register__reconciling {
  margin: 0;
  padding: 0 var(--space-3) var(--space-2);
  color: var(--text-strong);
  font-size: var(--font-lg);
  font-weight: 600;
}

.register.is-forced {
  overflow-y: auto;
}

.register__scheduler {
  display: flex;
  flex: none;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  transition: height 300ms ease-out;
}

.register__scheduler.is-dragging {
  transition: none;
}

.register__splitter {
  flex: none;
  height: var(--space-2);
  cursor: row-resize;
}

.register__splitter:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .register__scheduler {
    transition: none;
  }
}
</style>
