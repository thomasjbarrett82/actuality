// The renderer's log sink: entries go to main, the only writer, with `shell.log` (02 §8.1). One-way and
// never awaited. Only the aspects (renderer/aspects) and the error boundary in main.ts write here (02 §8.5).
import { isDebug } from '@shared/aspects/level';
import type { Write } from '@shared/aspects/logging';

export const write: Write = (level, message, data) => {
  if (level === 'debug' && !isDebug()) return;
  try {
    window.app.shell.log({
      at: Date.now(),
      level,
      message,
      ...(data === undefined ? {} : { data }),
    });
  } catch {
    // Logging must never throw into the caller.
  }
};
