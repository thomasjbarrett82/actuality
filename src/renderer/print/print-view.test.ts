import { describe, expect, it } from 'vitest';
import { PRINT_PALETTES, printDocument } from './print-view';

describe('print page numbering (16 §3)', () => {
  it('adds a localized Page N of M footer to the document', () => {
    const html = printDocument('Register', '<main></main>', PRINT_PALETTES.standard);
    expect(html).toContain('@bottom-center');
    expect(html).toContain('counter(page)');
    expect(html).toContain('counter(pages)');
  });
});
