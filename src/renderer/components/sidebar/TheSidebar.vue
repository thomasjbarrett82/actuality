<script setup lang="ts">
// The sidebar (08): Budget, Reports and All Accounts; the Budget, Off-Budget and Closed account groups
// with balances and error badges; Add Account and the compact toggle; the notifications bell (24 §4.5), the
// privacy mode toggle, the server web link and the connection indicator. It is a
// tree for the keyboard (22 §2.3) with Move Up / Down as the drag alternatives (22 §2.4). Accounts are
// reordered within their group by drag-and-drop (08 §4). An account's menu (right-click or Shift+F10)
// has its actions (08 §2.2), which the Edit menu also runs for the active account (06 §4).
import { groupOf, type AccountGroup } from '@shared/domain/accounts';
import type { Account } from '@shared/domain/types';
import type { ContextMenuItem } from '@shared/shell-api';
import { useQueryClient } from '@tanstack/vue-query';
import {
  ChartPie,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CornerDownRight,
  Landmark,
  Plus,
  Wallet,
  type LucideIcon,
} from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { announce } from '../../a11y/announcer';
import { closeAccountFlow, createAccount } from '../../accounts/dialogs';
import { moveAccount, reopenAccount, takeClosedHere } from '../../accounts/flows';
import { requestHeaderAction } from '../../accounts/header-request';
import { commands } from '../../commands';
import { keyboard } from '../../keyboard/dispatcher';
import { moneyLabel, moneyText } from '../../money-display';
import { accountsQuery, useAccounts, useBudgetFormat } from '../../queries/budget-data';
import { useAppStore } from '../../stores/app';
import { useBudgetSettings } from '../../stores/budget-settings';
import { useCanEdit } from '../../stores/connection';
import { useSettings } from '../../stores/settings';
import MoneyAmount from '../common/MoneyAmount.vue';
import ConnectionIndicator from './ConnectionIndicator.vue';
import ErrorBadge from './ErrorBadge.vue';
import NotificationsBell from './NotificationsBell.vue';
import PrivacyToggle from './PrivacyToggle.vue';
import ServerWebLink from './ServerWebLink.vue';
import {
  applyMove,
  buildSidebar,
  groupShown,
  moveWithinGroup,
  nextSelection,
  toSidebarAccount,
  typeahead,
  type SidebarAccount,
} from './sidebar-model';
import { useAccountDrag } from './use-account-drag';

/** At this zoom and above the sidebar is compact, whatever `sidebarExpanded` says (22 §5). */
const AUTO_COMPACT_ZOOM = 1.5;
const TYPEAHEAD_RESET_MS = 500;

const { t } = useI18n();
const app = useAppStore();
const settings = useSettings();
const budgetSettings = useBudgetSettings();
const canEdit = useCanEdit();
const accountsQ = useAccounts();
const budgetFormat = useBudgetFormat();
const queryClient = useQueryClient();

const accounts = computed(() => accountsQ.data.value ?? []);
const vm = computed(() => buildSidebar(accounts.value.map(toSidebarAccount)));
const autoCompact = computed(() => settings.app.zoomFactor >= AUTO_COMPACT_ZOOM);
/** The toggle expanded the sidebar at a zoom that makes it compact (22 §5): until the zoom drops, not saved. */
const expandedAtZoom = ref(false);
watch(autoCompact, (on) => {
  if (!on) expandedAtZoom.value = false;
});
const compact = computed(
  () => !settings.app.sidebarExpanded || (autoCompact.value && !expandedAtZoom.value),
);
const money = computed(() => budgetFormat.value.money);

// ---------------------------------------------------------------------------- elements

const nav = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const groupsArea = ref<HTMLElement | null>(null);
const indicatorRow = ref<HTMLElement | null>(null);
const rowEls = new Map<string, HTMLElement>();
function rowRef(key: string): (el: unknown) => void {
  return (el) => {
    if (el instanceof HTMLElement) rowEls.set(key, el);
    else rowEls.delete(key);
  };
}

// ---------------------------------------------------------------------------- drag-and-drop

async function move(account: Account, beforeId: string | null): Promise<void> {
  // Show the result straight away; the host's data:changed refetch confirms it.
  queryClient.setQueryData(accountsQuery.queryKey, applyMove(accounts.value, account.id, beforeId));
  if (!(await moveAccount(account, beforeId)))
    await queryClient.invalidateQueries({ queryKey: accountsQuery.queryKey });
}

function listOf(group: AccountGroup, without: string | null): SidebarAccount[] {
  return vm.value.groups[group].accounts.filter((a) => a.id !== without);
}

