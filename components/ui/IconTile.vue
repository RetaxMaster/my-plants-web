<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

type Tone = 'green' | 'cafe';

const props = withDefaults(
  defineProps<{
    icon: string;
    tone?: Tone;
    size?: number;
    class?: unknown;
  }>(),
  {
    tone: 'green',
    size: 44,
  },
);

const iconSize = computed(() => Math.round(props.size * 0.45));
const ink = computed(() =>
  props.tone === 'cafe' ? 'var(--accent-cafe-ink)' : 'var(--accent-green-ink)',
);
</script>

<template>
  <div
    :class="['mp-icon-tile', `mp-icon-tile--${tone}`, props.class]"
    :style="{ width: size + 'px', height: size + 'px' }"
    v-bind="$attrs"
  >
    <AppIcon :name="icon" :size="iconSize" :color="ink" />
  </div>
</template>

<style scoped>
.mp-icon-tile {
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.mp-icon-tile--green {
  background: var(--accent-green-surface);
}

.mp-icon-tile--cafe {
  background: var(--accent-cafe-surface);
}
</style>
