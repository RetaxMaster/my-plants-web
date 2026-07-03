<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import Badge from './Badge.vue';
import Button from './Button.vue';
import { TASK_LABELS, type TaskCode } from '~/utils/tasks';
import { TASK_ICONS } from '~/composables/useTaskMeta';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    task: TaskCode;
    status: 'overdue' | 'today' | 'upcoming';
    dueLabel: string;
    withDoneDate?: boolean;
  }>(),
  { withDoneDate: false },
);

const emit = defineEmits<{
  done: [{ task: TaskCode; occurredOn?: string }];
  postpone: [{ task: TaskCode }];
  logProgress: [{ task: TaskCode }];
}>();

const doneDate = ref('');

const badgeColor = computed(() =>
  props.status === 'overdue' ? 'red' : props.status === 'today' ? 'amber' : 'neutral',
);

const onDone = () => emit('done', { task: props.task, occurredOn: doneDate.value || undefined });
const onPostpone = () => emit('postpone', { task: props.task });
const onLogProgress = () => emit('logProgress', { task: props.task });
</script>

<template>
  <div class="mp-taskrow" v-bind="$attrs">
    <div class="mp-taskrow__meta">
      <AppIcon :name="TASK_ICONS[task]" :size="18" class="mp-taskrow__icon" />
      <span class="mp-taskrow__label">{{ TASK_LABELS[task] }}</span>
      <Badge :color="badgeColor" size="xs">{{ dueLabel }}</Badge>
    </div>
    <div class="mp-taskrow__actions">
      <template v-if="task === 'PROGRESS'">
        <Button size="xs" color="primary" icon="camera" @click="onLogProgress">Log progress</Button>
      </template>
      <template v-else>
        <input
          v-if="withDoneDate"
          v-model="doneDate"
          type="date"
          class="mp-taskrow__date"
          aria-label="Date the task was done"
        />
        <Button size="xs" color="primary" icon="check" @click="onDone">Done</Button>
        <Button size="xs" color="neutral" variant="ghost" icon="clock" @click="onPostpone">
          Postpone
        </Button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mp-taskrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  flex-wrap: wrap;
}

.mp-taskrow__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.mp-taskrow__icon {
  color: var(--text-muted);
  flex: none;
}

.mp-taskrow__label {
  font-family: var(--font-sans);
  font-weight: var(--weight-semibold);
  font-size: var(--text-sm);
  color: var(--text-strong);
}

.mp-taskrow__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.mp-taskrow__date {
  height: 28px;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-strong);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 0 var(--space-2);
  outline: none;
}

.mp-taskrow__date:focus {
  border-color: var(--border-brand);
  box-shadow: var(--shadow-focus);
}
</style>
