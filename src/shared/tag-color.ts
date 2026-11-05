// Tag pill colors (05 §1.7): the foreground is black or white, whichever has the stronger WCAG contrast against
// the tag's color. Tag colors are user data shared with other Actual clients, so they never follow the palette.

const CHANNEL = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** WCAG relative luminance of `#RRGGBB`; null for anything else (Actual stores other color strings as is). */
function luminance(hex: string): number | null {
  const m = CHANNEL.exec(hex);
  if (!m) return null;
  const [r = 0, g = 0, b = 0] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h ?? '0', 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The text color for a pill on `background` (`#RRGGBB`); null when the color can't be read. */
export function tagTextColor(background: string): '#000000' | '#ffffff' | null {
  const l = luminance(background);
  if (l === null) return null;
  // Contrast with white is 1.05 / (l + 0.05); with black, (l + 0.05) / 0.05.
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}
