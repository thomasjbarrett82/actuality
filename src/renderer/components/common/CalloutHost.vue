<script setup lang="ts">
// Renders the callouts opened through the callout service (17 §3). The inner component can close its
// callout with a result by emitting `close`.
import { useCallouts } from '../../stores/callouts';
import Callout from './Callout.vue';

const callouts = useCallouts();
</script>

<template>
  <Callout
    v-for="c in callouts.open"
    :key="c.id"
    v-bind="c.options"
    @close="(result) => callouts.close(c.id, result)"
  >
    <component
      :is="c.component"
      v-bind="c.props"
      @close="(result: string) => callouts.close(c.id, result)"
    />
  </Callout>
</template>
