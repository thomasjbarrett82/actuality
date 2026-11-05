import { describe, expect, it } from 'vitest';
import { canEdit, CONNECTION_STATES } from './connection';
import {
  appSettingsPatchSchema,
  DEFAULT_APP_SETTINGS,
  DEFAULT_BUDGET_SETTINGS,
  parseAppSettings,
  parseBudgetSettings,
} from './settings';

describe('settings (19)', () => {
  it('fills every key with its default', () => {
    expect(parseAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings([])).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseBudgetSettings(null)).toEqual(DEFAULT_BUDGET_SETTINGS);
  });

  it('ignores the reports settings of earlier versions (19 §2)', () => {
    const legacy = { reports: { lastReport: 'netWorth', perReport: {} } };
    expect(parseBudgetSettings(legacy)).toEqual(DEFAULT_BUDGET_SETTINGS);
  });

  it('keeps valid saved report filters and drops invalid ones (15 §3, 19 §2)', () => {
    const filters = {
      categories: { kind: 'all' },
      timeframe: { kind: 'preset', preset: 'latest3' },
      payees: { kind: 'ids', ids: ['p1'] },
      accounts: { kind: 'onBudget' },
    };
    const s = parseBudgetSettings({
      reports: {
        savedFiltersByPage: {
          summary: [
            { page: 'summary', name: 'Mine', filters },
            { page: 'summary', name: '  ', filters },
            { page: 'breakdown', name: 'Wrong page', filters },
            {
              page: 'summary',
              name: 'Bad range',
              filters: {
                ...filters,
                timeframe: { kind: 'custom', start: '2026-10-31', end: '2026-10-01' },
              },
            },
          ],
          netWorth: [
            {
              page: 'netWorth',
              name: 'Assets',
              filters: { timeframe: filters.timeframe, accounts: filters.accounts },
              options: { mode: 'multiline', includeNegative: false },
            },
          ],
          crossover: [{ page: 'crossover', name: 'Gone', filters }],
        },
      },
    });
    expect(s.reports.savedFiltersByPage.summary?.map((f) => f.name)).toEqual(['Mine']);
    // Saved before Include negative accounts was retired: it still loads, without the option.
    expect(s.reports.savedFiltersByPage.netWorth).toEqual([
      expect.objectContaining({ name: 'Assets', options: { mode: 'multiline' } }),
    ]);
    expect(Object.keys(s.reports.savedFiltersByPage).sort()).toEqual(['netWorth', 'summary']);
  });

  it('keeps valid keys and replaces only the invalid ones', () => {
    const s = parseAppSettings({
      zoomFactor: 1.5,
      appearance: 'neon',
      serverUrl: 'https://x',
      unknown: 1,
    });
    expect(s.zoomFactor).toBe(1.5);
    expect(s.appearance).toBe('system');
    expect(s.serverUrl).toBe('https://x');
    expect('unknown' in s).toBe(false);
  });

  it('reads the register sort as a key list or, from earlier versions, a single key (19 §2)', () => {
    const accounts = parseBudgetSettings({
      register: {
        showPreImportDialog: true,
        accounts: {
          a: { mainSort: { field: 'payee', desc: true } },
          b: {
            mainSort: [
              { field: 'payee', desc: true, extra: 1 },
              { field: 'date', desc: false },
            ],
          },
        },
      },
    }).register.accounts;
    expect(accounts['a']?.mainSort).toEqual({ field: 'payee', desc: true });
    expect(accounts['b']?.mainSort).toEqual([
      { field: 'payee', desc: true },
      { field: 'date', desc: false },
    ]);
  });

  it('has the documented defaults', () => {
    expect(DEFAULT_APP_SETTINGS.openLastBudgetOnStartup).toBe(true);
    expect(DEFAULT_APP_SETTINGS.autofillCategory).toBe(true);
    expect(DEFAULT_APP_SETTINGS.autofillNotes).toBe(false);
    expect(DEFAULT_APP_SETTINGS.zoomFactor).toBe(1);
    expect(DEFAULT_APP_SETTINGS.privacyMode).toBe(false);
    expect(DEFAULT_BUDGET_SETTINGS.budget.categoryColumnWidth).toBe(14.5);
  });

  it('validates patches strictly', () => {
    expect(appSettingsPatchSchema.safeParse({ zoomFactor: 3 }).success).toBe(false);
    expect(appSettingsPatchSchema.safeParse({ nope: true }).success).toBe(false);
    expect(appSettingsPatchSchema.safeParse({ zoomFactor: 1.2 }).success).toBe(true);
  });
});

describe('connection (03 §5.3)', () => {
  it('allows writes only while Online or Syncing', () => {
    expect(CONNECTION_STATES.filter(canEdit)).toEqual(['Online', 'Syncing']);
  });
});