const {
  drag,
  start: startDrag,
  consumeClick,
} = useAccountDrag({
  scroller,
  groupsArea,
  canDrag: () => canEdit.value,
  onDrop: (id, from, to) => {
    // Only within its own group (08 §4); the drag offers no other hint.
    if (from.group !== to.group || from.index === to.index) return;
    const account = accounts.value.find((a) => a.id === id);
    if (!account) return;
    const beforeId = listOf(to.group, id)[to.index]?.id ?? null;
    void move(account, beforeId);
  },
});
const dragging = computed(() => drag.value !== null);
const draggedAccount = computed(() =>
  drag.value
    ? vm.value.groups.onBudget.accounts
        .concat(vm.value.groups.offBudget.accounts, vm.value.groups.closed.accounts)
        .find((a) => a.id === drag.value?.id)
    : undefined,
);

// ---------------------------------------------------------------------------- groups

/** Closed is collapsed unless the selected account is in it (08 §2.3); not saved. */
const closedExpanded = ref(false);

function savedExpanded(group: AccountGroup): boolean {
  if (group === 'closed') return closedExpanded.value;
  const s = budgetSettings.settings;
  return group === 'onBudget' ? !s.onBudgetGroupCollapsed : !s.offBudgetGroupCollapsed;
}

/** An empty Budget Accounts is collapsed (08 §2.3). */
const expanded = computed<Record<AccountGroup, boolean>>(() => ({
  onBudget: savedExpanded('onBudget') && vm.value.groups.onBudget.accounts.length > 0,
  offBudget: savedExpanded('offBudget'),
  closed: savedExpanded('closed'),
}));

function setExpanded(group: AccountGroup, value: boolean): void {
  if (group === 'closed') closedExpanded.value = value;
  else
    void budgetSettings.patch(
      group === 'onBudget'
        ? { onBudgetGroupCollapsed: !value }
        : { offBudgetGroupCollapsed: !value },
    );
}

// ---------------------------------------------------------------------------- selection

const selectedAccount = computed(() =>
  app.screen === 'register' && app.activeAccountId !== 'all'
    ? accounts.value.find((a) => a.id === app.activeAccountId)
    : undefined,
);

const selectedKey = computed((): string | null => {
  if (app.screen === 'budget') return 'section:budget';
  if (app.screen === 'reports') return 'section:reports';
  if (app.screen !== 'register') return null;
  return app.activeAccountId === 'all' || app.activeAccountId === null
    ? 'section:all'
    : `account:${app.activeAccountId}`;
});

function select(target: string): void {
  if (target === 'all') app.toAllAccounts();
  else app.toAccount(target);
}

// The selected account's group opens, also after its own Close Account moved it to Closed (13 §4); Closed
// only while it holds the selection.
watch(
  () =>
    selectedAccount.value ? `${selectedAccount.value.id}:${groupOf(selectedAccount.value)}` : '',
  () => {
    const account = selectedAccount.value;
    closedExpanded.value = account?.closed === true;
    if (account && !expanded.value[groupOf(account)]) setExpanded(groupOf(account), true);
  },
  { immediate: true },
);

// A selected account that is deleted, or closed other than by its own Close Account here, hands the
// selection on (08 §2.3).
watch(accounts, (now, before) => {
  const id = selectedAccount.value?.id ?? (app.screen === 'register' ? app.activeAccountId : null);
  if (!id || id === 'all' || before.length === 0) return;
  const old = before.find((a) => a.id === id);
  if (!old) return;
  const current = now.find((a) => a.id === id);
  const closedNow = current !== undefined && current.closed && !old.closed;
  if (current && !closedNow) return;
  if (current && takeClosedHere(id)) return;
  const state = { ...toSidebarAccount(current ?? old), closed: true };
  select(nextSelection(vm.value, state, expanded.value));
});

/** Rows animate only once the first accounts are shown: the sidebar doesn't fill in with an animation. */
const animate = ref(false);
watch(
  () => accountsQ.data.value !== undefined,
  (loaded) => {
    if (loaded)
      void nextTick(() => {
        animate.value = true;
      });
  },
  { immediate: true },
);

/** A group is opening or closing: its rows animate faster than other row changes (08 §1). */
const toggling = ref(false);
let togglingTimer: ReturnType<typeof setTimeout> | null = null;

