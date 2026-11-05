<script setup lang="ts">
// Renders the TaskDialog stack (17 §1), topmost last.
import { useDialogs } from '../../stores/dialogs';
import TaskDialog from './TaskDialog.vue';

const dialogs = useDialogs();
</script>

<template>
  <TaskDialog
    v-for="d in dialogs.stack"
    :key="d.id"
    :options="d.options"
    @close="(result) => dialogs.close(d.id, result)"
  />
</template>
