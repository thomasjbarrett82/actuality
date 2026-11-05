<script setup lang="ts">
// A panel's one <h1> (22 §4.1). Focus moves to it after a panel switch (22 §3); `ready` marks it once the
// panel is shown, for callouts that point at it (13 §4). `id` lets a region name itself by it (22 §4.1).
defineProps<{ text: string; ready?: boolean; hidden?: boolean; id?: string }>();
</script>

<template>
  <h1
    :id="id"
    class="panel-heading"
    :class="{ 'visually-hidden': hidden }"
    tabindex="-1"
    data-panel-heading
    :data-ready="ready ? 'true' : 'false'"
  >
    {{ text }}
  </h1>
</template>

<style scoped>
.panel-heading {
  margin: 0;
  padding: var(--space-5) var(--space-6) var(--space-3);
  color: var(--text-strong);
  font-size: var(--font-2xl);
  font-weight: 400;
}
</style>
