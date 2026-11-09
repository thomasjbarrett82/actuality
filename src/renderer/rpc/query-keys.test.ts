import { QueryClient } from '@tanstack/vue-query';
import { describe, expect, it } from 'vitest';
import { invalidateTables, rootsFor } from './query-keys';

describe('scoped invalidation (03 §4.1)', () => {
  it('maps tables to the queries that read them, derived fields included', () => {
    expect(rootsFor(['transactions'])).toEqual(
      new Set(['register', 'budgetMonth', 'accounts', 'reports']),
    );
    // Register rows carry payee names; accounts carry transfer names and on/off-budget states.
    expect(rootsFor(['payees'])).toContain('register');
    expect(rootsFor(['accounts'])).toEqual(
      new Set(['accounts', 'register', 'budgetMonth', 'payees', 'reports']),
    );
    // Account notes, category notes and `ad:payees` are all notes.
    expect(rootsFor(['notes'])).toEqual(
      new Set(['notes', 'metadata', 'accounts', 'categories', 'payees']),
    );
    expect(rootsFor(['schedules'])).toEqual(new Set(['schedules', 'accounts', 'payees', 'rules']));
    expect(rootsFor(['preferences'])).toEqual(new Set(['prefs', 'reports']));
  });

  it('refreshes Reports for each table it reads, and only those (15 §7)', () => {
    const reads = [
      'transactions',
      'accounts',
      'categories',
      'category_groups',
      'category_mapping',
      'payees',
      'payee_mapping',
      'preferences',
    ];
    for (const table of reads) expect(rootsFor([table]), table).toContain('reports');
    for (const table of ['notes', 'schedules', 'rules', 'tags', 'zero_budgets', 'reflect_budgets'])
      expect(rootsFor([table]), table).not.toContain('reports');
  });

  it('unions several tables, and invalidates everything for an unknown one', () => {
    expect(rootsFor(['rules', 'preferences'])).toEqual(
      new Set(['payees', 'rules', 'prefs', 'reports']),
    );
    expect(rootsFor(['transactions', 'kvcache'])).toBe('all');
    expect(rootsFor(['*'])).toBe('all');
    expect(rootsFor([])).toEqual(new Set());
  });

  it('invalidates only the mapped roots', async () => {
    const client = new QueryClient();
    for (const root of ['register', 'payees', 'prefs', 'budgetList'])
      client.setQueryData([root, 'x'], 1);
    await invalidateTables(client, ['payees']);
    const stale = (root: string): boolean | undefined =>
      client.getQueryState([root, 'x'])?.isInvalidated;
    expect([stale('register'), stale('payees'), stale('prefs'), stale('budgetList')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    await invalidateTables(client, ['*']);
    expect(stale('budgetList')).toBe(true);
  });

  it('never invalidates the news feed or the update check, which are not host data (24 §4.3)', async () => {
    const client = new QueryClient();
    client.setQueryData(['news', 'feed'], { schemaVersion: 1, entries: [] });
    client.setQueryData(['updates', 'latest'], '0.3.0');
    client.setQueryData(['app', 'info'], {});
    await invalidateTables(client, ['*']);
    for (const key of [
      ['news', 'feed'],
      ['updates', 'latest'],
      ['app', 'info'],
    ])
      expect(client.getQueryState(key)?.isInvalidated, key.join('.')).toBe(false);
  });
});
