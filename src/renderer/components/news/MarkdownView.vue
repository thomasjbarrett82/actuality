<script setup lang="ts">
// Feed Markdown as Vue elements (24 §4.6): parsed by markdown.ts, never rendered with v-html. Links open
// in the OS browser through shell.openExternal (http/https only, 02 §6).
import { computed, h, type VNode } from 'vue';
import { parseMarkdown, type MdNode } from './markdown';

const props = defineProps<{ source: string }>();

function render(nodes: MdNode[]): (VNode | string)[] {
  return nodes.map((n): VNode | string => {
    switch (n.type) {
      case 'text':
        return n.text;
      case 'link':
        return h(
          'a',
          {
            href: n.href,
            class: 'markdown__link',
            onClick: (e: MouseEvent) => {
              e.preventDefault();
              void window.app.shell.openExternal(n.href);
            },
          },
          render(n.children),
        );
      case 'element': {
        const children = render(n.children);
        const el = h(n.tag, n.attrs, children.length > 0 ? children : undefined);
        // A wide table scrolls on its own instead of widening the card.
        return n.tag === 'table' ? h('div', { class: 'markdown__table' }, [el]) : el;
      }
    }
  });
}

const Content = computed(
  () => () => h('div', { class: 'markdown' }, render(parseMarkdown(props.source))),
);
</script>

<template>
  <component :is="Content" />
</template>

<style scoped>
.markdown {
  overflow-wrap: anywhere;
}

.markdown :deep(> :first-child) {
  margin-top: 0;
}

.markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown :deep(p),
.markdown :deep(ul),
.markdown :deep(ol),
.markdown :deep(blockquote),
.markdown :deep(pre),
.markdown :deep(.markdown__table) {
  margin: var(--space-3) 0;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  padding-left: var(--space-6);
}

.markdown :deep(h4),
.markdown :deep(h5),
.markdown :deep(h6) {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--font-md);
  font-weight: 700;
}

.markdown :deep(h5),
.markdown :deep(h6) {
  font-size: var(--font-body);
}

.markdown :deep(blockquote) {
  padding-left: var(--space-4);
  border-left: 3px solid var(--register-border);
  color: var(--text-subtle);
}

.markdown :deep(code) {
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--register-gray-bg);
  font-family: ui-monospace, monospace;
  font-size: var(--font-sm);
}

.markdown :deep(pre) {
  overflow-x: auto;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--register-gray-bg);
}

.markdown :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown :deep(hr) {
  border: 0;
  border-top: 1px solid var(--register-border);
}

.markdown :deep(.markdown__table) {
  overflow-x: auto;
}

.markdown :deep(table) {
  border-collapse: collapse;
}

.markdown :deep(th),
.markdown :deep(td) {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--register-border);
  text-align: start;
}

.markdown :deep(.markdown__link) {
  color: var(--link);
}
</style>
