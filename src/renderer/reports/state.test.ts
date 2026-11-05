// Saved report filters (15 §3, 19 §2): the definitions each page saves, Replace, Rename and Delete matching
// names without regard to case, pruning ids that no longer exist, and the Saved Filters menu that drives
// them, with its dialogs and announcements.
import type { SavedFilter } from '@shared/reporting/model';
import { DEFAULT_BUDGET_SETTINGS, type BudgetSettings } from '@shared/settings';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { liveRegions } from '../a11y/announcer';
import { useBudgetSettings } from '../stores/budget-settings';
import { useCallouts } from '../stores/callouts';
import { answerCallout, answerDialog, answerModal } from '../testing/fixtures';
import {
  pickComparePeriod,
  pickSelection,
  pickTimeframe,
  savedFiltersMenu,
  useLinked,
} from './report-flow';
import { definitionOf, foldName, useReportsView } from './state';

const ids = (...list: string[]) => ({ kind: 'ids' as const, ids: list });
const YEAR = { kind: 'preset', preset: 'thisYear' } as const;

beforeEach(() => {
  vi.spyOn(window.app.shell.settings, 'patchBudget').mockImplementation((_id, patch) =>
    Promise.resolve({ ...useBudgetSettings().settings, ...patch } as BudgetSettings),
  );
  useBudgetSettings().cloudFileId = 'c1';
  useBudgetSettings().settings = structuredClone(DEFAULT_BUDGET_SETTINGS);
});

describe('saved definitions (15 §3)', () => {
  const filters = {
    categories: ids('c2', 'c1'),
    timeframe: YEAR,
    payees: { kind: 'all' as const },
    accounts: { kind: 'onBudget' as const },
  };
  const breakdown = { groupBy: 'month', stackBy: 'categoryGroup', drillGroupId: null } as const;
  const comparison = { unit: 'quarter', start: '2026-07-01' } as const;
  const netWorth = { mode: 'multiline' } as const;

  it('keeps only the filters each page shows, with sorted ids', () => {
    expect(definitionOf('summary', 'S', filters, breakdown, comparison, netWorth)).toEqual({
      page: 'summary',
      name: 'S',
      filters: { ...filters, categories: ids('c1', 'c2') },
    });
    expect(definitionOf('comparison', 'C', filters, breakdown, comparison, netWorth)).toEqual({
      page: 'comparison',
      name: 'C',
      filters: {
        categories: ids('c1', 'c2'),
        payees: { kind: 'all' },
        accounts: { kind: 'onBudget' },
      },
      options: comparison,
    });
    expect(definitionOf('netWorth', 'N', filters, breakdown, comparison, netWorth)).toEqual({
      page: 'netWorth',
      name: 'N',
      filters: { timeframe: YEAR, accounts: { kind: 'onBudget' } },
      options: netWorth,
    });
    expect(definitionOf('breakdown', 'B', filters, breakdown, comparison, netWorth)).toMatchObject({
      options: breakdown,
    });
  });

  it('folds names for comparison', () => {
    expect(foldName('  Groceries ')).toBe(foldName('groceries'));
  });

  it('replaces, renames and deletes by name without regard to case', async () => {
    const view = useReportsView();
    view.setFilters('summary', { timeframe: YEAR });
    await view.save('summary', '  Year ');
    await view.save('summary', 'Other');
    expect(view.saved('summary').map((d) => d.name)).toEqual(['Year', 'Other']);

    view.setFilters('summary', { categories: ids('c9') });
    await view.replace('summary', 'YEAR');
    expect(view.saved('summary')[0]).toMatchObject({
      name: 'Year',
      filters: { categories: ids('c9'), timeframe: YEAR },
    });

    await view.rename('summary', 'year', ' This Year ');
    expect(view.saved('summary').map((d) => d.name)).toEqual(['This Year', 'Other']);

    await view.remove('summary', 'OTHER');
    expect(view.saved('summary').map((d) => d.name)).toEqual(['This Year']);
  });

  it('prunes ids that no longer exist from every page shape, writing only when something went (19 §2)', async () => {
    const all = { kind: 'all' as const };
    const list: Partial<Record<string, SavedFilter[]>> = {
      summary: [
        {
          page: 'summary',
          name: 'S',
          filters: { categories: ids('c1', 'gone'), timeframe: YEAR, payees: all, accounts: all },
        },
      ],
      comparison: [
        {
          page: 'comparison',
          name: 'C',
          filters: { categories: all, payees: ids('p1', 'gone'), accounts: all },
          options: { unit: 'month', start: '2026-10-01' },
        },
      ],
      netWorth: [
        {
          page: 'netWorth',
          name: 'N',
          filters: { timeframe: YEAR, accounts: ids('a1', 'gone') },
          options: { mode: 'single' },
        },
      ],
    };
    useBudgetSettings().settings = {
      ...structuredClone(DEFAULT_BUDGET_SETTINGS),
      reports: { savedFiltersByPage: list },
    };
    const view = useReportsView();
    // The spy beforeEach set up.
    const patch = vi.spyOn(window.app.shell.settings, 'patchBudget');

    await view.prune(new Set(['c1', 'p1', 'a1', 'gone']));
    expect(patch).not.toHaveBeenCalled();

    await view.prune(new Set(['c1', 'p1', 'a1']));
    expect(patch).toHaveBeenCalledTimes(1);
    expect(view.saved('summary')[0]?.filters).toMatchObject({ categories: ids('c1') });
    expect(view.saved('comparison')[0]?.filters).toMatchObject({ payees: ids('p1') });
    expect(view.saved('netWorth')[0]?.filters).toEqual({ timeframe: YEAR, accounts: ids('a1') });
  });
});

