// The register's actions menu (10 §6.1): from Edit Transactions ▾ or a right-click on a row, as a native
// context menu. Every item that changes data is disabled offline.
import { bySortOrder } from '@shared/domain/accounts';
import type { Account, CategoryGroup, Id, ISODate, Transaction } from '@shared/domain/types';
import type { ContextMenuItem } from '@shared/shell-api';
import { openRuleFromTransaction } from '../rules/editor';
import {
  approve,
  canMatch,
  categorizeAs,
  changeDate,
  deleteTransactions,
  fromSplit,
  merge,
  moveToAccount,
  setCleared,
} from './actions';
import { tr, trn } from './dialogs';
import { openPayeeSettings, openRenamePayee } from './payee-dialogs';
import { openScheduleDialog } from './schedule-dialog';
import { useRegisterSession } from './view-state';

export interface MenuContext {
  rows: readonly Transaction[];
  /** The account shown, or null in All Accounts. */
  account: Account | null;
  accounts: readonly Account[];
  groups: readonly CategoryGroup[];
  canEdit: boolean;
  /** Right-click adds a disabled title (10 §6.1). */
  title: boolean;
  /** Today, for Move to scheduler… (only transactions dated after it) and Change Date…. */
  today: ISODate;
  /** The budget's date format, for Change Date…'s field (19 §1). */
  dateFormat: string;
  /** Change Date… is hidden while reconciling (10 §6.1). */
  reconciling: boolean;
}

/** What the register does after an item: select a row (a merge's result), or bring changed rows into view. */
export type MenuOutcome = { select: Id } | { reveal: readonly Id[] } | null;

const sep = (id: string): ContextMenuItem => ({ id });

/** The menu's items. Ids: `cleared`, `uncleared`, `approve`, `reject`, `cat:{id}`, `date`, … */
export function actionsMenu(ctx: MenuContext): ContextMenuItem[] {
  const { rows, canEdit } = ctx;
  const n = rows.length;
  const one = n === 1 ? rows[0] : undefined;
  const items: ContextMenuItem[] = [];
  if (ctx.title)
    items.push({ id: 'title', label: trn('app.regMenuTitle', n), enabled: false }, sep('s0'));
  items.push(
    {
      id: 'cleared',
      label: tr('app.regMarkCleared'),
      enabled: canEdit && rows.some((t) => t.cleared === 'U'),
    },
    {
      id: 'uncleared',
      label: tr('app.regMarkUncleared'),
      enabled: canEdit && rows.some((t) => t.cleared === 'C'),
    },
    sep('s1'),
    {
      id: 'approve',
      label: tr('app.regApprove'),
      enabled: canEdit && rows.some((t) => t.needsReview),
    },
    {
      id: 'reject',
      label: tr('app.regReject'),
      enabled: canEdit && rows.some((t) => t.needsReview),
    },
  );
  if (!ctx.account || ctx.account.onBudget) {
    const groups = [
      ...ctx.groups.filter((g) => g.isIncome),
      ...ctx.groups.filter((g) => !g.isIncome),
    ];
    items.push(sep('s2'), {
      id: 'categorize',
      label: tr('app.regCategorizeAs'),
      enabled: canEdit && n > 0,
      submenu: [
        ...groups
          .filter((g) => !g.hidden && g.categories.some((c) => !c.hidden))
          .map((g) => ({
            id: `group:${g.id}`,
            label: g.name,
            submenu: g.categories
              .filter((c) => !c.hidden)
              .map((c) => ({ id: `cat:${c.id}`, label: c.name })),
          })),
        { id: 'cat:none', label: tr('app.regNoCategory') },
      ],
    });
  }
  const renameable =
    one !== undefined &&
    one.payeeId !== null &&
    one.transferAccountId === null &&
    one.payeeName !== '';
  items.push(
    sep('s3'),
    { id: 'rename', label: tr('app.regRenameLike'), enabled: canEdit && renameable },
    { id: 'payeeSettings', label: tr('app.regPayeeSettings'), enabled: n > 0 },
    { id: 'createRule', label: tr('app.regCreateRule'), enabled: canEdit && one !== undefined },
    sep('s4'),
    { id: 'recurring', label: tr('app.regMakeRecurring'), enabled: canEdit && one !== undefined },
    {
      id: 'scheduler',
      label: tr('app.regMoveToScheduler'),
      enabled: canEdit && one !== undefined && one.date > ctx.today && !fromSplit(one),
    },
  );
  const current = new Set(rows.map((t) => t.accountId));
  const targets = ctx.accounts
    .filter((a) => !a.closed && !(current.size === 1 && current.has(a.id)))
    .sort((a, b) => a.name.localeCompare(b.name) || bySortOrder(a, b));
  items.push(sep('s5'));
  // With one selected the date is edited in the row (10 §6.1, X25).
  if (n >= 2 && !ctx.reconciling)
    items.push({ id: 'date', label: tr('app.regChangeDate'), enabled: canEdit });
  items.push({
    id: 'move',
    label: tr('app.regMoveToAccount'),
    // Transfers a split elsewhere created move from their split (10 §6.1).
    enabled: canEdit && n > 0 && targets.length > 0 && !rows.every(fromSplit),
    submenu: targets.map((a) => ({ id: `move:${a.id}`, label: a.name })),
  });
  items.push(
    sep('s6'),
    { id: 'match', label: tr('app.regMatch'), enabled: canEdit && canMatch(rows) },
    sep('s7'),
    { id: 'delete', label: tr('app.regDelete'), enabled: canEdit && n > 0 },
  );
  return items;
}

/** Runs a chosen item. Resolves with what the register does afterwards, if anything. */
export async function runAction(id: string, ctx: MenuContext): Promise<MenuOutcome> {
  const { rows } = ctx;
  if (id === 'cleared') await setCleared(rows, 'C');
  else if (id === 'uncleared') await setCleared(rows, 'U');
  else if (id === 'approve') await approve(rows);
  else if (id === 'reject') await deleteTransactions(rows.filter((t) => t.needsReview));
  else if (id.startsWith('cat:')) await categorizeAs(rows, id === 'cat:none' ? null : id.slice(4));
  else if (id === 'rename' && rows[0]?.payeeId) await openRenamePayee(rows[0].payeeId);
  else if (id === 'payeeSettings') {
    const first = rows[0];
    await openPayeeSettings(first?.payeeId ? { id: first.payeeId } : null);
  } else if (id === 'createRule' && rows[0]) {
    await openRuleFromTransaction(rows[0]);
  } else if (id === 'date') {
    const ids = await changeDate(rows, {
      today: ctx.today,
      dateFormat: ctx.dateFormat,
      accounts: ctx.accounts,
    });
    if (ids.length > 0) return { reveal: ids };
  } else if (id.startsWith('move:')) {
    const target = ctx.accounts.find((a) => a.id === id.slice(5));
    if (target) await moveToAccount(rows, target);
  } else if ((id === 'recurring' || id === 'scheduler') && rows[0]) {
    // Make recurring… / Move to scheduler… (12 §4): the Schedule dialog, pre-filled; after Add the panel
    // shows and selects the new schedule.
    const saved = await openScheduleDialog({
      kind: 'fromTransaction',
      transactionId: rows[0].id,
      mode: id === 'recurring' ? 'recurring' : 'move',
    });
    if (saved) useRegisterSession().state.scheduled = saved;
  } else if (id === 'match' && rows[0] && rows[1]) {
    const kept = await merge(rows[0], rows[1]);
    if (kept) return { select: kept };
  } else if (id === 'delete') await deleteTransactions(rows);
  return null;
}
