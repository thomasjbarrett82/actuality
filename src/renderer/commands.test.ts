import { describe, expect, it, vi } from 'vitest';
import { CommandDispatcher } from './commands';

describe('command dispatcher (06 §4)', () => {
  it('runs the latest handler, and does nothing without one', async () => {
    const d = new CommandDispatcher();
    const first = vi.fn();
    const second = vi.fn();
    expect(await d.run('view.goBudget')).toBe(false);
    d.register('view.goBudget', first);
    const remove = d.register('view.goBudget', second);
    expect(await d.run('view.goBudget')).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    remove();
    await d.run('view.goBudget');
    expect(first).toHaveBeenCalledOnce();
    expect(d.has('view.goBudget')).toBe(true);
  });
});
