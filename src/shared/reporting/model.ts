// The Reports filter and request model (15 §1–3): the five pages, their common filters, the page options
// and one report request. The zod schemas validate `reports.get` in the host (03 §8) and the saved filter
// definitions in the budget settings file (19 §2), so both read the same shapes.
import { z } from 'zod';
import type { WeekDay } from '../budget-format';
import { isISODate } from '../dates';
import type { Id, ISODate } from '../domain/types';

export const REPORT_PAGES = [
  'summary',
  'breakdown',
  'comparison',
  'inflowOutflow',
  'netWorth',
] as const;
export type ReportPage = (typeof REPORT_PAGES)[number];

/** The Timeframe presets (15 §2.2). */
export const RANGE_PRESETS = ['thisMonth', 'latest3', 'thisYear', 'lastYear', 'all'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** A preset resolves against today; a custom range is two inclusive dates (15 §2.2). */
export type Timeframe =
  { kind: 'preset'; preset: RangePreset } | { kind: 'custom'; start: ISODate; end: ISODate };

/** An id filter: everything, or the chosen ids (none when empty). */
export type Selection = { kind: 'all' } | { kind: 'ids'; ids: Id[] };

/** The Accounts filter adds its default: every open on-budget account (15 §2.2). */
export type AccountSelection = Selection | { kind: 'onBudget' };

/** The id of the Uncategorized choice in the Categories filter, and of payee-less sides in Payees. */
export const UNCATEGORIZED = 'uncategorized';
export const NO_PAYEE = 'none';

export interface CommonFilters {
  categories: Selection;
  timeframe: Timeframe;
  payees: Selection;
  accounts: AccountSelection;
}

/** The filters a flow report reads besides its dates: Comparison's, which has no Timeframe (15 §2.1). */
export type FlowFilters = Omit<CommonFilters, 'timeframe'>;

/** A calendar period's length: Breakdown's grouping and Comparison's unit (15 §4.2–4.3). */
export const PERIOD_UNITS = ['week', 'month', 'quarter', 'year'] as const;
export type PeriodUnit = (typeof PERIOD_UNITS)[number];
export type BreakdownGroupBy = PeriodUnit;
export const BREAKDOWN_STACK_BY = ['categoryGroup', 'payee', 'account'] as const;
export type BreakdownStackBy = (typeof BREAKDOWN_STACK_BY)[number];

/** Spending Breakdown's page options (15 §4.2). The drill is a category group id, or null. */
export interface BreakdownOptions {
  groupBy: BreakdownGroupBy;
  stackBy: BreakdownStackBy;
  drillGroupId: Id | null;
}

/**
 * Spending Comparison's Compare Period (15 §4.3): a unit and the first day of the calendar period compared
 * with the one before it. Page-specific, never the shared Timeframe.
 */
export interface ComparisonOptions {
  unit: PeriodUnit;
  start: ISODate;
}

/** Net Worth's page options (15 §4.5). `mode` is display only: the host computes both. */
export interface NetWorthOptions {
  mode: 'single' | 'multiline';
}

export const DEFAULT_TIMEFRAME: Timeframe = { kind: 'preset', preset: 'latest3' };

export const DEFAULT_FILTERS: CommonFilters = {
  categories: { kind: 'all' },
  timeframe: DEFAULT_TIMEFRAME,
  payees: { kind: 'all' },
  accounts: { kind: 'onBudget' },
};

export const DEFAULT_BREAKDOWN: BreakdownOptions = {
  groupBy: 'month',
  stackBy: 'categoryGroup',
  drillGroupId: null,
};

export const DEFAULT_NET_WORTH: NetWorthOptions = { mode: 'single' };

/** What the renderer's clock and the budget's week say, for presets and weekly periods. */
export interface ReportClock {
  today: ISODate;
  weekStart: WeekDay;
}

/** One `reports.get` request (03 §8): only the active report, with its effective committed filters. */
export type ReportRequest = ReportClock &
  (
    | { kind: 'summary'; filters: CommonFilters }
    | { kind: 'breakdown'; filters: CommonFilters; options: BreakdownOptions }
    | { kind: 'comparison'; filters: FlowFilters; options: ComparisonOptions }
    | { kind: 'inflowOutflow'; filters: CommonFilters }
    | { kind: 'netWorth'; filters: Pick<CommonFilters, 'timeframe' | 'accounts'> }
  );

// ---------------------------------------------------------------------------------------- schemas

const id = z.string().min(1).max(200);
const isoDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  .refine(isISODate, 'Not a calendar date.');
/** A selection holds at most this many ids: more than any budget's payees. */
const MAX_IDS = 100_000;

export const selectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('ids'), ids: z.array(id).max(MAX_IDS) }).strict(),
]);

