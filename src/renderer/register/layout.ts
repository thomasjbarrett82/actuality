// The register grid's column layout (10 §2): the visible columns in order, their widths in rem, and the
// CSS grid template the header, rows and editor share. Extra width is shared among the resizable columns.
import {
  DEFAULT_WIDTHS,
  REGISTER_COLUMNS,
  RESIZABLE_COLUMNS,
  type ColumnSetting,
  type RegisterColumn,
} from '@shared/domain/register';
import {
  SCHEDULER_COLUMNS,
  SCHEDULER_RESIZABLE,
  SCHEDULER_WIDTHS,
  type SchedulerColumn,
} from '@shared/domain/scheduler';

export interface ColumnLayout<F extends string = RegisterColumn> {
  field: F;
  width: number;
  resizable: boolean;
}

/** The Cleared column widens to 7 rem while reconciling (10 §2, 13 §6.2). */
export const RECONCILE_CLEARED_WIDTH = 7;

export function layoutOf(
  visible: ReadonlySet<RegisterColumn>,
  settings: readonly ColumnSetting[],
  reconciling = false,
): ColumnLayout[] {
  return REGISTER_COLUMNS.filter((c) => visible.has(c)).map((field) => {
    const resizable = RESIZABLE_COLUMNS.has(field);
    const saved = resizable ? settings.find((s) => s.field === field)?.width : undefined;
    const width =
      reconciling && field === 'cleared'
        ? RECONCILE_CLEARED_WIDTH
        : (saved ?? DEFAULT_WIDTHS[field]);
    return { field, width, resizable };
  });
}

/** The scheduler pane's layout (12 §3). */
export function schedulerLayoutOf(
  visible: ReadonlySet<SchedulerColumn>,
  settings: readonly ColumnSetting[],
): ColumnLayout<SchedulerColumn>[] {
  return SCHEDULER_COLUMNS.filter((c) => visible.has(c)).map((field) => {
    const resizable = SCHEDULER_RESIZABLE.has(field);
    const saved = resizable ? settings.find((s) => s.field === field)?.width : undefined;
    return { field, width: saved ?? SCHEDULER_WIDTHS[field], resizable };
  });
}

/** `grid-template-columns`: fixed columns at their width, resizable ones growing from theirs. */
export function gridTemplate(layout: readonly ColumnLayout<string>[]): string {
  return layout
    .map((c) =>
      c.resizable ? `minmax(${String(c.width)}rem, ${String(c.width)}fr)` : `${String(c.width)}rem`,
    )
    .join(' ');
}

/** The grid's minimum width in rem: below it the grid scrolls sideways. */
export const minWidth = (layout: readonly ColumnLayout<string>[]): number =>
  layout.reduce((s, c) => s + c.width, 0);
