// Report components (15 §2–3, §4.3, §8; 22 §4): the picker's draft, search and visible-only bulk actions,
// the Timeframe callout's month and year selects, the Compare Period callout's draft, the saved-filter name
// rules, the expandable table and the chart's keyboard tooltip.
import type { ISODate } from '@shared/domain/types';
import { DEFAULT_MONEY_SETTINGS } from '@shared/money';
import type { ComparisonOptions, Timeframe } from '@shared/reporting/model';
import { describe, expect, it } from 'vitest';
import { axe, mountApp } from '../../testing/mount';
import ComparePeriodCallout from './ComparePeriodCallout.vue';
import LineChart from './LineChart.vue';
import ReportTable from './ReportTable.vue';
import ReportTimeframeCallout from './ReportTimeframeCallout.vue';
import SaveFilterDialog from './SaveFilterDialog.vue';
import SelectionCallout from './SelectionCallout.vue';

const ENTRIES = [
  {
    id: 'g1',
    label: 'Bills',
    children: [
      { id: 'c1', label: 'Rent' },
      { id: 'c2', label: 'Power' },
    ],
  },
  { id: 'g2', label: 'Food', children: [{ id: 'c3', label: 'Groceries' }] },
  { id: 'uncategorized', label: 'Uncategorized' },
];

const closed = (w: { emitted: (e: string) => unknown[][] | undefined }): unknown =>
  w.emitted('close')?.at(-1)?.[0];

describe('SelectionCallout (15 §2.1)', () => {
  it('commits a draft: all, some, or none', async () => {
    const w = mountApp(SelectionCallout, {
      props: { entries: ENTRIES, selected: { kind: 'all' }, searchLabel: 'Search Categories' },
    });
    const done = w.findAll('button').find((b) => b.text() === 'Done');
    await done?.trigger('click');
    expect(JSON.parse(closed(w) as string)).toEqual({ kind: 'all' });
    await w
      .findAll('button')
      .find((b) => b.text() === 'Select None')
      ?.trigger('click');
    await done?.trigger('click');
    expect(JSON.parse(closed(w) as string)).toEqual({ kind: 'ids', ids: [] });
    await w
      .findAll('button')
      .find((b) => b.text() === 'Cancel')
      ?.trigger('click');
    expect(closed(w)).toBe('cancel');
  });

  it('searches case-insensitively; bulk actions and groups touch only visible matches', async () => {
    const w = mountApp(SelectionCallout, {
      props: { entries: ENTRIES, selected: { kind: 'all' }, searchLabel: 'Search Categories' },
    });
    expect(document.activeElement).toBe(w.get('input[type="search"]').element);
    await w.get('input[type="search"]').setValue('POW');
    expect(w.text()).toContain('Power');
    expect(w.text()).not.toContain('Rent');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Select None')
      ?.trigger('click');
    await w.get('input[type="search"]').setValue('');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Done')
      ?.trigger('click');
    expect(JSON.parse(closed(w) as string)).toEqual({
      kind: 'ids',
      ids: ['c1', 'c3', 'uncategorized'],
    });
    await w.get('input[type="search"]').setValue('zzz');
    expect(w.get('[role="status"]').text()).toBe('Nothing matches the search.');
  });

  it('ticks a group with its members, and reads the on-budget default back', async () => {
    const accounts = [
      {
        id: 'on',
        label: 'Budget Accounts',
        children: [
          { id: 'a1', label: 'Checking' },
          { id: 'a2', label: 'Card' },
        ],
      },
      { id: 'off', label: 'Off-Budget Accounts', children: [{ id: 'a3', label: 'House' }] },
    ];
    const w = mountApp(SelectionCallout, {
      props: {
        entries: accounts,
        selected: { kind: 'onBudget' },
        onBudget: ['a1', 'a2'],
        searchLabel: 'Search Accounts',
      },
    });
    const done = w.findAll('button').find((b) => b.text() === 'Done');
    await done?.trigger('click');
    expect(JSON.parse(closed(w) as string)).toEqual({ kind: 'onBudget' });
    const off = w.findAll('label').find((l) => l.text() === 'Off-Budget Accounts');
    await off?.get('input').trigger('change');
    await done?.trigger('click');
    expect(JSON.parse(closed(w) as string)).toEqual({ kind: 'all' });
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });
});

