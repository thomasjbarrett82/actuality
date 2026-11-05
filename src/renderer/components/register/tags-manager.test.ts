// The Tags manager (04 §5.2; 07 §7) with a mocked host: the tag list and search, creating (with name
// validation), discovering, color and description changes, rename and delete confirmations, a rename onto a
// name in use, the protected
// needs-review tag, "View Transactions", and the offline read-only state.
import type { TagEntity } from '@shared/domain/types';
import { RpcError } from '@shared/rpc/protocol';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConnection } from '../../stores/connection';
import { answerDialog, mockHost, ONLINE } from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';
import TagsManagerDialog from './TagsManagerDialog.vue';

const TAGS: TagEntity[] = [
  { id: 'tg1', tag: 'Trip2025', color: '#3D8FD6', description: 'Holiday' },
  { id: 'tg2', tag: 'trip', color: null, description: null },
  { id: 'tg3', tag: 'needs-review', color: '#96A6D9', description: null },
];
let host: ReturnType<typeof mockHost>;

beforeEach(() => {
  host = mockHost({
    'tags.list': () => TAGS,
    'tags.create': (p: { tag: string }) => ({
      id: 'new',
      tag: p.tag,
      color: null,
      description: null,
    }),
    'tags.update': (p: { id: string }) => TAGS.find((t) => t.id === p.id),
    'tags.delete': () => null,
    'tags.discover': () => [{ id: 'd1', tag: 'found', color: null, description: null }],
  });
  useConnection().info = ONLINE;
  useConnection().hostReady = true;
});

