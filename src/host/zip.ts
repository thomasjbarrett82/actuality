// Minimal zip support for Import a budget file (07 §3.4). The writer (stored entries, no compression):
// Actual's YNAB 4 importer reads only zips, while YNAB 4 keeps a budget as a `.ynab4` folder. The folder is
// zipped in memory, under its own name when that ends in `.ynab4`: the importer finds the budget under
// such a root, or at the top of the zip. The reader (stored or deflated entries): one entry of an Actual
// export, so a tracking budget is refused before the import uploads it (03 §6.1).
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Forward slashes, no leading slash. */
  name: string;
  data: Uint8Array;
}

/** A zip of stored entries, with UTF-8 names. */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, entry.data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, entry.data.length, true);
    dir.setUint32(24, entry.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + entry.data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Every file under `folder`, named `{folder name}/{relative path}` for a `.ynab4` folder. */
export async function zipFolder(folder: string): Promise<Uint8Array> {
  const name = basename(folder);
  const root = /\.ynab4$/i.test(name) ? [name] : [];
  const entries: ZipEntry[] = [];
  const files = await readdir(folder, { recursive: true, withFileTypes: true });
  for (const f of files) {
    if (!f.isFile()) continue;
    const path = join(f.parentPath, f.name);
    entries.push({
      name: [...root, ...relative(folder, path).split(sep)].join('/'),
      data: new Uint8Array(await readFile(path)),
    });
  }
  return zip(entries);
}

/**
 * The data of the entry named `name` (exact, as stored), or null when the zip has no such entry or isn't
 * a zip this reader understands (stored or deflated entries, no zip64).
 */
export function readZipEntry(data: Uint8Array, name: string): Uint8Array | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // The end of central directory record: at the end, before a comment of up to 64 KiB.
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  const decoder = new TextDecoder();
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    if (at + 46 > data.length || view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const entryName = decoder.decode(data.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if (local + 30 > data.length || view.getUint32(local, true) !== 0x04034b50) return null;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const stored = data.subarray(start, start + size);
    if (method === 0) return stored;
    if (method !== 8) return null;
    try {
      return new Uint8Array(inflateRawSync(stored));
    } catch {
      return null;
    }
  }
  return null;
}
