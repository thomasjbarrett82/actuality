import { RESERVED, reservedIds } from '@shared/metadata/reserved';
import { REVIEW_TAG_COLOR } from '@shared/metadata/tags';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeActual } from '../testing/fake-actual';
import { MetadataRepository } from './metadata';

describe('metadata repository (04 §5.2–5.3)', () => {
  let actual: FakeActual;
  let repo: MetadataRepository;

  beforeEach(async () => {
    actual = new FakeActual();
    actual.addBudget({ cloudFileId: 'b1', name: 'Budget' });
    await actual.init({ dataDir: '/tmp', serverURL: 'https://x', sessionToken: 'good-token' });
    await actual.downloadBudget('g-b1');
    repo = new MetadataRepository(actual);
  });

  const notes = (): Map<string, string> =>
    actual.budgets.get('b1')?.notes ?? new Map<string, string>();

  it('loads every reserved note and never a backup', async () => {
    // An `ad:account:` note isn't read, and is left as it is.
    notes().set('ad:account:a1', JSON.stringify({ v: 1, type: 'Savings' }));
    notes().set('ad:payees', JSON.stringify({ v: 1, disabled: ['p1'] }));
    notes().set('ad:cellnotes:2026-10', JSON.stringify({ v: 1, notes: { c1: 'hi' } }));
    notes().set('ad-bak:ad:payees', JSON.stringify({ v: 1, disabled: ['WRONG'] }));
    notes().set('account-a1', 'a native note');
    const snap = await repo.loadAll();
    expect(snap.payees.disabled).toEqual(['p1']);
    expect(snap.budget).toEqual({ v: 1 });
    expect(notes().get('ad:account:a1')).toBe(JSON.stringify({ v: 1, type: 'Savings' }));
  });

  it('reads an invalid note as empty', async () => {
    notes().set('ad:payees', '{broken');
    expect((await repo.loadAll()).payees).toEqual({ v: 1, disabled: [] });
  });

  it('modifies in one read-modify-write, keeping unknown fields', async () => {
    notes().set('ad:payees', JSON.stringify({ v: 1, disabled: ['p1'], newer: true }));
    const next = await repo.modifyInJob(reservedIds.payees, RESERVED.payees, (m) => ({
      ...m,
      disabled: [...m.disabled, 'p2'],
    }));
    expect(next).toEqual({ v: 1, disabled: ['p1', 'p2'], newer: true });
    expect(JSON.parse(notes().get('ad:payees') ?? '')).toEqual(next);
  });

  it('backs up an invalid note before overwriting it', async () => {
    notes().set('ad:payees', 'not json at all');
    await repo.modifyInJob(reservedIds.payees, RESERVED.payees, (m) => ({
      ...m,
      disabled: ['p2'],
    }));
    expect(notes().get('ad-bak:ad:payees')).toBe('not json at all');
    expect(JSON.parse(notes().get('ad:payees') ?? '')).toEqual({ v: 1, disabled: ['p2'] });
    // The backup never comes back as metadata.
    expect((await repo.loadAll()).payees.disabled).toEqual(['p2']);
  });

  it('removes deleted categories from every month’s cell notes, keeping the rest', async () => {
    notes().set('ad:cellnotes:2026-09', JSON.stringify({ v: 1, notes: { c1: 'a', c2: 'b' } }));
    notes().set('ad:cellnotes:2026-10', JSON.stringify({ v: 1, notes: { c3: 'c' }, newer: true }));
    notes().set('ad:cellnotes:2026-11', '{broken');
    await repo.removeCellNotes(['c1', 'c3']);
    expect(JSON.parse(notes().get('ad:cellnotes:2026-09') ?? '')).toEqual({
      v: 1,
      notes: { c2: 'b' },
    });
    expect(JSON.parse(notes().get('ad:cellnotes:2026-10') ?? '')).toEqual({
      v: 1,
      notes: {},
      newer: true,
    });
    expect(notes().get('ad:cellnotes:2026-11')).toBe('{broken');
    expect(notes().has('ad-bak:ad:cellnotes:2026-11')).toBe(false);
  });

  it('creates only the needs-review tag entity, and never updates an existing one', async () => {
    const budget = actual.budgets.get('b1');
    budget?.tags.push({ id: 't1', tag: 'flag-red', color: '#000000', description: 'mine' });
    await repo.ensureTags();
    const tags = budget?.tags ?? [];
    expect(tags.map((t) => t.tag).sort()).toEqual(['flag-red', 'needs-review']);
    expect(tags.find((t) => t.tag === 'flag-red')?.color).toBe('#000000');
    expect(tags.find((t) => t.tag === 'needs-review')?.color).toBe(REVIEW_TAG_COLOR);
    if (budget?.tags[1]) budget.tags[1].color = '#123456';
    await repo.ensureTags();
    expect(budget?.tags).toHaveLength(2);
    expect(budget?.tags[1]?.color).toBe('#123456');
  });
});
