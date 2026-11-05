// Add New Category (11 §4.2): pre-filled names, the checks with their messages, and creating the category
// in an existing or a new master category.
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConnection } from '../../stores/connection';
import { answerDialog, GROUPS, mockHost, ONLINE } from '../../testing/fixtures';
import { axe, mountApp } from '../../testing/mount';
import AddCategoryDialog from './AddCategoryDialog.vue';

let host: ReturnType<typeof mockHost>;
beforeEach(() => {
  host = mockHost({ 'categories.create': () => ({ id: 'c-new', groupId: 'g-bills' }) });
  useConnection().info = ONLINE;
});

async function open(groupName = '', name = ''): Promise<VueWrapper> {
  const queryClient = new QueryClient();
  const w = mountApp(AddCategoryDialog, {
    props: { groups: GROUPS, groupName, name },
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
  });
  await flushPromises();
  return w;
}
const inputs = (w: VueWrapper) => w.findAll('input');
async function set(w: VueWrapper, group: string, name: string): Promise<void> {
  const [g, n] = inputs(w);
  (g?.element as HTMLInputElement).value = group;
  await g?.trigger('input');
  (n?.element as HTMLInputElement).value = name;
  await n?.trigger('input');
}
const create = (w: VueWrapper) =>
  w
    .findAll('button')
    .find((b) => b.text() === 'Create Category')
    ?.trigger('click');

describe('Add New Category (11 §4.2)', () => {
  it('shows the two steps, pre-filled, and blanks a reserved group name', async () => {
    const w = await open('Bills', 'Water');
    expect(w.text()).toContain('1. Choose a category group for this category');
    expect(w.text()).toContain('2. Type in a descriptive name of this new category');
    expect(inputs(w).map((i) => (i.element as HTMLInputElement).value)).toEqual(['Bills', 'Water']);
    expect(await axe(w.element as HTMLElement)).toHaveNoViolations();
    const reserved = await open('Hidden Categories', 'X');
    expect((inputs(reserved)[0]?.element as HTMLInputElement).value).toBe('');
  });
  it('needs both names', async () => {
    const w = await open();
    await create(w);
    expect(await answerDialog('close')).toMatchObject({
      instruction: 'Please choose a different category name',
      content: 'You need to enter a master category name and category name first',
    });
  });
  it('refuses a duplicate, bad characters and the Income group', async () => {
    const w = await open();
    await set(w, 'Bills', 'rent');
    await create(w);
    expect((await answerDialog('close')).content).toBe(
      'You already have a category with this name',
    );
    await set(w, 'Bills', 'a:b');
    await create(w);
    expect((await answerDialog('close')).content).toBe(
      'The category cannot contain the following characters: ":" or "`"',
    );
    await set(w, 'income', 'Bonus');
    await create(w);
    expect((await answerDialog('close')).content).toContain(
      'New income categories must be created in the Income group',
    );
    expect(host.calls('categories.create')).toHaveLength(0);
  });
  it('creates in an existing group, and closes with "Group: Category"', async () => {
    const w = await open();
    await set(w, 'bills', 'Water');
    await create(w);
    await flushPromises();
    expect(host.calls('categories.create')[0]).toEqual({ groupId: 'g-bills', name: 'Water' });
    expect(w.emitted('close')?.[0]).toEqual([{ id: 'c-new', text: 'Bills: Water' }]);
  });
  it('creates a new group too', async () => {
    const w = await open();
    await set(w, 'Holidays', 'Flights');
    await create(w);
    await flushPromises();
    expect(host.calls('categories.create')[0]).toEqual({ groupName: 'Holidays', name: 'Flights' });
  });
});
