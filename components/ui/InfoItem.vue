<script setup lang="ts">
// One care-basis factor. Shows an icon tile + value + label. When `value` is null the item enters its
// Missing-info state: a caution-tinted value reading `missingLabel` (the caller passes the i18n string).
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    icon: string;
    label: string;
    value?: string | null;
    missingLabel: string;
    class?: unknown;
  }>(),
  {
    value: null,
  },
);

const isMissing = computed(() => props.value === null || props.value === undefined || props.value === '');
</script>

<template>
  <div :class="['mp-infoitem', { 'mp-infoitem--missing': isMissing }, props.class]" v-bind="$attrs">
    <span class="mp-infoitem__tile">
      <AppIcon :name="icon" :size="16" color="var(--accent-green-ink)" />
    </span>
    <span class="mp-infoitem__text">
      <span class="mp-infoitem__value">{{ isMissing ? missingLabel : value }}</span>
      <span class="mp-infoitem__label">{{ label }}</span>
    </span>
  </div>
</template>

<style scoped>
.mp-infoitem {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.mp-infoitem__tile {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--accent-green-surface);
}

.mp-infoitem__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mp-infoitem__value {
  font: var(--weight-semibold) var(--text-sm) / 1.2 var(--font-sans);
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-infoitem__label {
  font: var(--text-xs) / 1.2 var(--font-sans);
  color: var(--text-muted);
  margin-top: 2px;
}

.mp-infoitem--missing .mp-infoitem__tile {
  background: var(--care-caution-bg);
}

.mp-infoitem--missing .mp-infoitem__value {
  color: var(--care-caution-text);
  font-weight: var(--weight-medium);
}
</style>
