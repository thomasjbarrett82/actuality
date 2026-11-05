<script setup lang="ts">
// Renders a sanitized rich-text message (17 §1, 20 §1) as Vue elements. `data-event` links emit `link`;
// http(s) links open in the OS browser.
import { computed, h, type VNode } from 'vue';
import { parseRichText, type RichNode } from './rich-text';

const props = defineProps<{ text: string }>();
const emit = defineEmits<{ link: [event: string] }>();

function render(nodes: RichNode[]): (VNode | string)[] {
  return nodes.map((n): VNode | string => {
    switch (n.type) {
      case 'text':
        return n.text;
      case 'br':
        return h('br');
      case 'b':
        return h('strong', render(n.children));
      case 'i':
        return h('em', render(n.children));
      case 'p':
        return h('p', render(n.children));
      case 'a': {
        const { event, href } = n;
        return h(
          'a',
          {
            href: href ?? '#',
            onClick: (e: MouseEvent) => {
              e.preventDefault();
              if (event) emit('link', event);
              else if (href) void window.app.shell.openExternal(href);
            },
          },
          render(n.children),
        );
      }
    }
  });
}

const Content = computed(
  () => () => h('span', { class: 'rich-text' }, render(parseRichText(props.text))),
);
</script>

<template>
  <component :is="Content" />
</template>
