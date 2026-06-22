<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

type Color = 'amber' | 'red' | 'green';

const props = withDefaults(
  defineProps<{
    color?: Color;
    title?: string;
    description?: string;
    icon?: string;
  }>(),
  {
    color: 'amber',
  },
);

const defaultIcons: Record<Color, string> = {
  green: 'check-circle',
  amber: 'exclamation-triangle',
  red: 'x-circle',
};

// icon === '' explicitly hides the icon; undefined uses the per-color default.
const resolvedIcon = computed(() =>
  props.icon === undefined ? defaultIcons[props.color] : props.icon || undefined,
);
</script>

<template>
  <div :class="['mp-alert', `mp-alert--${color}`]" v-bind="$attrs">
    <AppIcon v-if="resolvedIcon" :name="resolvedIcon" :size="20" class="mp-alert__icon" />
    <div class="mp-alert__body">
      <div v-if="title" class="mp-alert__title">{{ title }}</div>
      <div v-if="description" class="mp-alert__description">{{ description }}</div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.mp-alert {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
}

.mp-alert__icon {
  margin-top: 1px;
  flex: none;
}

.mp-alert__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mp-alert__title {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.mp-alert__description {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-body);
  line-height: var(--leading-snug);
}

.mp-alert--green {
  background: var(--care-good-bg);
  border-color: color-mix(in oklch, var(--care-good) 35%, transparent);
}
.mp-alert--green .mp-alert__icon {
  color: var(--care-good);
}
.mp-alert--green .mp-alert__title {
  color: var(--care-good-text);
}

.mp-alert--amber {
  background: var(--care-caution-bg);
  border-color: color-mix(in oklch, var(--care-caution) 35%, transparent);
}
.mp-alert--amber .mp-alert__icon {
  color: var(--care-caution);
}
.mp-alert--amber .mp-alert__title {
  color: var(--care-caution-text);
}

.mp-alert--red {
  background: var(--care-poor-bg);
  border-color: color-mix(in oklch, var(--care-poor) 35%, transparent);
}
.mp-alert--red .mp-alert__icon {
  color: var(--care-poor);
}
.mp-alert--red .mp-alert__title {
  color: var(--care-poor-text);
}
</style>
