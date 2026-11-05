// Shapes the report components exchange: a chart tooltip, a pie slice, a data table's rows and a picker's
// entries (15 §2, §7–8).
import type { Id, Money } from '@shared/domain/types';
import type { Shape } from './use-chart';

export interface ChartTip {
  title: string;
  rows: {
    key: string;
    label: string;
    value: string;
    color: string;
    shape: Shape;
    dashed?: boolean | undefined;
  }[];
}

export interface PieSlice {
  key: string;
  label: string;
  color: string;
  /** Basis points. */
  share: number;
}

export type TableCell = { kind: 'money'; value: Money | null } | { kind: 'text'; text: string };

export interface TableRow {
  key: string;
  label: string;
  swatch?: { color: string; shape: Shape; dashed?: boolean | undefined };
  cells: TableCell[];
  children?: TableRow[];
  tone?: 'group' | 'total' | 'section';
  /** A row action, such as drilling into a group. */
  action?: { label: string; run: () => void };
}

export interface PickerEntry {
  id: Id;
  label: string;
  /** A group's members; a group without them is a plain choice. */
  children?: { id: Id; label: string }[];
}
