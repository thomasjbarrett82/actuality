// The v-tooltip directive (17 §4, 22 §4.7): shows after 650 ms on hover or keyboard focus, hides on leave
// or blur, Esc hides it without moving focus, and it stays while the pointer is over the tooltip. The
// text is always linked with aria-describedby, so screen readers read it without it being shown.
// `v-tooltip.truncated` shows an ellipsized label's full text, only while it is cut off.
import { reactive, type Directive } from 'vue';

export const SHOW_DELAY_MS = 650;
const HIDE_GRACE_MS = 120;

export const tooltipState = reactive<{
  text: string;
  anchor: HTMLElement | null;
  visible: boolean;
  hovered: boolean;
}>({
  text: '',
  anchor: null,
  visible: false,
  hovered: false,
});

type Value = string | null | undefined;

interface Instance {
  text: string;
  truncated: boolean;
  describer: HTMLElement;
  showTimer: ReturnType<typeof setTimeout> | null;
  hideTimer: ReturnType<typeof setTimeout> | null;
  cleanup: () => void;
}

const instances = new WeakMap<HTMLElement, Instance>();
let nextId = 1;

function describers(): HTMLElement {
  let host = document.getElementById('tooltip-descriptions');
  if (!host) {
    host = document.createElement('div');
    host.id = 'tooltip-descriptions';
    host.className = 'visually-hidden';
    document.body.append(host);
  }
  return host;
}

function textFor(el: HTMLElement, inst: Instance): string {
  if (!inst.truncated) return inst.text;
  return el.scrollWidth > el.clientWidth ? el.textContent.trim() : '';
}

export function hideTooltip(): void {
  tooltipState.visible = false;
  tooltipState.anchor = null;
}

function show(el: HTMLElement, inst: Instance): void {
  const text = textFor(el, inst);
  if (!text) return;
  tooltipState.text = text;
  tooltipState.anchor = el;
  tooltipState.visible = true;
}

export const vTooltip: Directive<HTMLElement, Value> = {
  mounted(el, binding) {
    const describer = document.createElement('span');
    describer.id = `tooltip-${String(nextId++)}`;
    describer.textContent = binding.value ?? '';
    describers().append(describer);
    const truncated = binding.modifiers['truncated'] === true;
    if (!truncated)
      el.setAttribute(
        'aria-describedby',
        [el.getAttribute('aria-describedby'), describer.id].filter(Boolean).join(' '),
      );

    const inst: Instance = {
      text: binding.value ?? '',
      truncated,
      describer,
      showTimer: null,
      hideTimer: null,
      cleanup: () => undefined,
    };
    const schedule = (): void => {
      if (inst.hideTimer) clearTimeout(inst.hideTimer);
      if (tooltipState.anchor === el && tooltipState.visible) return;
      if (inst.showTimer) clearTimeout(inst.showTimer);
      inst.showTimer = setTimeout(() => {
        show(el, inst);
      }, SHOW_DELAY_MS);
    };
    const leave = (): void => {
      if (inst.showTimer) clearTimeout(inst.showTimer);
      inst.hideTimer = setTimeout(() => {
        if (tooltipState.anchor === el && !tooltipState.hovered) hideTooltip();
      }, HIDE_GRACE_MS);
    };
    const blur = (): void => {
      if (inst.showTimer) clearTimeout(inst.showTimer);
      if (tooltipState.anchor === el) hideTooltip();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && tooltipState.anchor === el && tooltipState.visible) hideTooltip();
    };
    el.addEventListener('mouseenter', schedule);
    el.addEventListener('mouseleave', leave);
    el.addEventListener('focusin', schedule);
    el.addEventListener('focusout', blur);
    el.addEventListener('keydown', key);
    inst.cleanup = () => {
      el.removeEventListener('mouseenter', schedule);
      el.removeEventListener('mouseleave', leave);
      el.removeEventListener('focusin', schedule);
      el.removeEventListener('focusout', blur);
      el.removeEventListener('keydown', key);
    };
    instances.set(el, inst);
  },
  updated(el, binding) {
    const inst = instances.get(el);
    if (!inst) return;
    inst.text = binding.value ?? '';
    inst.describer.textContent = inst.text;
    if (tooltipState.anchor === el) tooltipState.text = textFor(el, inst);
  },
  beforeUnmount(el) {
    const inst = instances.get(el);
    if (!inst) return;
    inst.cleanup();
    if (inst.showTimer) clearTimeout(inst.showTimer);
    if (inst.hideTimer) clearTimeout(inst.hideTimer);
    inst.describer.remove();
    if (tooltipState.anchor === el) hideTooltip();
    instances.delete(el);
  },
};