function toggleGroup(group: AccountGroup): void {
  if (group === 'onBudget' && vm.value.groups.onBudget.accounts.length === 0) return;
  toggling.value = true;
  if (togglingTimer) clearTimeout(togglingTimer);
  togglingTimer = setTimeout(() => {
    toggling.value = false;
  }, 300);
  const open = !expanded.value[group];
  const selected = selectedAccount.value;
  if (!open && selected && groupOf(selected) === group) {
    // The selected account's group collapses: selection moves on (08 §2.3).
    const after = { ...expanded.value, [group]: false };
    select(nextSelection(vm.value, toSidebarAccount(selected), after));
  }
  setExpanded(group, open);
}

// ---------------------------------------------------------------------------- rows

type Section = 'budget' | 'reports' | 'all';
type Row =
  | { kind: 'section'; key: string; section: Section; label: string; icon: LucideIcon }
  | { kind: 'group'; key: string; group: AccountGroup; label: string }
  | { kind: 'account'; key: string; account: SidebarAccount; group: AccountGroup; index: number }
  | { kind: 'hint'; key: string; group: AccountGroup };

const GROUP_LABELS: Record<AccountGroup, [string, string]> = {
  onBudget: ['app.sidebarOnBudget', 'app.sidebarOnBudgetCompact'],
  offBudget: ['app.sidebarOffBudget', 'app.sidebarOffBudgetCompact'],
  closed: ['app.sidebarClosed', 'app.sidebarClosedCompact'],
};

const groupLabel = (group: AccountGroup, short = compact.value): string =>
  t(GROUP_LABELS[group][short ? 1 : 0]);

const sectionRows = computed((): Row[] => [
  {
    kind: 'section',
    key: 'section:budget',
    section: 'budget',
    label: t('navigation.budget'),
    icon: Wallet,
  },
  {
    kind: 'section',
    key: 'section:reports',
    section: 'reports',
    label: t('navigation.reports'),
    icon: ChartPie,
  },
  {
    kind: 'section',
    key: 'section:all',
    section: 'all',
    label: compact.value ? t('navigation.allAccounts') : t('app.sidebarAllAccounts'),
    icon: Landmark,
  },
]);

const groupRows = computed((): Row[] => {
  const out: Row[] = [];
  const draggedId = drag.value?.id ?? null;
  for (const group of ['onBudget', 'offBudget', 'closed'] as const) {
    if (!groupShown(vm.value, group)) continue;
    out.push({ kind: 'group', key: `group:${group}`, group, label: groupLabel(group) });
    if (!expanded.value[group]) continue;
    const list = listOf(group, draggedId);
    const hint = drag.value?.hint;
    list.forEach((account, index) => {
      if (hint?.group === group && hint.index === index)
        out.push({ kind: 'hint', key: 'hint', group });
      out.push({ kind: 'account', key: `account:${account.id}`, account, group, index });
    });
    if (hint?.group === group && hint.index >= list.length)
      out.push({ kind: 'hint', key: 'hint', group });
  }
  return out;
});

/** The tree's items, for the keyboard. */
const items = computed(() =>
  [...sectionRows.value, ...groupRows.value].filter((r) => r.kind !== 'hint'),
);

const isSelected = (row: Row): boolean => row.key === selectedKey.value;

function activate(row: Row): void {
  if (row.kind === 'group') toggleGroup(row.group);
  else if (row.kind === 'section') {
    if (row.section === 'budget') app.toBudget();
    else if (row.section === 'reports') app.toReports();
    else app.toAllAccounts();
  } else if (row.kind === 'account') app.toAccount(row.account.id);
}

/**
 * A group row's element attributes: a tree item for a header or an account (roving `tabindex`, 22 §2.1),
 * with the drop-target hooks the drag reads (08 §4); the drop hint is hidden from assistive technology.
 * One element per row, so TransitionGroup sees every row by its key.
 */
function rowAttrs(row: Row): Record<string, string | number | boolean | undefined> {
  if (row.kind === 'hint') return { class: 'row row--hint', 'aria-hidden': 'true' };
  const common = { role: 'treeitem', tabindex: tabStop.value === row.key ? 0 : -1 };
  if (row.kind === 'group')
    return {
      ...common,
      class: 'row row--group',
      'aria-level': 1,
      'aria-expanded': expanded.value[row.group],
      'aria-selected': false,
      'data-drop-group': row.group,
    };
  if (row.kind !== 'account') return common;
  const selected = isSelected(row);
  return {
    ...common,
    class: `row row--account${selected ? ' row--selected' : ''}${canEdit.value ? ' row--draggable' : ''}`,
    'aria-level': 2,
    'aria-selected': selected,
    'data-drop-group': row.group,
    'data-drop-index': row.index,
    'data-account-id': row.account.id,
  };
}

function onRowClick(row: Row): void {
  if (row.kind === 'account' && consumeClick()) return;
  activate(row);
}