describe('ReportTimeframeCallout (15 §2.2)', () => {
  const props = (current: Timeframe) => ({
    current,
    fromYear: 2006,
    toYear: 2027,
    today: '2026-10-15' as ISODate,
  });
  const button = (w: ReturnType<typeof mountApp>, text: string) =>
    w.findAll('button').find((b) => b.text() === text);

  it('shows From: and To: as separate month and year selects, and underlines the preset', async () => {
    const w = mountApp(ReportTimeframeCallout, {
      props: props({ kind: 'preset', preset: 'latest3' }),
    });
    expect(w.findAll('[role="radio"]').map((r) => r.text())).toEqual([
      'This Month',
      'Latest 3 Months',
      'This Year',
      'Last Year',
      'All Dates',
    ]);
    expect(w.get('[aria-checked="true"]').text()).toBe('Latest 3 Months');
    expect(w.text()).toContain('From:');
    expect(w.text()).toContain('To:');
    expect(w.text()).not.toContain('Through:');
    const value = (label: string) =>
      (w.get(`select[aria-label="${label}"]`).element as HTMLSelectElement).value;
    expect([value('From month'), value('From year'), value('To month'), value('To year')]).toEqual([
      '8',
      '2026',
      '10',
      '2026',
    ]);
    expect(w.get('select[aria-label="From month"] option[value="8"]').text()).toBe('August');
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });

  it('commits a custom range of inclusive months, swapped when From is later than To', async () => {
    const w = mountApp(ReportTimeframeCallout, {
      props: props({ kind: 'preset', preset: 'thisMonth' }),
    });
    await w.get('select[aria-label="From year"]').setValue('2027');
    await w.get('select[aria-label="To month"]').setValue('2');
    expect(w.find('[aria-checked="true"]').exists()).toBe(false);
    await button(w, 'Done')?.trigger('click');
    expect(JSON.parse(closed(w) as string)).toEqual({
      kind: 'custom',
      start: '2026-02-01',
      end: '2027-10-31',
    });
  });

  it('commits a preset, or cancels', async () => {
    const w = mountApp(ReportTimeframeCallout, {
      props: props({ kind: 'preset', preset: 'thisYear' }),
    });
    await button(w, 'Done')?.trigger('click');
    expect(JSON.parse(closed(w) as string)).toEqual({ kind: 'preset', preset: 'thisYear' });
    await button(w, 'Last Year')?.trigger('click');
    expect((w.get('select[aria-label="From year"]').element as HTMLSelectElement).value).toBe(
      '2025',
    );
    await button(w, 'Done')?.trigger('click');
    expect(JSON.parse(closed(w) as string)).toEqual({ kind: 'preset', preset: 'lastYear' });
    await button(w, 'Cancel')?.trigger('click');
    expect(closed(w)).toBe('cancel');
  });
});

describe('ComparePeriodCallout (15 §4.3)', () => {
  const props = (current: ComparisonOptions) => ({
    current,
    today: '2026-10-15' as ISODate,
    weekStart: 0 as const,
    dateFormat: 'MM/dd/yyyy',
  });
  const button = (w: ReturnType<typeof mountApp>, text: string) =>
    w.findAll('button').find((b) => b.text() === text);
  const period = (w: ReturnType<typeof mountApp>) => w.get('select');
  const selectedText = (w: ReturnType<typeof mountApp>): string => {
    const select = period(w).element as HTMLSelectElement;
    return select.options[select.selectedIndex]?.text ?? '';
  };

  it('opens on Month and the current month, comparing it with the month before', async () => {
    const w = mountApp(ComparePeriodCallout, {
      props: props({ unit: 'month', start: '2026-10-01' }),
    });
    expect(w.findAll('[role="radio"]').map((r) => r.text())).toEqual([
      'Week',
      'Month',
      'Quarter',
      'Year',
    ]);
    expect(w.get('[aria-checked="true"]').text()).toBe('Month');
    expect(w.text()).toContain('Period:');
    expect(selectedText(w)).toBe('This Month (Oct 2026)');
    expect(w.text()).toContain('Compared with the previous period:');
    expect(w.get('.compare__previous strong').text()).toBe('Sep 2026');
    expect(w.text()).not.toContain('From:');
    expect(w.text()).not.toContain('Latest 3 Months');
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });

  it('previews a new unit or period in the draft and commits it on Done', async () => {
    const w = mountApp(ComparePeriodCallout, {
      props: props({ unit: 'month', start: '2026-10-01' }),
    });
    await button(w, 'Quarter')?.trigger('click');
    expect(selectedText(w)).toBe('This Quarter (Q4 2026)');
    expect(w.get('.compare__previous strong').text()).toBe('Q3 2026');
    await period(w).setValue('2026-04-01');
    expect(w.get('.compare__previous strong').text()).toBe('Q1 2026');
    // Week keeps to the same time: the last week of the chosen quarter. 2026-06-30 is a Tuesday.
    await button(w, 'Week')?.trigger('click');
    expect(selectedText(w)).toBe('Week of 06/28/2026');
    expect(w.get('.compare__previous strong').text()).toBe('Week of 06/21/2026');
    await button(w, 'Done')?.trigger('click');
    expect(JSON.parse(closed(w) as string)).toEqual({ unit: 'week', start: '2026-06-28' });
  });

  it('offers an older saved period, and cancels the draft', async () => {
    const w = mountApp(ComparePeriodCallout, {
      props: props({ unit: 'year', start: '1990-01-01' }),
    });
    expect(selectedText(w)).toBe('1990');
    expect(w.get('.compare__previous strong').text()).toBe('1989');
    expect(w.findAll('option')[0]?.text()).toBe('This Year (2026)');
    await button(w, 'Month')?.trigger('click');
    await button(w, 'Cancel')?.trigger('click');
    expect(closed(w)).toBe('cancel');
  });
});

