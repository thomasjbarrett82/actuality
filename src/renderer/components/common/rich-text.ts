// Rich-text messages (17 §1, 20 §1): a small parser to a node tree, rendered as Vue elements, never with
// v-html. Allowed: b, i, br, p and a (data-event or http/https href); **bold**, *italic*; \r\n, \r, \n →
// line breaks. Every other tag is dropped, keeping its text.

export type RichNode =
  | { type: 'text'; text: string }
  | { type: 'br' }
  | { type: 'b' | 'i' | 'p'; children: RichNode[] }
  | { type: 'a'; event?: string; href?: string; children: RichNode[] };

interface Frame {
  tag: 'root' | 'b' | 'i' | 'p' | 'a' | 'drop';
  name: string;
  node: { children: RichNode[] };
}

const ATTR = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m?.[1] ?? m?.[2];
};

/** Splits plain text into text, line breaks and **bold** / *italic* runs. */
function inline(text: string, into: RichNode[]): void {
  const parts = text.split(/(\r\n|\r|\n|\*\*[^*]+\*\*|\*[^*\n]+\*)/);
  for (const part of parts) {
    if (!part) continue;
    if (/^(\r\n|\r|\n)$/.test(part)) into.push({ type: 'br' });
    else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      into.push({ type: 'b', children: [{ type: 'text', text: part.slice(2, -2) }] });
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      into.push({ type: 'i', children: [{ type: 'text', text: part.slice(1, -1) }] });
    } else into.push({ type: 'text', text: decode(part) });
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ast: '*',
  nbsp: ' ',
};
const decode = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos|nbsp|ast);/g, (_, e: string) => ENTITIES[e] ?? _);

/** User text (an account or category name) in a rich-text message: shown as typed, never as markup. */
export function escapeRichText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('*', '&ast;')
    .replace(/\r\n|\r|\n/g, ' ');
}

export function parseRichText(markup: string): RichNode[] {
  const root: Frame = { tag: 'root', name: '', node: { children: [] } };
  const stack: Frame[] = [root];
  const top = (): Frame => stack[stack.length - 1] ?? root;
  const re = /<\s*(\/?)\s*([a-zA-Z]+)([^>]*?)(\/?)\s*>/g;
  let last = 0;
  for (const m of markup.matchAll(re)) {
    inline(markup.slice(last, m.index), top().node.children);
    last = m.index + m[0].length;
    const [, closing, rawName = '', attrs = '', selfClosing] = m;
    const name = rawName.toLowerCase();
    if (name === 'br') {
      top().node.children.push({ type: 'br' });
      continue;
    }
    if (closing) {
      const i = stack.map((f) => f.name).lastIndexOf(name);
      if (i > 0) stack.length = i;
      continue;
    }
    if (selfClosing) continue;
    let frame: Frame;
    if (name === 'b' || name === 'strong' || name === 'i' || name === 'em' || name === 'p') {
      const type = name === 'strong' ? 'b' : name === 'em' ? 'i' : name;
      const node: RichNode = { type, children: [] };
      top().node.children.push(node);
      frame = { tag: type, name, node };
    } else if (
      name === 'a' &&
      (ATTR(attrs, 'data-event') || /^https?:/i.test(ATTR(attrs, 'href') ?? ''))
    ) {
      const event = ATTR(attrs, 'data-event');
      const href = ATTR(attrs, 'href');
      const node: RichNode = {
        type: 'a',
        children: [],
        ...(event ? { event } : href ? { href } : {}),
      };
      top().node.children.push(node);
      frame = { tag: 'a', name, node };
    } else {
      // Unknown tag, or a link to anything else: keep its text in the current parent.
      frame = { tag: 'drop', name, node: top().node };
    }
    stack.push(frame);
  }
  inline(markup.slice(last), top().node.children);
  return root.node.children;
}