describe('the Saved Filters menu (15 §3)', () => {
  const anchor = () => document.body.appendChild(document.createElement('button'));
  /** Opens the menu and picks `result` in the callout; `done` settles when the menu's action has. */
  async function pick(result: string): Promise<{ done: Promise<void> }> {
    const done = savedFiltersMenu('summary', anchor());
    await answerCallout(result);
    return { done };
  }
  const said = async (): Promise<string> => {
    await flushPromises();
    return liveRegions.polite;
  };

  beforeEach(async () => {
    const view = useReportsView();
    await view.save('summary', 'Mine');
    view.setFilters('summary', { timeframe: YEAR });
    await view.save('summary', 'Year');
  });

  it('lists the names and marks the one matching the current selections', async () => {
    const done = savedFiltersMenu('summary', anchor());
    await flushPromises();
    expect(useCallouts().open[0]?.props).toMatchObject({ names: ['Mine', 'Year'], match: 1 });
    await answerCallout('');
    await done;
  });

  it('saves the current selections under a new name, refusing taken names', async () => {
    const { done } = await pick('save');
    const props = await answerModal('Fresh');
    await done;
    expect(props).toMatchObject({ initial: '', taken: ['Mine', 'Year'] });
    expect(
      useReportsView()
        .saved('summary')
        .map((d) => d.name),
    ).toEqual(['Mine', 'Year', 'Fresh']);
    expect(await said()).toContain('Fresh');
  });

  it('saves nothing when the name dialog is cancelled', async () => {
    const { done } = await pick('save');
    await answerModal(null);
    await done;
    expect(useReportsView().saved('summary')).toHaveLength(2);
  });

  it('loads a definition into the page as an override', async () => {
    await (
      await pick('load:0')
    ).done;
    const view = useReportsView();
    expect(view.isOverride('summary')).toBe(true);
    expect(view.matching('summary')?.name).toBe('Mine');
    expect(await said()).toBe('Saved filter “Mine” loaded.');
  });

  it('replaces a definition with the current selections', async () => {
    const view = useReportsView();
    view.setFilters('summary', { categories: ids('c1') });
    await (
      await pick('replace:0')
    ).done;
    expect(view.saved('summary')[0]).toMatchObject({
      name: 'Mine',
      filters: { categories: ids('c1') },
    });
  });

  it('renames with the old name filled in and only the other names taken', async () => {
    const { done } = await pick('rename:1');
    const props = await answerModal('Calendar Year');
    await done;
    expect(props).toMatchObject({ initial: 'Year', taken: ['Mine'] });
    expect(
      useReportsView()
        .saved('summary')
        .map((d) => d.name),
    ).toEqual(['Mine', 'Calendar Year']);
  });

  it('keeps the name when Rename is cancelled', async () => {
    const { done } = await pick('rename:1');
    await answerModal(null);
    await done;
    expect(
      useReportsView()
        .saved('summary')
        .map((d) => d.name),
    ).toEqual(['Mine', 'Year']);
  });

  it('deletes only after the confirmation', async () => {
    let { done } = await pick('delete:0');
    await answerDialog('cancel');
    await done;
    expect(useReportsView().saved('summary')).toHaveLength(2);
    ({ done } = await pick('delete:0'));
    const options = await answerDialog('delete');
    await done;
    expect(options.instruction).toContain('Mine');
    expect(
      useReportsView()
        .saved('summary')
        .map((d) => d.name),
    ).toEqual(['Year']);
  });

  it('ignores an index that is gone', async () => {
    await (
      await pick('load:7')
    ).done;
    expect(useReportsView().isOverride('summary')).toBe(false);
  });
});

