// The app log: {userData}/logs/app.log, rotating, 5 × 1 MB (02 §8.1, 17 §8). Main is the only writer: the
// host sends its entries over the control channel and the renderer with `shell.log`. The sink drops debug
// entries while debug logging is off, whichever process sent them, and redacts every entry last (02 §8.4).
// Only the aspects (main/aspects) and the error boundaries in index.ts write here (02 §8.5).
import { isDebug } from '@shared/aspects/level';
import { LOG_LEVELS, type LogEntry, type LogLevel } from '@shared/aspects/log-entry';
import type { Write } from '@shared/aspects/logging';
import { redact } from '@shared/aspects/redact';
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LOG_FILE = 'app.log';
export const MAX_LOG_BYTES = 1024 * 1024;
export const LOG_FILES = 5;

export class RotatingLog {
  private readonly file: string;

  constructor(
    private readonly dir: string,
    private readonly maxBytes = MAX_LOG_BYTES,
    private readonly files = LOG_FILES,
  ) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, LOG_FILE);
  }

  write(entry: LogEntry): void {
    const data = entry.data === undefined ? '' : ` ${safeJson(entry.data)}`;
    const line = `${new Date(entry.at).toISOString()} ${entry.level.toUpperCase()} [${entry.source}] ${entry.message}${data}\n`;
    try {
      this.rotateIfNeeded(Buffer.byteLength(line));
      appendFileSync(this.file, line);
    } catch (e) {
      console.error('could not write the log', e);
    }
  }

  private rotateIfNeeded(incoming: number): void {
    if (!existsSync(this.file) || statSync(this.file).size + incoming <= this.maxBytes) return;
    const oldest = `${this.file}.${this.files - 1}`;
    if (existsSync(oldest)) rmSync(oldest);
    for (let i = this.files - 2; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      if (existsSync(from)) renameSync(from, `${this.file}.${i + 1}`);
    }
    renameSync(this.file, `${this.file}.1`);
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

let sink: RotatingLog | null = null;
const home = homedir();

export function initLog(dir: string): void {
  sink = new RotatingLog(dir);
}

/** Writes an entry from any process: drops debug while it is off, then redacts (02 §8.3, §8.4). */
export function writeLog(entry: LogEntry): void {
  if (entry.level === 'debug' && !isDebug()) return;
  const safe: LogEntry = {
    at: entry.at,
    level: entry.level,
    source: entry.source,
    message: redact(entry.message, { home }) as string,
    ...(entry.data === undefined ? {} : { data: redact(entry.data, { home }) }),
  };
  if (sink) sink.write(safe);
  else console.error(`[${safe.source}] ${safe.level}: ${safe.message}`);
}

/** Main's own entries. */
export const write: Write = (level, message, data) => {
  writeLog({
    at: Date.now(),
    level,
    source: 'main',
    message,
    ...(data === undefined ? {} : { data }),
  });
};

/** An entry from another process, checked: anything that isn't an entry is dropped. */
export function toLogEntry(v: unknown, source: LogEntry['source']): LogEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const { at, level, message, data } = v as Partial<Record<keyof LogEntry, unknown>>;
  if (typeof message !== 'string' || !LOG_LEVELS.includes(level as LogLevel)) return null;
  return {
    at: typeof at === 'number' ? at : Date.now(),
    level: level as LogLevel,
    source,
    message,
    ...(data === undefined ? {} : { data }),
  };
}