async function open(): Promise<VueWrapper> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mountApp(TagsManagerDialog, {
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return w;
}

const button = (w: VueWrapper, text: string, nth = 0) => {
  const found = w.findAll('button').filter((x) => x.text() === text);
  const b = found[nth];
  if (!b) throw new Error(`no button ${text}`);
  return b;
};
const items = (w: VueWrapper) => w.findAll('.tags__item');
const set = async (el: ReturnType<VueWrapper['get']>, value: string): Promise<void> => {
  (el.element as HTMLInputElement).value = value;
  await el.trigger('input');
};

describe('Tags manager (04 §5.2)', () => {
  it('lists the tags as pills with their names, and searches them case-insensitively', async () => {
    const w = await open();
    expect(items(w).map((i) => i.get('.tags__pill').text())).toEqual([
      '#Trip2025',
      '#trip',
      '#needs-review',
    ]);
    await set(w.get('input[type="search"]'), 'TRIP');
    expect(items(w)).toHaveLength(2);
    await set(w.get('input[type="search"]'), 'zzz');
    expect(w.text()).toContain('No tags.');
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
  });

  it('creates a tag, taking a leading # off the name', async () => {
    const w = await open();
    await set(w.get('input[aria-label="New tag name"]'), '#Dine');
    await button(w, 'Add Tag').trigger('click');
    await flushPromises();
    expect(host.calls('tags.create')).toEqual([{ tag: 'Dine' }]);
  });

  it('refuses a name with a space or a # inside', async () => {
    const w = await open();
    await set(w.get('input[aria-label="New tag name"]'), 'two words');
    await button(w, 'Add Tag').trigger('click');
    expect(await answerDialog('close')).toMatchObject({ instruction: 'Invalid tag name' });
    expect(host.calls('tags.create')).toEqual([]);
  });

  it('reports what discovery added', async () => {
    const w = await open();
    await button(w, 'Discover New Tags').trigger('click');
    expect(await answerDialog('ok')).toMatchObject({
      content: 'Added 1 tag used in your notes.',
    });
  });

  it('changes a description on blur and a color on change', async () => {
    const w = await open();
    const first = items(w)[0];
    const description = first?.get('input[aria-label="Description of tag Trip2025"]');
    await description?.setValue('Trips');
    await description?.trigger('change');
    // Setting a color input's value fires its change event.
    await first?.get('input[type="color"]').setValue('#112233');
    await flushPromises();
    expect(host.calls('tags.update')).toEqual([
      { id: 'tg1', description: 'Trips' },
      { id: 'tg1', color: '#112233' },
    ]);
    // The default-color button clears a color, and is off for a tag that has none.
    const second = items(w)[1];
    expect(second?.findAll('button')[0]?.attributes('disabled')).toBeDefined();
    await first?.findAll('button')[0]?.trigger('click');
    expect(host.calls('tags.update').at(-1)).toEqual({ id: 'tg1', color: null });
  });

  it('confirms a rename, and sends nothing when cancelled', async () => {
    const w = await open();
    const row = items(w)[1];
    const name = row?.get('input[aria-label="Name of tag trip"]');
    if (!name) throw new Error('no name field');
    await set(name, 'journey');
    await row
      ?.findAll('button')
      .find((b) => b.text() === 'Rename')
      ?.trigger('click');
    expect(await answerDialog(null)).toMatchObject({ instruction: 'Rename tag?' });
    expect(host.calls('tags.update')).toEqual([]);
    await row
      ?.findAll('button')
      .find((b) => b.text() === 'Rename')
      ?.trigger('click');
    await answerDialog('rename');
    expect(host.calls('tags.update')).toEqual([{ id: 'tg2', tag: 'journey' }]);
  });

  it('says a name is in use: a listed tag before asking, a deleted one after the host refuses', async () => {
    const w = await open();
    const row = items(w)[1];
    const name = row?.get('input[aria-label="Name of tag trip"]');
    if (!name) throw new Error('no name field');
    const rename = () =>
      row
        ?.findAll('button')
        .find((b) => b.text() === 'Rename')
        ?.trigger('click');
    await set(name, 'Trip2025');
    await rename();
    expect(await answerDialog('close')).toMatchObject({ instruction: 'Tag name already in use' });
    expect(host.calls('tags.update')).toEqual([]);

    host.spy.mockImplementation((method) =>
      method === 'tags.update'
        ? Promise.reject(
            new RpcError('validation', 'A tag with that name already exists.', {
              code: 'duplicate-tag',
            }),
          )
        : Promise.resolve(TAGS as never),
    );
    await set(name, 'Food');
    await rename();
    await answerDialog('rename');
    const refused = await answerDialog('close');
    expect(refused.instruction).toBe('Tag name already in use');
    expect(refused.content).toContain('**#Food**');
  });

  it('confirms a delete', async () => {
    const w = await open();
    await items(w)[0]
      ?.findAll('button')
      .find((b) => b.text() === 'Delete')
      ?.trigger('click');
    expect(await answerDialog('delete')).toMatchObject({ instruction: 'Delete tag?' });
    expect(host.calls('tags.delete')).toEqual([{ id: 'tg1' }]);
  });

  it('protects needs-review: no rename or delete, and its name is read-only', async () => {
    const w = await open();
    const review = items(w)[2];
    expect(review?.findAll('button').map((b) => b.text())).toEqual([
      'Default Color',
      'View Transactions',
    ]);
    expect(
      review?.get('input[aria-label="Name of tag needs-review"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('closes with a search for the tag', async () => {
    const w = await open();
    await items(w)[0]
      ?.findAll('button')
      .find((b) => b.text() === 'View Transactions')
      ?.trigger('click');
    expect(w.emitted('close')).toEqual([[{ search: 'Tag: Trip2025,' }]]);
  });

  it('is read-only while offline', async () => {
    useConnection().info = { ...ONLINE, state: 'OfflineReadOnly' };
    const w = await open();
    expect(w.text()).toContain("You're offline. Tags can't be changed until Actuality reconnects.");
    expect(button(w, 'Discover New Tags').attributes('disabled')).toBeDefined();
    expect(button(w, 'Add Tag').attributes('disabled')).toBeDefined();
    expect(button(w, 'Delete').attributes('disabled')).toBeDefined();
    expect(button(w, 'View Transactions').attributes('disabled')).toBeUndefined();
  });
});
