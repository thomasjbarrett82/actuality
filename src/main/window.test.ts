import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relayoutMenuBar } from './window';

vi.mock('electron', () => ({}));

const realPlatform = process.platform;
const onPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, 'platform', { value: platform });
};

function fakeWindow(state: { destroyed?: boolean; barVisible?: boolean } = {}) {
  const calls: boolean[] = [];
  const win = {
    isDestroyed: () => state.destroyed ?? false,
    isMenuBarVisible: () => state.barVisible ?? true,
    setMenuBarVisibility: (visible: boolean) => calls.push(visible),
  } as unknown as BrowserWindow;
  return { win, calls };
}

describe('relayoutMenuBar (06 §4)', () => {
  afterEach(() => {
    onPlatform(realPlatform);
  });

  it.each(['win32', 'linux'] as const)('hides and re-shows a visible bar on %s', (platform) => {
    onPlatform(platform);
    const { win, calls } = fakeWindow();
    relayoutMenuBar(win);
    expect(calls).toEqual([false, true]);
  });

  it('leaves a hidden bar hidden (full screen)', () => {
    onPlatform('win32');
    const { win, calls } = fakeWindow({ barVisible: false });
    relayoutMenuBar(win);
    expect(calls).toEqual([]);
  });

  it('does nothing on a destroyed window (a settings save during quit)', () => {
    onPlatform('win32');
    const { win, calls } = fakeWindow({ destroyed: true });
    relayoutMenuBar(win);
    expect(calls).toEqual([]);
  });

  it('does nothing on macOS, which has no bar on the window', () => {
    onPlatform('darwin');
    const { win, calls } = fakeWindow();
    relayoutMenuBar(win);
    expect(calls).toEqual([]);
  });
});
