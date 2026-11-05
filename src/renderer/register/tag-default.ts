// The text color for a tag pill that has no color of its own (05 §1.7): black or white, whichever has the
// stronger contrast on the palette's `--tag-default-bg`. The palette changes with the theme and the
// color-vision setting (data-theme / data-cvd on <html>, `theme.ts`), so the value follows those attributes.
import { tagTextColor } from '@shared/tag-color';
import { ref, type Ref } from 'vue';

const text = ref<string>('#000000');
let watching = false;

function read(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--tag-default-bg').trim();
  text.value = tagTextColor(bg) ?? '#000000';
}

/** The pill text color on the default tag background, kept current as the palette changes. */
export function useDefaultTagText(): Readonly<Ref<string>> {
  read();
  if (!watching) {
    watching = true;
    new MutationObserver(read).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-cvd'],
    });
  }
  return text;
}
