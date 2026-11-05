import { describe, expect, it } from 'vitest';
import { tagTextColor } from './tag-color';

describe('tag text color (05 §1.7)', () => {
  it('picks the stronger of black and white', () => {
    expect(tagTextColor('#ffffff')).toBe('#000000');
    expect(tagTextColor('#E8C930')).toBe('#000000');
    expect(tagTextColor('#000000')).toBe('#ffffff');
    expect(tagTextColor('#3D8FD6')).toBe('#000000');
    expect(tagTextColor('#4e5e94')).toBe('#ffffff');
  });

  it('gives null for a color it cannot read', () => {
    expect(tagTextColor('red')).toBeNull();
    expect(tagTextColor('#fff')).toBeNull();
  });
});