describe('SaveFilterDialog (15 §3)', () => {
  it('refuses empty and case-insensitive duplicate names', async () => {
    const w = mountApp(SaveFilterDialog, {
      props: { title: 'Save Filters', button: 'Save', initial: '', taken: ['Groceries'] },
    });
    const save = (): HTMLButtonElement =>
      w.findAll('button').find((b) => b.text() === 'Save')?.element as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await w.get('input').setValue(' groceries ');
    expect(save().disabled).toBe(true);
    expect(w.text()).toContain('This report already has a saved filter named “groceries”.');
    await w.get('input').setValue('  Bills  ');
    expect(save().disabled).toBe(false);
    save().click();
    expect(closed(w)).toBe('Bills');
  });
});

describe('ReportTable (15 §7)', () => {
  it('expands a row with its disclosure button and names unavailable cells', async () => {
    const w = mountApp(ReportTable, {
      props: {
        caption: 'Spending',
        columns: ['Category', 'Sep', 'Oct'],
        money: DEFAULT_MONEY_SETTINGS,
        rows: [
          {
            key: 'g1',
            label: 'Bills',
            cells: [
              { kind: 'money', value: -1000 },
              { kind: 'money', value: null },
            ],
            children: [
              {
                key: 'c1',
                label: 'Rent',
                cells: [
                  { kind: 'money', value: -1000 },
                  { kind: 'money', value: null },
                ],
              },
            ],
          },
        ],
      },
    });
    const toggle = w.get('button[aria-expanded]');
    expect(w.find('.neg').exists()).toBe(true);
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(w.text()).not.toContain('Rent');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(w.text()).toContain('Rent');
    expect(w.findAll('[aria-label="Unavailable"]')).toHaveLength(2);
    expect(w.get('caption').text()).toBe('Spending');
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });

  it('can show negative spending without the negative-money color', () => {
    const w = mountApp(ReportTable, {
      props: {
        caption: 'Spending',
        columns: ['Category', 'Total'],
        money: DEFAULT_MONEY_SETTINGS,
        negativeMoneyColor: false,
        rows: [
          {
            key: 'refund',
            label: 'Refunds',
            cells: [{ kind: 'money', value: -1000 }],
          },
        ],
      },
    });
    expect(w.text()).toContain('-10.00');
    expect(w.find('.neg').exists()).toBe(false);
  });
});

describe('LineChart (15 §8, 22 §4.1)', () => {
  it('is an image with a name and description whose tooltip follows the keyboard', async () => {
    const w = mountApp(LineChart, {
      props: {
        count: 3,
        xLabel: (i: number) => `Day ${String(i + 1)}`,
        series: [
          { key: 'a', label: 'Current', color: 'red', shape: 'circle', values: [1, 2, null] },
          {
            key: 'b',
            label: 'Previous',
            color: 'blue',
            shape: 'square',
            values: [1, 3, 4],
            dashed: true,
          },
        ],
        format: (v: number) => `$${String(v)}`,
        label: 'Spending comparison',
        description: 'Cumulative spending',
      },
    });
    const svg = w.get('svg[role="img"]');
    expect(svg.attributes('aria-label')).toBe('Spending comparison');
    expect(document.getElementById(svg.attributes('aria-describedby') ?? '')?.textContent).toBe(
      'Cumulative spending',
    );
    await svg.trigger('focus');
    expect(w.get('[role="tooltip"]').text()).toContain('Day 1');
    await svg.trigger('keydown', { key: 'End' });
    const tip = w.get('[role="tooltip"]').text();
    expect(tip).toContain('Day 3');
    expect(tip).toContain('—');
    expect(tip).toContain('$4');
    await svg.trigger('blur');
    expect(w.find('[role="tooltip"]').exists()).toBe(false);
  });
});
