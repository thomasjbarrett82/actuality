// Reading an Actual export's budget type before an import uploads it (03 §6.1, 07 §3.4).
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isTrackingExport } from './budget-export';
import { exportZip } from './testing/export-zip';
import { readZipEntry, zip } from './zip';

describe('isTrackingExport', () => {
  it('reads the synced pref from db.sqlite', () => {
    expect(isTrackingExport(exportZip({ prefs: { budgetType: 'tracking' } }))).toBe(true);
    expect(isTrackingExport(exportZip({ prefs: { budgetType: 'envelope' } }))).toBe(false);
    expect(isTrackingExport(exportZip({ prefs: {} }))).toBe(false);
  });

  it('lets the preferences table win over metadata.json', () => {
    const z = exportZip({ prefs: { budgetType: 'envelope' }, metadata: { budgetType: 'report' } });
    expect(isTrackingExport(z)).toBe(false);
  });

  it('reads metadata.json in an export from before the preferences table', () => {
    expect(isTrackingExport(exportZip({ prefs: null, metadata: { budgetType: 'report' } }))).toBe(
      true,
    );
    expect(isTrackingExport(exportZip({ prefs: null, metadata: { budgetType: 'rollover' } }))).toBe(
      false,
    );
    expect(isTrackingExport(exportZip({ prefs: null }))).toBe(false);
  });

  it('counts a file it cannot read as not tracking', () => {
    expect(isTrackingExport(new TextEncoder().encode('not a zip'))).toBe(false);
    const noDb = zip([{ name: 'metadata.json', data: new TextEncoder().encode('{}') }]);
    expect(isTrackingExport(noDb)).toBe(false);
    const badDb = zip([{ name: 'db.sqlite', data: new TextEncoder().encode('garbage') }]);
    expect(isTrackingExport(badDb)).toBe(false);
  });
});

describe('readZipEntry', () => {
  const text = (data: Uint8Array | null): string | null =>
    data ? new TextDecoder().decode(data) : null;

  it('reads stored entries by exact name', () => {
    const z = zip([
      { name: 'a.txt', data: new TextEncoder().encode('first') },
      { name: 'dir/b.txt', data: new TextEncoder().encode('second') },
    ]);
    expect(text(readZipEntry(z, 'dir/b.txt'))).toBe('second');
    expect(readZipEntry(z, 'b.txt')).toBeNull();
  });

  it('inflates deflated entries', () => {
    const body = 'hello hello hello hello';
    const z = zip([{ name: 'x.txt', data: new Uint8Array(deflateRawSync(body)) }]);
    // Mark the entry deflated in its local header and its central directory record.
    const view = new DataView(z.buffer);
    view.setUint16(8, 8, true);
    view.setUint16(view.getUint32(z.length - 22 + 16, true) + 10, 8, true);
    expect(text(readZipEntry(z, 'x.txt'))).toBe(body);
  });
});
