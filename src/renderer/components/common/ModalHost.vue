<script setup lang="ts">
// Renders the standard dialogs opened through the modal service (17 §2). A dialog closes itself by
// emitting `close` with its result.
import { useModals } from '../../stores/modals';

const modals = useModals();
</script>

<template>
  <component
    :is="m.component"
    v-for="m in modals.stack"
    :key="m.id"
    v-bind="m.props"
    @close="(result: unknown) => modals.close(m.id, result)"
  />
</template>
