// Tag entities on the fake API (03 §8 `tags`; 04 §5.2): create (an existing name updates its color), update
// (a rename rewrites the exact hashtag in the notes), delete (the notes keep the text), discover, the
// protected needs-review tag, and the write gate.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../connection';
import { JobQueue } from '../queue';
import { FakeActual, rawTransaction } from '../testing/fake-actual';
import { FakeControl } from '../testing/fake-control';
import { TagsService } from './tags';

describe('TagsService (04 §5.2)', () => {
  let actual: FakeActual;
  let conn: Connection;
  let service: TagsService;
  const budget = () => {
    const b = actual.budgets.get('b1');
    if (!b) throw new Error('no budget');
    return b;
  };
  const notesOf = (id: string): string | null =>
    budget().transactions.find((t) => t.id === id)?.notes ?? null;

  beforeEach(async () => {
    vi.useFakeTimers();
    actual = new FakeActual();
    actual.addBudget({
      cloudFileId: 'b1',
      name: 'Budget',
      accounts: [
        {
          id: 'a1',
          name: 'Checking',
          offbudget: false,
          closed: false,
          sortOrder: 1,
          accountGroupId: null,
        },
      ],
      transactions: [
        rawTransaction({ id: 't1', account: 'a1', notes: 'dinner #Dine #dine. #flag-red' }),
        rawTransaction({ id: 't2', account: 'a1', notes: 'lunch #Dine #needs-review' }),
      ],
    });
    const queue = new JobQueue();
    conn = new Connection({
      actual,
      queue,
      control: new FakeControl(),
      emit: () => undefined,
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: actual.server === 'up', diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
    });
    service = new TagsService(actual, queue, conn);
    await conn.connect('https://x.test', 'pw', false);
    await conn.openBudget('b1');
  });
  afterEach(() => {
    conn.dispose();
    vi.useRealTimers();
  });

  it('creates a tag, and an existing name (case-sensitive) updates it instead', async () => {
    const created = await service.create({ tag: 'Dine', color: '#336699' });
    expect(created).toMatchObject({ tag: 'Dine', color: '#336699', description: null });
    const again = await service.create({
      tag: 'Dine',
      color: '#996633',
      description: 'Eating out',
    });
    expect(again).toEqual({ ...created, color: '#996633', description: 'Eating out' });
    // `dine` is a different tag from `Dine`.
    await service.create({ tag: 'dine' });
    expect((await service.list()).map((t) => t.tag)).toEqual(['Dine', 'dine']);
  });

  it('lists tags by name', async () => {
    await service.create({ tag: 'b' });
    await service.create({ tag: 'a' });
    expect((await service.list()).map((t) => t.tag)).toEqual(['a', 'b']);
  });

  it('changes a color and description, and clears a color', async () => {
    const { id } = await service.create({ tag: 'Dine', color: '#336699' });
    expect(await service.update(id, { description: 'Meals' })).toMatchObject({
      color: '#336699',
      description: 'Meals',
    });
    expect(await service.update(id, { color: null })).toMatchObject({ color: null });
  });

  it('renames a tag, which rewrites that exact tag in every note', async () => {
    const { id } = await service.create({ tag: 'Dine' });
    await service.update(id, { tag: 'Meals' });
    expect(notesOf('t1')).toBe('dinner #Meals #dine. #flag-red');
    expect(notesOf('t2')).toBe('lunch #Meals #needs-review');
    expect((await service.list()).map((t) => t.tag)).toEqual(['Meals']);
  });

  it('renames and recolors in one update, and fails a rename without the tags-rename handler', async () => {
    const { id } = await service.create({ tag: 'Dine' });
    await expect(service.update(id, { tag: 'Meals', color: '#336699' })).resolves.toMatchObject({
      tag: 'Meals',
      color: '#336699',
    });
    expect(notesOf('t1')).toBe('dinner #Meals #dine. #flag-red');
    actual.missingHandlers.add('tags-rename');
    await expect(service.update(id, { tag: 'Food' })).rejects.toMatchObject({
      code: 'actual',
      details: { code: 'internal-handler-unavailable' },
    });
    expect(notesOf('t1')).toBe('dinner #Meals #dine. #flag-red');
  });

  it('refuses a rename onto an existing name, case-sensitively', async () => {
    const { id } = await service.create({ tag: 'Dine' });
    await service.create({ tag: 'Meals' });
    await expect(service.update(id, { tag: 'Meals' })).rejects.toMatchObject({
      code: 'validation',
      details: { code: 'duplicate-tag' },
    });
    await expect(service.update(id, { tag: 'meals' })).resolves.toMatchObject({ tag: 'meals' });
  });

  it('refuses a rename onto the name of a deleted tag, as a duplicate', async () => {
    const old = await service.create({ tag: 'Food' });
    await service.delete(old.id);
    const { id } = await service.create({ tag: 'Dine' });
    await expect(service.update(id, { tag: 'Food' })).rejects.toMatchObject({
      code: 'validation',
      details: { code: 'duplicate-tag' },
    });
    expect(notesOf('t1')).toBe('dinner #Dine #dine. #flag-red');
  });

  it('deletes only the entity: the hashtag stays in the notes', async () => {
    const { id } = await service.create({ tag: 'Dine' });
    await service.delete(id);
    expect(await service.list()).toEqual([]);
    expect(notesOf('t1')).toBe('dinner #Dine #dine. #flag-red');
  });

  it('keeps needs-review: no rename and no delete, though its color can change', async () => {
    const review = await service.create({ tag: 'needs-review', color: '#96A6D9' });
    await expect(service.update(review.id, { tag: 'to-review' })).rejects.toMatchObject({
      details: { code: 'protected-tag' },
    });
    await expect(service.delete(review.id)).rejects.toMatchObject({
      details: { code: 'protected-tag' },
    });
    await expect(service.update(review.id, { color: '#000000' })).resolves.toMatchObject({
      color: '#000000',
    });
    expect(notesOf('t2')).toBe('lunch #Dine #needs-review');
  });

  it('discovers the tags used in notes that have no entity, and reports the new ones', async () => {
    await service.create({ tag: 'Dine', color: '#336699' });
    const found = await service.discover();
    expect(found.map((t) => t.tag)).toEqual(['dine.', 'flag-red', 'needs-review']);
    expect((await service.list()).find((t) => t.tag === 'Dine')?.color).toBe('#336699');
    expect(await service.discover()).toEqual([]);
  });

  it('reports a missing tag on update, and ignores one on delete', async () => {
    await expect(service.update('nope', { color: '#000000' })).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(service.delete('nope')).resolves.toBeNull();
  });

  it('needs an open budget', () => {
    conn.dispose();
    const queue = new JobQueue();
    const closed = new Connection({
      actual,
      queue,
      control: new FakeControl(),
      emit: () => undefined,
      dataDir: '/tmp',
      probe: () => Promise.resolve({ reachable: true, diagnosis: 'none' }),
      login: () => Promise.resolve('good-token'),
    });
    expect(() => new TagsService(actual, queue, closed).list()).toThrow('No budget is open.');
    closed.dispose();
  });

  it('rejects every write while offline (03 §5)', async () => {
    actual.server = 'down';
    await conn.syncNow().catch(() => undefined);
    await expect(service.create({ tag: 'x' })).rejects.toMatchObject({ code: 'offline' });
    await expect(service.update('tag-x', { color: '#000000' })).rejects.toMatchObject({
      code: 'offline',
    });
    await expect(service.delete('tag-x')).rejects.toMatchObject({ code: 'offline' });
    await expect(service.discover()).rejects.toMatchObject({ code: 'offline' });
    // Reads still work.
    await expect(service.list()).resolves.toEqual([]);
  });
});