export const accountSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('onBudget') }).strict(),
  z.object({ kind: z.literal('ids'), ids: z.array(id).max(MAX_IDS) }).strict(),
]);

export const timeframeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('preset'), preset: z.enum(RANGE_PRESETS) }).strict(),
    z.object({ kind: z.literal('custom'), start: isoDate, end: isoDate }).strict(),
  ])
  .refine((t) => t.kind === 'preset' || t.start <= t.end, 'The range starts after it ends.');

export const commonFiltersSchema = z
  .object({
    categories: selectionSchema,
    timeframe: timeframeSchema,
    payees: selectionSchema,
    accounts: accountSelectionSchema,
  })
  .strict();

const flowFiltersSchema = commonFiltersSchema.omit({ timeframe: true });

const netWorthFiltersSchema = z
  .object({ timeframe: timeframeSchema, accounts: accountSelectionSchema })
  .strict();

export const breakdownOptionsSchema = z
  .object({
    groupBy: z.enum(PERIOD_UNITS),
    stackBy: z.enum(BREAKDOWN_STACK_BY),
    drillGroupId: id.nullable(),
  })
  .strict();

const comparisonOptionsSchema = z.object({ unit: z.enum(PERIOD_UNITS), start: isoDate }).strict();

// Not strict, so a definition saved with an option since retired (Include negative accounts, Include
// off-budget accounts) still loads, without that key (19: unknown keys are dropped).
const netWorthOptionsSchema = z.object({ mode: z.enum(['single', 'multiline']) });

const clock = {
  today: isoDate,
  weekStart: z
    .number()
    .int()
    .min(0)
    .max(6)
    .transform((n) => n as WeekDay),
};

/** `reports.get` params (03 §8): a strict union; anything else is a `validation` error. */
export const reportRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('summary'), filters: commonFiltersSchema, ...clock }).strict(),
  z
    .object({
      kind: z.literal('breakdown'),
      filters: commonFiltersSchema,
      options: breakdownOptionsSchema,
      ...clock,
    })
    .strict(),
  z
    .object({
      kind: z.literal('comparison'),
      filters: flowFiltersSchema,
      options: comparisonOptionsSchema,
      ...clock,
    })
    .strict(),
  z.object({ kind: z.literal('inflowOutflow'), filters: commonFiltersSchema, ...clock }).strict(),
  z.object({ kind: z.literal('netWorth'), filters: netWorthFiltersSchema, ...clock }).strict(),
]);

// ---------------------------------------------------------------------------------------- saved filters

/** A saved filter's name: trimmed, non-empty (15 §3). */
export const SAVED_NAME_MAX = 100;

/**
 * A saved definition (15 §3): a name, the page's filters and its options. Comparison keeps its Compare
 * Period instead of a Timeframe; Net Worth omits Categories and Payees.
 */
export type SavedFilter =
  | {
      page: 'summary' | 'inflowOutflow';
      name: string;
      filters: CommonFilters;
    }
  | { page: 'breakdown'; name: string; filters: CommonFilters; options: BreakdownOptions }
  | { page: 'comparison'; name: string; filters: FlowFilters; options: ComparisonOptions }
  | {
      page: 'netWorth';
      name: string;
      filters: Pick<CommonFilters, 'timeframe' | 'accounts'>;
      options: NetWorthOptions;
    };

const savedName = z.string().trim().min(1).max(SAVED_NAME_MAX);

export const savedFilterSchema = z.discriminatedUnion('page', [
  z
    .object({
      page: z.enum(['summary', 'inflowOutflow']),
      name: savedName,
      filters: commonFiltersSchema,
    })
    .strict(),
  z
    .object({
      page: z.literal('breakdown'),
      name: savedName,
      filters: commonFiltersSchema,
      options: breakdownOptionsSchema,
    })
    .strict(),
  z
    .object({
      page: z.literal('comparison'),
      name: savedName,
      filters: flowFiltersSchema,
      options: comparisonOptionsSchema,
    })
    .strict(),
  z
    .object({
      page: z.literal('netWorth'),
      name: savedName,
      filters: netWorthFiltersSchema,
      options: netWorthOptionsSchema,
    })
    .strict(),
]);

/**
 * The saved definitions of every page, read tolerantly (19 §2): a definition with an unknown page, a bad
 * id, date range or option shape is dropped and the rest are kept.
 */
export function parseSavedFilters(raw: unknown): SavedFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedFilter[] = [];
  for (const item of raw) {
    const parsed = savedFilterSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