function onPointerDown(e: PointerEvent, row: Row): void {
  if (row.kind === 'account') startDrag(e, row.account.id, { group: row.group, index: row.index });
}

function balanceOf(row: Row): number {
  if (row.kind === 'section') return vm.value.allAccountsBalance;
  if (row.kind === 'group') return vm.value.groups[row.group].total;
  if (row.kind === 'account') return row.account.workingBalance;
  return 0;
}

function accountTooltip(a: SidebarAccount): string {
  const head = t('app.sidebarAccountTooltip', {
    name: a.name,
    balance: moneyText(a.workingBalance, money.value, { symbol: true }),
  });
  return a.note ? `${head}\n\n${a.note}` : head;
}

/** The text only assistive technology reads after a row's visible label: the full amount, then the badge's sentence (22 §4.3). */
function accountSpoken(a: SidebarAccount): string {
  const parts = [moneyLabel(a.workingBalance, money.value, { symbol: true })];
  if (a.attention.count > 0) parts.push(t('a11y.sidebarBadge', a.attention.count));
  return `, ${parts.join(', ')}`;
}

function groupSpoken(group: AccountGroup): string {
  if (compact.value) return '';
  const g = vm.value.groups[group];
  const parts = [moneyLabel(g.total, money.value, { symbol: true })];
  if (g.accounts.length > 0 && g.attention.count > 0)
    parts.push(t('a11y.sidebarBadge', g.attention.count));
  return `, ${parts.join(', ')}`;
}

// ---------------------------------------------------------------------------- keyboard (22 §2.3)

const focusKey = ref<string | null>(null);
const tabStop = computed(() => {
  const keys = items.value.map((r) => r.key);
  if (focusKey.value && keys.includes(focusKey.value)) return focusKey.value;
  if (selectedKey.value && keys.includes(selectedKey.value)) return selectedKey.value;
  return keys[0] ?? null;
});

function focusRow(key: string | undefined): void {
  if (!key) return;
  focusKey.value = key;
  void nextTick(() => rowEls.get(key)?.focus());
}

let typed = '';
let typedTimer: ReturnType<typeof setTimeout> | null = null;

function moveBy(row: Row, direction: -1 | 1): void {
  if (row.kind !== 'account' || !canEdit.value) return;
  const beforeId = moveWithinGroup(listOf(row.group, null), row.account.id, direction);
  const account = accounts.value.find((a) => a.id === row.account.id);
  if (beforeId === undefined || !account) return;
  void move(account, beforeId).then(() => {
    focusRow(row.key);
  });
}

function onRowKey(e: KeyboardEvent, row: Row): void {
  const list = items.value;
  const i = list.findIndex((r) => r.key === row.key);
  const handled = (): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    handled();
    moveBy(row, e.key === 'ArrowUp' ? -1 : 1);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case 'ArrowDown':
      handled();
      focusRow(list[Math.min(i + 1, list.length - 1)]?.key);
      return;
    case 'ArrowUp':
      handled();
      focusRow(list[Math.max(i - 1, 0)]?.key);
      return;
    case 'Home':
      handled();
      focusRow(list[0]?.key);
      return;
    case 'End':
      handled();
      focusRow(list.at(-1)?.key);
      return;
    case 'ArrowLeft':
      handled();
      if (row.kind === 'group' && expanded.value[row.group]) toggleGroup(row.group);
      else if (row.kind === 'account') focusRow(`group:${row.group}`);
      return;
    case 'ArrowRight':
      handled();
      if (row.kind !== 'group') return;
      if (!expanded.value[row.group]) toggleGroup(row.group);
      else if (list[i + 1]?.kind === 'account') focusRow(list[i + 1]?.key);
      return;
    case 'Enter':
    case ' ':
      handled();
      activate(row);
      return;
  }
  if (e.key.length === 1 && e.key.trim() !== '') {
    handled();
    typed += e.key;
    if (typedTimer) clearTimeout(typedTimer);
    typedTimer = setTimeout(() => {
      typed = '';
    }, TYPEAHEAD_RESET_MS);
    const labels = list.map((r) =>
      r.kind === 'account' ? r.account.name : 'label' in r ? r.label : '',
    );
    const found = typeahead(labels, typed.length > 1 ? i - 1 : i, typed);
    if (found !== -1) focusRow(list[found]?.key);
  }
}

// ---------------------------------------------------------------------------- menus

/** Close Account / Re-open Account (13 §4), where it is, without navigating. */
async function closeOrReopen(account: Account): Promise<void> {
  if (account.closed) await reopenAccount(account);
  else await closeAccountFlow(account);
}

