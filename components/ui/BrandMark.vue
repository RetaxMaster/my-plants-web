<script setup lang="ts">
// The single canonical 🌱 MyPlants wordmark. Per the brand-in-one-component
// rule, this is the only place the lockup is authored — every surface that
// shows the brand renders <UiBrandMark> instead of repeating the markup.
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ to?: string }>(), { to: '/' });
</script>

<template>
  <NuxtLink :to="to" class="mp-brand" v-bind="$attrs">
    <span class="mp-brand__leaf" aria-hidden="true">🌱</span>
    <span class="mp-brand__name">MyPlants</span>
  </NuxtLink>
</template>

<style scoped>
.mp-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  text-decoration: none;
}

.mp-brand__leaf {
  font-size: 22px;
  line-height: 1;
}

.mp-brand__name {
  font: 800 18px var(--font-sans);
  letter-spacing: -0.02em;
  color: var(--text-brand);
}
</style>
