<script setup lang="ts">
import type { HistoryItem } from '../types/api.js';
import { TASK_PAST_LABELS } from '../utils/tasks.js';
import { TASK_ICONS } from '../composables/useTaskMeta';

defineProps<{ items: HistoryItem[] }>();
const emit = defineEmits<{ openEntry: [entryId: string] }>();

const MS_DAY = 86_400_000;
// Relative phrasing for a past YYYY-MM-DD ("today" / "yesterday" / "N days ago").
function agoLabel(occurredOn: string): string {
  const [y, m, d] = occurredOn.split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((today - then) / MS_DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

const HEALTH_LABELS: Record<string, string> = { SICK: 'Sick', POOR: 'Poor', GOOD: 'Good', EXCELLENT: 'Excellent' };
</script>

<template>
  <ol class="mp-history">
    <li v-for="(item, i) in items" :key="i" class="mp-history__item">
      <template v-if="item.kind === 'progress'">
        <button type="button" class="mp-history__row mp-history__row--link" @click="emit('openEntry', item.entryId)">
          <UiAppIcon name="camera" :size="18" class="mp-history__icon" />
          <span class="mp-history__text">
            Progress logged · <strong>{{ HEALTH_LABELS[item.health] }}</strong>
            <span v-if="item.photoCount" class="mp-history__meta"> · {{ item.photoCount }} photo(s)</span>
            <span v-if="item.tagCount" class="mp-history__meta"> · {{ item.tagCount }} tag(s)</span>
          </span>
          <span class="mp-history__date">{{ agoLabel(item.occurredOn) }}</span>
          <UiAppIcon name="chevron-right" :size="16" color="var(--text-faint)" />
        </button>
      </template>
      <template v-else>
        <div class="mp-history__row">
          <UiAppIcon :name="TASK_ICONS[item.task]" :size="18" class="mp-history__icon" />
          <span class="mp-history__text">{{ TASK_PAST_LABELS[item.task] }}</span>
          <span class="mp-history__date">{{ agoLabel(item.occurredOn) }}</span>
        </div>
      </template>
    </li>
  </ol>
</template>

<style scoped>
.mp-history { list-style: none; margin: 0; padding: 0; display: grid; }
.mp-history__item:not(:last-child) .mp-history__row { border-bottom: 1px solid var(--border-subtle); }

.mp-history__row {
  display: flex; align-items: center; gap: var(--space-2);
  width: 100%; padding: var(--space-3) 0; text-align: left;
  background: transparent; border: none; font-family: var(--font-sans);
}
.mp-history__row--link { cursor: pointer; }
.mp-history__row--link:hover .mp-history__text { color: var(--text-brand); }
.mp-history__row--link:focus-visible { outline: none; box-shadow: var(--shadow-focus); border-radius: var(--radius-md); }

.mp-history__icon { color: var(--text-muted); flex: none; }
.mp-history__text { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--text-strong); }
.mp-history__meta { color: var(--text-muted); }
.mp-history__date { font-size: var(--text-xs); color: var(--text-faint); white-space: nowrap; }
</style>
