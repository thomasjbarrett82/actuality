// Secrets (19 §4): {userData}/secrets.json, each value encrypted with Electron's asynchronous
// safeStorage API and stored base64. Keys: `server:{url}` (session token, never the password) and
// `e2e:{cloudFileId}`. Values are read only for the host over the control channel; the renderer can
// only ask available/has/forget.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './settings-store';

/** The part of Electron's safeStorage this store needs (injected so it can be tested outside Electron). */
export interface Cipher {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

/**
 * Every operation runs in call order on one queue: encryption is asynchronous, so without it a
 * `set` still encrypting could land after a later `delete` or `clear` and bring the secret back.
 */
export class SecretsStore {
  private readonly path: string;
  private values: Record<string, string>;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    dir: string,
    private readonly cipher: Cipher,
  ) {
    this.path = join(dir, 'secrets.json');
    this.values = this.load();
  }

  private load(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      if (typeof raw !== 'object' || raw === null) return {};
      return Object.fromEntries(
        Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'),
      );
    } catch {
      return {};
    }
  }

  private save(): void {
    writeJsonAtomic(this.path, this.values);
  }

  private enqueue<T>(op: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(op);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async encrypt(value: string): Promise<string> {
    return (await this.cipher.encryptStringAsync(value)).toString('base64');
  }

  /** False on some Linux setups without a keyring: "Stay signed in" and "Remember" are then disabled. */
  available(): Promise<boolean> {
    return this.cipher.isAsyncEncryptionAvailable();
  }

  has(key: string): Promise<boolean> {
    return this.enqueue(() => key in this.values);
  }

  /** The value, or null if absent or undecryptable. Re-encrypts it when the OS key has changed. */
  get(key: string): Promise<string | null> {
    return this.enqueue(async () => {
      const stored = this.values[key];
      if (stored === undefined || !(await this.available())) return null;
      let plain: { result: string; shouldReEncrypt: boolean };
      try {
        plain = await this.cipher.decryptStringAsync(Buffer.from(stored, 'base64'));
      } catch {
        return null;
      }
      if (plain.shouldReEncrypt) {
        try {
          this.values[key] = await this.encrypt(plain.result);
          this.save();
        } catch {
          // Keep the old ciphertext: it still decrypts, and the next read tries again.
        }
      }
      return plain.result;
    });
  }

  set(key: string, value: string): Promise<void> {
    return this.enqueue(async () => {
      if (!(await this.available())) throw new Error('Secure storage is not available.');
      this.values[key] = await this.encrypt(value);
      this.save();
    });
  }

  delete(key: string): Promise<void> {
    return this.enqueue(() => {
      if (!(key in this.values)) return;
      this.values = Object.fromEntries(Object.entries(this.values).filter(([k]) => k !== key));
      this.save();
    });
  }

  /** Deletes every secret, or every secret whose key starts with `prefix`. */
  clear(prefix?: string): Promise<void> {
    return this.enqueue(() => {
      this.values = prefix
        ? Object.fromEntries(Object.entries(this.values).filter(([k]) => !k.startsWith(prefix)))
        : {};
      this.save();
    });
  }
}