/** An account's menu, from a right-click or Shift+F10 (08 §2.2, 22 §2.3). */
async function onContextMenu(row: Row): Promise<void> {
  if (row.kind !== 'account') return;
  const account = accounts.value.find((a) => a.id === row.account.id);
  if (!account) return;
  const list = listOf(row.group, null);
  const at = list.findIndex((a) => a.id === account.id);
  const edit = canEdit.value;
  const items: ContextMenuItem[] = [
    { id: 'rename', label: t('app.accountMenuRename'), enabled: edit },
    { id: 'note', label: t('app.accountMenuNote'), enabled: edit },
    {
      id: 'closeOrReopen',
      label: t(account.closed ? 'accounts.reopenAccount' : 'accounts.closeAccount'),
      enabled: edit,
    },
    { id: 'separator' },
    { id: 'up', label: t('app.accountMenuMoveUp'), enabled: edit && at > 0 },
    { id: 'down', label: t('app.accountMenuMoveDown'), enabled: edit && at < list.length - 1 },
  ];
  const choice = await window.app.shell.showContextMenu(items);
  if (choice === 'rename') await requestHeaderAction(account.id, 'rename');
  else if (choice === 'note') await requestHeaderAction(account.id, 'note');
  else if (choice === 'closeOrReopen') await closeOrReopen(account);
  else if (choice === 'up') moveBy(row, -1);
  else if (choice === 'down') moveBy(row, 1);
}

function addAccount(): void {
  if (canEdit.value) void createAccount();
}

const toggleLabel = computed(() => t(compact.value ? 'app.sidebarExpand' : 'app.sidebarCollapse'));

/**
 * The toggle acts on the sidebar as shown. At a zoom that makes it compact, expanding overrides that for
 * now and collapsing returns to it; the saved setting changes only when it is what keeps it compact.
 */
function toggleCompact(): void {
  const expand = compact.value;
  if (autoCompact.value) expandedAtZoom.value = expand;
  if (expand !== settings.app.sidebarExpanded && (expand || !autoCompact.value))
    void settings.set('sidebarExpanded', expand);
}

// ---------------------------------------------------------------------------- scrolling (08 §1)

/** The scrollbar shows when the content doesn't fit, and hides once it fits with --space-4 to spare. */
const scrolling = ref(false);
const maskTop = ref(false);
const maskBottom = ref(false);
let indicatorHeight = 0;

function remPx(name: string): number {
  const root = getComputedStyle(document.documentElement);
  return Number.parseFloat(root.getPropertyValue(name)) * Number.parseFloat(root.fontSize);
}

function measure(): void {
  const el = scroller.value;
  const inner = content.value;
  if (!el || !inner) return;
  if (indicatorRow.value) indicatorHeight = indicatorRow.value.offsetHeight;
  const needed = inner.offsetHeight;
  if (!scrolling.value && needed > el.clientHeight + 1) scrolling.value = true;
  else if (scrolling.value && needed + remPx('--space-4') + indicatorHeight <= el.clientHeight)
    scrolling.value = false;
  maskTop.value = scrolling.value && el.scrollTop > 0;
  maskBottom.value = scrolling.value && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}

let observer: ResizeObserver | null = null;
const cleanups: (() => void)[] = [];

onMounted(() => {
  observer = new ResizeObserver(() => {
    measure();
  });
  if (nav.value) observer.observe(nav.value);
  if (content.value) observer.observe(content.value);
  if (nav.value) cleanups.push(keyboard.registerRegion('sidebar', 10, nav.value));
  cleanups.push(
    commands.register('view.toggleSidebar', toggleCompact),
    // The Edit menu's account items act on the active account (06 §4, 13 §3–4).
    commands.register('edit.renameAccount', async () => {
      if (selectedAccount.value) await requestHeaderAction(selectedAccount.value.id, 'rename');
    }),
    commands.register('edit.editAccountNote', async () => {
      if (selectedAccount.value) await requestHeaderAction(selectedAccount.value.id, 'note');
    }),
    commands.register('edit.closeAccount', async () => {
      const account = selectedAccount.value;
      if (account && !account.closed && canEdit.value) await closeAccountFlow(account);
    }),
    commands.register('edit.reopenAccount', async () => {
      const account = selectedAccount.value;
      if (account?.closed && canEdit.value) await reopenAccount(account);
    }),
    commands.register('view.goAccounts', () => {
      // The active account's register: nothing if there's none, or it's closed and hidden (06 §4).
      const id = app.lastRegisterAccountId;
      if (id === 'all') app.toAllAccounts();
      const account = accounts.value.find((a) => a.id === id);
      if (account && (!account.closed || expanded.value.closed)) app.toAccount(account.id);
    }),
  );
});

