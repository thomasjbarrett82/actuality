// Markdown from the news feed (24 §4.6), which is untrusted content: markdown-it parses it with raw HTML,
// linkify and typographer off, so leftover HTML shows as text, and its token stream becomes a small node
// tree that MarkdownView renders as Vue elements (never `v-html`, 20 §1). Headings are demoted below the
// card's h3. Only http(s) targets become links; an image becomes a link to its URL, labeled with its alt
// text, because the CSP allows no remote images (02 §6).
import MarkdownIt, { type Token } from 'markdown-it';

export type MdNode =
  | { type: 'text'; text: string }
  | { type: 'element'; tag: string; attrs: Record<string, string>; children: MdNode[] }
  | { type: 'link'; href: string; children: MdNode[] };

type ElementNode = Extract<MdNode, { type: 'element' }>;

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** An absolute http(s) URL, or null. */
export function webUrl(raw: string): string | null {
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** `#`/`##` → h4, `###` → h5, deeper → h6: under the card's h3. */
export function demotedHeading(level: number): 'h4' | 'h5' | 'h6' {
  return level <= 2 ? 'h4' : level === 3 ? 'h5' : 'h6';
}

const BLOCK_TAGS: Record<string, string> = {
  paragraph_open: 'p',
  bullet_list_open: 'ul',
  ordered_list_open: 'ol',
  list_item_open: 'li',
  blockquote_open: 'blockquote',
  table_open: 'table',
  thead_open: 'thead',
  tbody_open: 'tbody',
  tr_open: 'tr',
  th_open: 'th',
  td_open: 'td',
};

const INLINE_TAGS: Record<string, string> = {
  strong_open: 'strong',
  em_open: 'em',
  s_open: 's',
};

const element = (tag: string, attrs: Record<string, string> = {}): ElementNode => ({
  type: 'element',
  tag,
  attrs,
  children: [],
});

function plainText(tokens: readonly Token[] | null): string {
  return (tokens ?? [])
    .map((t) => (t.children ? plainText(t.children) : t.type === 'softbreak' ? ' ' : t.content))
    .join('');
}

function appendText(into: MdNode[], text: string): void {
  if (!text) return;
  const last = into.at(-1);
  if (last?.type === 'text') last.text += text;
  else into.push({ type: 'text', text });
}

/** Inline tokens → nodes. A link to anything but http(s) keeps only its text. */
function inline(tokens: readonly Token[]): MdNode[] {
  const root: MdNode[] = [];
  // Each frame is where children go; a dropped link is a frame that shares its parent's list.
  const stack: { children: MdNode[]; closes: string }[] = [{ children: root, closes: '' }];
  const top = (): MdNode[] => stack.at(-1)?.children ?? root;
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        appendText(top(), t.content);
        break;
      case 'softbreak':
        appendText(top(), '\n');
        break;
      case 'hardbreak':
        top().push(element('br'));
        break;
      case 'code_inline': {
        const code = element('code');
        code.children.push({ type: 'text', text: t.content });
        top().push(code);
        break;
      }
      case 'link_open': {
        const href = webUrl(String(t.attrGet('href') ?? ''));
        if (href) {
          const link: MdNode = { type: 'link', href, children: [] };
          top().push(link);
          stack.push({ children: link.children, closes: 'link_close' });
        } else {
          stack.push({ children: top(), closes: 'link_close' });
        }
        break;
      }
      case 'image': {
        const alt = plainText(t.children) || t.content;
        const src = webUrl(String(t.attrGet('src') ?? ''));
        if (src)
          top().push({ type: 'link', href: src, children: [{ type: 'text', text: alt || src }] });
        else appendText(top(), alt);
        break;
      }
      default: {
        const tag = INLINE_TAGS[t.type];
        if (tag) {
          const el = element(tag);
          top().push(el);
          stack.push({ children: el.children, closes: t.type.replace('_open', '_close') });
        } else if (stack.length > 1 && t.type === stack.at(-1)?.closes) {
          stack.pop();
        } else if (t.content) {
          appendText(top(), t.content);
        }
      }
    }
  }
  return root;
}

function cellAttrs(t: Token): Record<string, string> {
  const style = String(t.attrGet('style') ?? '');
  const m = /text-align:\s*(left|center|right)/.exec(style);
  return m?.[1] ? { style: `text-align: ${m[1]}` } : {};
}

/** Parses feed Markdown into a node tree. */
export function parseMarkdown(src: string): MdNode[] {
  const root = element('root');
  const stack: ElementNode[] = [root];
  const top = (): ElementNode => stack.at(-1) ?? root;
  /** Hidden paragraphs (tight lists) add no element; their content goes to the list item. */
  const hidden: boolean[] = [];
  for (const t of md.parse(src, {})) {
    if (t.type === 'paragraph_open' || t.type === 'paragraph_close') {
      if (t.nesting === 1) hidden.push(t.hidden);
      const isHidden = t.nesting === 1 ? t.hidden : hidden.pop() === true;
      if (isHidden) continue;
    }
    if (t.nesting === 1) {
      let el: ElementNode;
      if (t.type === 'heading_open') el = element(demotedHeading(Number(t.tag.slice(1))));
      else if (t.type === 'ordered_list_open') {
        const start = t.attrGet('start');
        el = element('ol', start === null ? {} : { start: String(start) });
      } else if (t.type === 'th_open' || t.type === 'td_open')
        el = element(BLOCK_TAGS[t.type] ?? 'td', cellAttrs(t));
      else el = element(BLOCK_TAGS[t.type] ?? 'div');
      top().children.push(el);
      stack.push(el);
      continue;
    }
    if (t.nesting === -1) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    switch (t.type) {
      case 'inline':
        top().children.push(...inline(t.children ?? []));
        break;
      case 'fence':
      case 'code_block': {
        const pre = element('pre');
        const code = element('code');
        code.children.push({ type: 'text', text: t.content.replace(/\n$/, '') });
        pre.children.push(code);
        top().children.push(pre);
        break;
      }
      case 'hr':
        top().children.push(element('hr'));
        break;
      default:
        // html_block can't occur with `html: false`; anything else unknown shows as its text.
        if (t.content) top().children.push({ type: 'text', text: t.content });
    }
  }
  return root.children;
}
