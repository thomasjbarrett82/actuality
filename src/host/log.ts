// The host's log sink. Entries go to main over the control channel, and main writes the rotating log file,
// so a single process owns {userData}/logs/app.log (02 §8.1, 17 §8). Before the channel is up, entries go
// to stderr. Only the aspects (host/aspects) and the error boundary in index.ts write here (02 §8.5).
import { isDebug } from '@shared/aspects/level';
import type { LogEntry, LogLevel } from '@shared/aspects/log-entry';
import type { Write } from '@shared/aspects/logging';

let sink: (entry: LogEntry) => void = (entry) => {
  console.error(`[host] ${entry.level}: ${entry.message}`, entry.data ?? '');
};

export function setLogSink(next: (entry: LogEntry) => void): void {
  sink = next;
}

export const write: Write = (level: LogLevel, message: string, data?: unknown): void => {
  if (level === 'debug' && !isDebug()) return;
  const entry: LogEntry = { at: Date.now(), level, source: 'host', message };
  if (data !== undefined) entry.data = data;
  try {
    sink(entry);
  } catch {
    // Logging must never throw into the caller.
  }
};