onBeforeUnmount(() => {
  observer?.disconnect();
  for (const c of cleanups) c();
  if (typedTimer) clearTimeout(typedTimer);
  if (togglingTimer) clearTimeout(togglingTimer);
});

watch([groupRows, compact], () => void nextTick(measure));
// The button's own pressed state is announced by the screen reader; the menu and shortcut get the live region.
watch(
  () => app.privacyMode,
  (on) => {
    if (document.activeElement?.closest('[data-privacy-toggle]')) return;
    announce(t(on ? 'a11y.privacyOn' : 'a11y.privacyOff'));
  },
);
</script>

<template>
  <nav
    ref="nav"
    class="sidebar on-blue"
    :class="{ 'sidebar--compact': compact }"
    :aria-label="t('a11y.regionNav')"
  >
    <div
      ref="scroller"
      class="sidebar__scroll"
      :class="{
        'sidebar__scroll--scrolling': scrolling,
        'sidebar__scroll--mask-top': maskTop,
        'sidebar__scroll--mask-bottom': maskBottom,
      }"
      @scroll="measure"
    >
      <div ref="content" class="sidebar__content">
        <div role="tree" class="tree" :aria-label="t('a11y.accountsTree')">
          <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -- roving tabindex (22 §2.1): the bound tabindex is 0 or -1 -->
          <div
            v-for="row in sectionRows"
            :key="row.key"
            :ref="rowRef(row.key)"
            role="treeitem"
            class="row row--section"
            :class="{ 'row--selected': isSelected(row) }"
            :tabindex="tabStop === row.key ? 0 : -1"
            aria-level="1"
            :aria-selected="isSelected(row)"
            @click="onRowClick(row)"
            @keydown="onRowKey($event, row)"
            @focus="focusKey = row.key"
          >
            <template v-if="row.kind === 'section'">
              <component :is="row.icon" class="row__icon" aria-hidden="true" />
              <span v-tooltip.truncated="row.label" class="row__label">{{ row.label }}</span>
              <span
                v-if="row.section === 'all' && !compact"
                class="row__balance"
                :class="{ 'row__balance--negative': balanceOf(row) < 0 }"
                ><MoneyAmount :value="balanceOf(row)" :settings="money" symbol
              /></span>
            </template>
          </div>
          <div ref="groupsArea" role="none" class="tree__groups">
            <TransitionGroup
              tag="div"
              name="row"
              class="tree__rows"
              :css="animate && !dragging"
              :class="{ 'tree__rows--toggling': toggling }"
            >
              <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- role="treeitem" and the roving tabindex come from rowAttrs() (22 §2.3) -->
              <div
                v-for="row in groupRows"
                :key="row.key"
                :ref="row.kind === 'hint' ? undefined : rowRef(row.key)"
                v-tooltip="row.kind === 'account' ? accountTooltip(row.account) : null"
                v-bind="rowAttrs(row)"
                @pointerdown="onPointerDown($event, row)"
                @click="onRowClick(row)"
                @contextmenu.prevent="onContextMenu(row)"
                @keydown="onRowKey($event, row)"
                @focus="focusKey = row.key"
              >
                <CornerDownRight v-if="row.kind === 'hint'" class="row__icon-sm" />
                <template v-else-if="row.kind === 'group'">
                  <component
                    :is="expanded[row.group] ? ChevronDown : ChevronRight"
                    class="row__icon-sm"
                    aria-hidden="true"
                  />
                  <span v-tooltip.truncated="row.label" class="row__label row__label--group">{{
                    row.label
                  }}</span
                  ><span class="visually-hidden">{{ groupSpoken(row.group) }}</span>
                  <!-- The name comes from the content (22 §4.3): the badge and amount are hidden from it, and the spoken text follows the label. -->
                  <ErrorBadge
                    v-if="
                      !compact &&
                      vm.groups[row.group].accounts.length > 0 &&
                      vm.groups[row.group].attention.count > 0
                    "
                    :count="vm.groups[row.group].attention.count"
                    :level="vm.groups[row.group].attention.maxLevel"
                    decorative
                  />
                  {{ ' '
                  }}<span
                    v-if="!compact"
                    class="row__balance row__balance--group"
                    :class="{ 'row__balance--negative': balanceOf(row) < 0 }"
                    aria-hidden="true"
                    ><MoneyAmount :value="balanceOf(row)" :settings="money" symbol
                  /></span>
                </template>
                <template v-else-if="row.kind === 'account'">
                  <ErrorBadge
                    v-if="row.account.attention.count > 0"
                    class="row__badge"
                    :count="row.account.attention.count"
                    :level="row.account.attention.maxLevel"
                    :selected="isSelected(row)"
                    decorative
                  />
                  <span class="row__label row__label--account">{{ row.account.name }}</span
                  ><span class="visually-hidden">{{ accountSpoken(row.account) }}</span
                  >{{ ' '
                  }}<span
                    v-if="!compact"
                    class="row__balance row__balance--account"
                    :class="{ 'row__balance--negative': row.account.workingBalance < 0 }"
                    aria-hidden="true"
                    ><MoneyAmount :value="row.account.workingBalance" :settings="money"
                  /></span>
                </template>
              </div>
            </TransitionGroup>
          </div>
        </div>
        <div class="sidebar__add-row">
          <template v-if="scrolling">
            <NotificationsBell />
            <PrivacyToggle />
            <ServerWebLink />
            <ConnectionIndicator :show-label="false" />
          </template>
          <button
            v-tooltip="
              canEdit
                ? compact
                  ? t('navigation.addAccountCompact')
                  : null
                : t('app.editingUnavailableOffline')
            "
            type="button"
            class="add"
            :aria-disabled="!canEdit"
            :aria-label="compact ? t('navigation.addAccountCompact') : undefined"
            @click="addAccount"
          >
            <Plus class="row__icon-sm" aria-hidden="true" />
            <span v-if="!compact">{{ t('navigation.addAccount') }}</span>
          </button>
          <template v-if="scrolling">
            <span class="sidebar__spacer" />
            <button
              v-tooltip="toggleLabel"
              type="button"
              class="toggle"
              :aria-label="toggleLabel"
              :aria-pressed="compact"
              @click="toggleCompact"
            >
              <component
                :is="compact ? ChevronsRight : ChevronsLeft"
                class="row__icon-sm"
                aria-hidden="true"
              />
            </button>
          </template>
        </div>
      </div>
    </div>
    <div v-if="!scrolling" ref="indicatorRow" class="sidebar__indicator">
      <NotificationsBell />
      <PrivacyToggle />
      <ServerWebLink />
      <ConnectionIndicator :show-label="!compact" />
      <span class="sidebar__spacer" />
      <button
        v-tooltip="toggleLabel"
        type="button"
        class="toggle"
        :aria-label="toggleLabel"
        :aria-pressed="compact"
        @click="toggleCompact"
      >
        <component
          :is="compact ? ChevronsRight : ChevronsLeft"
          class="row__icon-sm"
          aria-hidden="true"
        />
      </button>
    </div>
    <Teleport to="body">
      <div
        v-if="drag && draggedAccount"
        class="drag-proxy on-blue"
        :style="{ left: `${drag.x}px`, top: `${drag.y}px`, width: `${drag.width}px` }"
        aria-hidden="true"
      >
        <span class="row__label row__label--account">{{ draggedAccount.name }}</span>
        <span v-if="!compact" class="row__balance row__balance--account"
          ><MoneyAmount :value="draggedAccount.workingBalance" :settings="money"
        /></span>
      </div>
    </Teleport>
  </nav>
