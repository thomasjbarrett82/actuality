// Secrets (19 §4): {userData}/secrets.json, each value encrypted with Electron safeStorage and stored
// base64. Keys: `server:{url}` (session token, never the password) and `e2e:{cloudFileId}`. Values are
// read only for the host over the control channel; the renderer can only ask available/has/forget.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './settings-store';

/** The part of Electron's safeStorage this store needs (injected so it can be tested outside Electron). */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class SecretsStore {
  private readonly path: string;
  private values: Record<string, string>;

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

  /** False on some Linux setups without a keyring: "Stay signed in" and "Remember" are then disabled. */
  available(): boolean {
    return this.cipher.isEncryptionAvailable();
  }

  has(key: string): boolean {
    return key in this.values;
  }

  get(key: string): string | null {
    const stored = this.values[key];
    if (stored === undefined || !this.available()) return null;
    try {
      return this.cipher.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    if (!this.available()) throw new Error('Secure storage is not available.');
    this.values[key] = this.cipher.encryptString(value).toString('base64');
    this.save();
  }

  delete(key: string): void {
    if (!(key in this.values)) return;
    this.values = Object.fromEntries(Object.entries(this.values).filter(([k]) => k !== key));
    this.save();
  }

  /** Deletes every secret, or every secret whose key starts with `prefix`. */
  clear(prefix?: string): void {
    this.values = prefix
      ? Object.fromEntries(Object.entries(this.values).filter(([k]) => !k.startsWith(prefix)))
      : {};
    this.save();
  }
}
