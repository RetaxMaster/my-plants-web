<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
  back?: string;
  class?: unknown;
}>();

defineEmits<{ back: [] }>();
</script>

<template>
  <div :class="['mp-screen-header', props.class]" v-bind="$attrs">
    <button v-if="back" type="button" class="mp-backlink" @click="$emit('back')">
      <AppIcon name="chevron-left" :size="16" color="currentColor" />
      {{ back }}
    </button>
    <div class="mp-screen-header__row">
      <div class="mp-screen-header__titles">
        <div v-if="eyebrow" class="mp-eyebrow">{{ eyebrow }}</div>
        <h1 class="mp-screen-header__title">{{ title }}</h1>
        <p v-if="subtitle" class="mp-screen-header__subtitle">{{ subtitle }}</p>
      </div>
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.mp-screen-header {
  margin-bottom: 18px;
}

.mp-screen-header__row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.mp-screen-header__title {
  font: 800 clamp(24px, 4vw, 32px) var(--font-sans);
  letter-spacing: -0.02em;
  color: var(--text-strong);
  margin: 0;
}

.mp-screen-header__subtitle {
  margin: 6px 0 0;
  font: 15px var(--font-sans);
  color: var(--text-muted);
}
</style>