</template>

<style scoped>
.sidebar {
  --row-w: var(--sidebar-w);

  display: flex;
  flex: none;
  flex-direction: column;
  height: 100%;
  padding: var(--space-4) 0 var(--space-4) var(--space-3);
  background: var(--app-bg);
  color: var(--text-on-blue);
  user-select: none;
}

.sidebar--compact {
  --row-w: var(--sidebar-w-compact);
}

.sidebar__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.sidebar__scroll--scrolling {
  overflow-y: scroll;
}

.sidebar__scroll--mask-top {
  mask-image: linear-gradient(to bottom, transparent, var(--text-on-blue) var(--row-h-lg));
}

.sidebar__scroll--mask-bottom {
  mask-image: linear-gradient(to top, transparent, var(--text-on-blue) var(--row-h-lg));
}

.sidebar__scroll--mask-top.sidebar__scroll--mask-bottom {
  mask-image: linear-gradient(
    to bottom,
    transparent,
    var(--text-on-blue) var(--row-h-lg),
    var(--text-on-blue) calc(100% - var(--row-h-lg)),
    transparent
  );
}

.tree {
  display: flex;
  flex-direction: column;
}

.row {
  position: relative;
  display: flex;
  gap: var(--space-2);
  align-items: center;
  width: var(--row-w);
  min-height: max(var(--row-h), var(--hit-min));
  margin-right: var(--space-1);
  padding: 0 var(--space-4) 0 var(--space-3);
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  cursor: pointer;
  transition: background-color 200ms ease;
}

