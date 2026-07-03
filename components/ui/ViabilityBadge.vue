<script setup lang="ts">
import Badge from './Badge.vue';

defineOptions({ inheritAttrs: false });

type Level = 'good' | 'caution' | 'poor';

const props = withDefaults(
  defineProps<{
    level?: Level;
    reasons?: string[];
    showReasons?: boolean;
    class?: unknown;
  }>(),
  {
    level: 'good',
    reasons: () => [],
    showReasons: true,
  },
);

const { t } = useI18n();

const meta = computed(() => {
  const map = {
    good: { color: 'green' as const, label: t('viability.good') },
    caution: { color: 'amber' as const, label: t('viability.caution') },
    poor: { color: 'red' as const, label: t('viability.poor') },
  };
  return map[props.level] ?? map.good;
});
</script>

<template>
  <div :class="['mp-viability', props.class]" v-bind="$attrs">
    <Badge :color="meta.color" size="md" dot>{{ meta.label }}</Badge>
    <ul v-if="showReasons && reasons.length > 0" class="mp-viability__reasons">
      <li v-for="(reason, i) in reasons" :key="i" class="mp-viability__reason">
        <span class="mp-viability__bullet">·</span>
        {{ reason }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mp-viability {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: flex-start;
}

.mp-viability__reasons {
  margin: var(--space-1) 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-family: var(--font-sans);
}

.mp-viability__reason {
  display: flex;
  gap: 6px;
  margin: 2px 0;
}

.mp-viability__bullet {
  color: var(--text-faint);
}
</style>
