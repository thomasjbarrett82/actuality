import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  backupIdFor,
  isReservedId,
  parseReserved,
  RESERVED,
  reservedIds,
  serializeReserved,
} from './reserved';

describe('reserved notes (04 §5.3)', () => {
  it('reads empty, "" and null as no note', () => {
    for (const text of [null, undefined, '', '  ']) {
      expect(parseReserved(RESERVED.payees, text)).toEqual({
        status: 'empty',
        value: { v: 1, disabled: [] },
      });
    }
  });

  it('validates with the schema and keeps unknown fields', () => {
    const text = JSON.stringify({
      v: 1,
      disabled: ['p1'],
      futureField: { x: 1 },
    });
    const read = parseReserved(RESERVED.payees, text);
    expect(read.status).toBe('ok');
    expect(read.value).toMatchObject({ disabled: ['p1'] });
    expect(JSON.parse(serializeReserved(read.value))).toEqual(JSON.parse(text));
  });

  it('treats bad JSON or a wrong shape as invalid, reading it as empty', () => {
    expect(parseReserved(RESERVED.payees, '{not json')).toEqual({
      status: 'invalid',
      value: { v: 1, disabled: [] },
      raw: '{not json',
    });
    expect(parseReserved(RESERVED.payees, JSON.stringify({ v: 2, disabled: [] })).status).toBe(
      'invalid',
    );
    expect(
      parseReserved(RESERVED.budget, JSON.stringify({ v: 1, carryoverSeenEnd: 'soon' })).status,
    ).toBe('invalid');
    expect(
      parseReserved(RESERVED.cellNotes, JSON.stringify({ v: 1, notes: { c1: 3 } })).status,
    ).toBe('invalid');
  });

  it('builds the reserved ids', () => {
    expect(reservedIds.cellNotes('2026-10')).toBe('ad:cellnotes:2026-10');
    expect([reservedIds.payees, reservedIds.importMappings, reservedIds.budget]).toEqual([
      'ad:payees',
      'ad:import-mappings',
      'ad:budget',
    ]);
  });

  it('never loads a backup note as metadata', () => {
    expect(isReservedId('ad:payees')).toBe(true);
    expect(isReservedId(backupIdFor('ad:payees'))).toBe(false);
    fc.assert(
      fc.property(fc.string(), (rest) => {
        expect(isReservedId(backupIdFor(`ad:${rest}`))).toBe(false);
        expect(isReservedId(`ad:${rest}`)).toBe(true);
      }),
    );
  });
});