.row:hover {
  background: color-mix(in srgb, var(--text-on-blue) 12%, transparent);
}

.row--section {
  min-height: max(var(--row-h-lg), var(--hit-min));
  font-size: var(--font-lg);
  font-weight: 600;
}

.tree__groups {
  margin-top: var(--space-3);
}

.tree__rows {
  display: flex;
  flex-direction: column;
}

/* Rows fade and change height as they come and go: 200 ms; a whole group 250 ms; a group opening grows
   then fades in, and closing fades then shrinks, 100 ms in all (08 §1). Not on the first fill and not
   while dragging: the TransitionGroup's `css` is off then. */
.row-enter-active,
.row-leave-active {
  overflow: hidden;
  transition:
    opacity 200ms ease,
    max-height 200ms ease,
    min-height 200ms ease;
}

.row-enter-from,
.row-leave-to {
  max-height: 0;
  min-height: 0;
  opacity: 0;
}

.row-enter-to,
.row-leave-from {
  max-height: calc(var(--row-h-lg) * 2);
}

.row--group.row-enter-active,
.row--group.row-leave-active {
  transition-duration: 250ms;
}

.tree__rows--toggling .row-enter-active {
  transition:
    max-height 50ms ease,
    min-height 50ms ease,
    opacity 50ms ease 50ms;
}

.tree__rows--toggling .row-leave-active {
  transition:
    opacity 50ms ease,
    max-height 50ms ease 50ms,
    min-height 50ms ease 50ms;
}

.row--hint.row-enter-active,
.row--hint.row-leave-active {
  transition: none;
}

/* The selected button is a white tab that joins the panel (08 §2.1). */
.row--selected,
.row--selected:hover {
  width: calc(var(--row-w) + var(--space-1));
  margin-right: 0;
  padding-left: calc(var(--space-3) * 2);
  background: var(--panel-bg);
  color: var(--text);
}

/* The white tab needs the normal ring: the sidebar's white one wouldn't show on it (22 §3). */
.row--selected:focus-visible {
  outline-color: var(--focus-ring);
}

.row--group {
  padding-right: var(--space-4);
  font-size: var(--font-md);
  font-style: italic;
  font-weight: 700;
}

.row--account {
  --name-start: var(--space-7);

  padding-left: var(--name-start);
  font-size: var(--font-md);
  font-weight: 600;
}

.row--selected.row--account {
  --name-start: calc(var(--space-7) + var(--space-3));
}

.row--draggable {
  touch-action: none;
}

.row--hint {
  justify-content: center;
  border: 1px dashed color-mix(in srgb, var(--text-on-blue) 60%, transparent);
  cursor: default;
}

.row__icon {
  flex: none;
  width: var(--icon);
  height: var(--icon);
}

.row__icon-sm {
  flex: none;
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.row__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__label--group {
  flex: 0 1 auto;
  padding-left: var(--space-1);
}

/* The badge sits at the left edge of the name (08 §2.2), clear of its first letter. */
.row__badge {
  position: absolute;
  right: calc(100% - var(--name-start) + var(--space-1));
}

.row__balance {
  flex: none;
  margin-left: auto;
  font-size: var(--font-body);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.row__balance--group {
  padding-left: var(--space-3);
  font-size: var(--font-md);
  font-style: italic;
  font-weight: 700;
}

.row__balance--negative {
  color: var(--negative-on-blue);
}

.row--selected .row__balance--negative {
  color: var(--money-negative);
}

.sidebar__add-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
  width: var(--row-w);
  min-height: max(var(--row-h), var(--hit-min));
  margin-top: var(--space-3);
}

.sidebar__spacer {
  flex: 1;
}

.add,
.toggle {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: center;
  min-width: max(var(--row-h), var(--hit-min));
  min-height: max(var(--row-h), var(--hit-min));
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-on-blue);
  font-size: var(--font-md);
  cursor: pointer;
}

.add:hover,
.toggle:hover {
  background: color-mix(in srgb, var(--text-on-blue) 12%, transparent);
}

.add[aria-disabled='true'] {
  opacity: 0.55;
  cursor: default;
}

.sidebar__indicator {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
  width: var(--row-w);
  padding-top: var(--space-3);
}

.drag-proxy {
  position: fixed;
  z-index: 97;
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-4) 0 var(--space-6);
  border-radius: var(--radius-sm);
  background: var(--app-bg);
  color: var(--text-on-blue);
  font-size: var(--font-md);
  font-weight: 600;
  opacity: 0.6;
  pointer-events: none;
}
</style>
