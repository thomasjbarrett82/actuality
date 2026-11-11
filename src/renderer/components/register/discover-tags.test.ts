// The Discover dialog (04 §5.2) with a mocked host: the unmanaged tags, all checked at first, Select all, Add
// (only the checked ones, in one call), Cancel, Add with none checked (a toast), the empty message, "Add YNAB
// flags" (shown only while no managed tag starts with `flag-`), and the offline state.
import type { TagEntity } from '@shared/domain/types';
import { FLAG_TAG_DESCRIPTION } from '@shared/metadata/tags';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConnection } from '../../stores/connection';
import { useToasts } from '../../stores/toasts';
import { mockHost, ONLINE } from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';
import DiscoverTagsDialog from './DiscoverTagsDialog.vue';

const entity = (tag: string, color: string | null = null): TagEntity => ({
  id: `id-${tag}`,
  tag,
  color,
  description: null,
});

let host: ReturnType<typeof mockHost>;
let unmanaged: string[];
let managed: TagEntity[];

beforeEach(() => {
  unmanaged = ['Zoo', 'flag-red', 'trip'];
  managed = [entity('needs-review', '#96A6D9')];
  host = mockHost({
    'tags.list': () => managed,
    'tags.unmanaged': () => unmanaged,
    'tags.createMany': (p: { tags: { tag: string; color?: string }[] }) =>
      p.tags.map((x) => entity(x.tag, x.color ?? null)),
  });
  useConnection().info = ONLINE;
  useConnection().hostReady = true;
});

async function open(): Promise<VueWrapper> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mountApp(DiscoverTagsDialog, {
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return w;
}

const button = (w: VueWrapper, text: string) => {
  const b = w.findAll('button').find((x) => x.text() === text);
  if (!b) throw new Error(`no button ${text}`);
  return b;
};
const hasButton = (w: VueWrapper, text: string): boolean =>
  w.findAll('button').some((x) => x.text() === text);
const rows = (w: VueWrapper) => w.findAll('.discover__list label');
const box = (w: VueWrapper, label: string) => {
  const row = w.findAll('label').find((x) => x.text() === label);
  if (!row) throw new Error(`no checkbox ${label}`);
  return row.get('input[type="checkbox"]');
};
const isChecked = (w: VueWrapper, label: string): boolean =>
  (box(w, label).element as HTMLInputElement).checked;

describe('Discover dialog (04 §5.2)', () => {
  it('lists the unmanaged tags, all checked, without writing anything', async () => {
    const w = await open();
    expect(rows(w).map((r) => r.text())).toEqual(['#Zoo', '#flag-red', '#trip']);
    expect(['#Zoo', '#flag-red', '#trip', 'Select all'].every((x) => isChecked(w, x))).toBe(true);
    expect(host.calls('tags.createMany')).toEqual([]);
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });

  it('adds only the checked tags, in one call, and closes', async () => {
    const w = await open();
    await box(w, '#flag-red').setValue(false);
    expect((box(w, 'Select all').element as HTMLInputElement).indeterminate).toBe(true);
    await button(w, 'Add').trigger('click');
    await flushPromises();
    expect(host.calls('tags.createMany')).toEqual([{ tags: [{ tag: 'Zoo' }, { tag: 'trip' }] }]);
    expect(w.emitted('close')).toEqual([[null]]);
  });

  it('checks and unchecks every tag with Select all', async () => {
    const w = await open();
    await box(w, 'Select all').setValue(false);
    expect(['#Zoo', '#flag-red', '#trip'].some((x) => isChecked(w, x))).toBe(false);
    await box(w, 'Select all').setValue(true);
    expect(['#Zoo', '#flag-red', '#trip'].every((x) => isChecked(w, x))).toBe(true);
  });

  it('closes on Cancel without changing anything', async () => {
    const w = await open();
    await button(w, 'Cancel').trigger('click');
    expect(w.emitted('close')).toEqual([[null]]);
    expect(host.calls('tags.createMany')).toEqual([]);
  });

  it('closes with a toast when Add has nothing checked', async () => {
    const w = await open();
    await box(w, 'Select all').setValue(false);
    await button(w, 'Add').trigger('click');
    await flushPromises();
    expect(host.calls('tags.createMany')).toEqual([]);
    expect(w.emitted('close')).toEqual([[null]]);
    expect(useToasts().list).toEqual([
      expect.objectContaining({ title: 'Discover new tags', message: 'No tags selected to add' }),
    ]);
    expect(useToasts().list[0]?.action).toBeUndefined();
  });

  it('shows a message instead of the list when every tag is managed', async () => {
    unmanaged = [];
    const w = await open();
    expect(w.text()).toContain('No unmanaged tags found in the register.');
    expect(w.find('.discover__list').exists()).toBe(false);
    expect(hasButton(w, 'Select all')).toBe(false);
    await button(w, 'Add').trigger('click');
    await flushPromises();
    expect(useToasts().list[0]?.message).toBe('No tags selected to add');
  });

  it('adds the six YNAB flags at once and stays open, while no managed tag starts with flag-', async () => {
    const w = await open();
    await button(w, 'Add YNAB flags').trigger('click');
    await flushPromises();
    expect(host.calls('tags.createMany')).toEqual([
      {
        tags: [
          { tag: 'flag-blue', color: '#4A90D9', description: FLAG_TAG_DESCRIPTION },
          { tag: 'flag-green', color: '#5AAE3E', description: FLAG_TAG_DESCRIPTION },
          { tag: 'flag-orange', color: '#F0922E', description: FLAG_TAG_DESCRIPTION },
          { tag: 'flag-purple', color: '#9461C9', description: FLAG_TAG_DESCRIPTION },
          { tag: 'flag-red', color: '#E53935', description: FLAG_TAG_DESCRIPTION },
          { tag: 'flag-yellow', color: '#E8C42A', description: FLAG_TAG_DESCRIPTION },
        ],
      },
    ]);
    expect(FLAG_TAG_DESCRIPTION).toBe('Used by Actuality for transaction flags');
    // The flag that was in the list now has an entity.
    expect(rows(w).map((r) => r.text())).toEqual(['#Zoo', '#trip']);
    expect(w.emitted('close')).toBeUndefined();
  });

  it('has no "Add YNAB flags" when a managed tag starts with flag-', async () => {
    managed = [...managed, entity('flag-green', '#00FF00')];
    const w = await open();
    expect(hasButton(w, 'Add YNAB flags')).toBe(false);
  });

  it('is read-only while offline', async () => {
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    const w = await open();
    expect(button(w, 'Add').attributes('disabled')).toBeDefined();
    expect(button(w, 'Add YNAB flags').attributes('disabled')).toBeDefined();
    expect(button(w, 'Cancel').attributes('disabled')).toBeUndefined();
  });
});