describe('the filter pickers (15 §2)', () => {
  const anchor = () => document.body.appendChild(document.createElement('button'));

  it('applies a selection on Done to the linked filters, and announces it', async () => {
    const done = pickSelection('summary', 'payees', anchor(), [], 'Payees');
    await answerCallout(JSON.stringify(ids('p1')));
    await done;
    const view = useReportsView();
    expect(view.filtersOf('inflowOutflow').payees).toEqual(ids('p1'));
    await flushPromises();
    expect(liveRegions.polite).toBe('Filters applied to Summary.');
  });

  it('passes the on-budget account ids to the accounts picker', async () => {
    const done = pickSelection('summary', 'accounts', anchor(), [], 'Accounts', ['a1']);
    await flushPromises();
    expect(useCallouts().open[0]?.props).toMatchObject({ onBudget: ['a1'] });
    await answerCallout('');
    await done;
  });

  it('changes nothing when a picker is cancelled', async () => {
    const view = useReportsView();
    const before = view.filtersOf('summary');
    let done = pickTimeframe('summary', anchor(), '2026-10-20');
    await answerCallout('');
    await done;
    done = pickSelection('summary', 'categories', anchor(), [], 'Categories');
    await answerCallout('');
    await done;
    expect(view.filtersOf('summary')).toEqual(before);
  });

  it('offers twenty years back through next year in the Timeframe picker', async () => {
    const done = pickTimeframe('summary', anchor(), '2026-10-20');
    await flushPromises();
    expect(useCallouts().open[0]?.props).toMatchObject({ fromYear: 2006, toYear: 2027 });
    await answerCallout(JSON.stringify(YEAR));
    await done;
    expect(useReportsView().filtersOf('summary').timeframe).toEqual(YEAR);
  });

  it("sets Comparison's Compare Period without touching the linked Timeframe", async () => {
    const view = useReportsView();
    const timeframe = view.filtersOf('summary').timeframe;
    const q3 = { unit: 'quarter', start: '2026-07-01' };
    let done = pickComparePeriod(anchor(), '2026-10-20', 'MM/dd/yyyy');
    await answerCallout('');
    await done;
    expect(view.comparison).not.toEqual(q3);
    done = pickComparePeriod(anchor(), '2026-10-20', 'MM/dd/yyyy');
    await answerCallout(JSON.stringify(q3));
    await done;
    expect(view.comparison).toEqual(q3);
    expect(view.filtersOf('summary').timeframe).toEqual(timeframe);
  });

  it('Use linked filters drops the override and says so', async () => {
    const view = useReportsView();
    await view.save('breakdown', 'Mine');
    const [def] = view.saved('breakdown');
    if (!def) throw new Error('not saved');
    view.load(def);
    expect(view.isOverride('breakdown')).toBe(true);
    useLinked('breakdown');
    expect(view.isOverride('breakdown')).toBe(false);
    await flushPromises();
    expect(liveRegions.polite).toBe('Spending Breakdown uses the linked filters again.');
  });
});
