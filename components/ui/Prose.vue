<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  html: string;
  class?: unknown;
}>();
</script>

<template>
  <div :class="['mp-prose', props.class]" v-bind="$attrs" v-html="html" />
</template>
