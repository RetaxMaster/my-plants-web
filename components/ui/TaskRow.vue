<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import Badge from './Badge.vue';
import Button from './Button.vue';
import type { TaskCode } from '~/utils/tasks';
import { useTaskMeta } from '~/composables/useTaskMeta';

defineOptions({ inheritAttrs: false });

const { TASK_ICONS, taskLabel } = useTaskMeta();
const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    task: TaskCode;
    status: 'overdue' | 'today' | 'upcoming';
    dueLabel: string;
    withDoneDate?: boolean;
    showInfo?: boolean;
  }>(),
  { withDoneDate: false, showInfo: false },
);

const emit = defineEmits<{
  done: [{ task: TaskCode; occurredOn?: string }];
  postpone: [{ task: TaskCode }];
  logProgress: [{ task: TaskCode }];
  info: [{ task: TaskCode }];
}>();

const doneDate = ref('');

const badgeColor = computed(() =>
  props.status === 'overdue' ? 'red' : props.status === 'today' ? 'amber' : 'neutral',
);

const onDone = () => emit('done', { task: props.task, occurredOn: doneDate.value || undefined });
const onPostpone = () => emit('postpone', { task: props.task });
const onLogProgress = () => emit('logProgress', { task: props.task });
const onInfo = () => emit('info', { task: props.task });
</script>

<template>
  <div class="mp-taskrow" v-bind="$attrs">
    <div class="mp-taskrow__meta">
      <AppIcon :name="TASK_ICONS[task]" :size="18" class="mp-taskrow__icon" />
      <span class="mp-taskrow__label">{{ taskLabel(task) }}</span>
      <Badge :color="badgeColor" size="xs">{{ dueLabel }}</Badge>
      <button
        v-if="showInfo"
        type="button"
        class="mp-taskrow__info"
        :aria-label="t('taskInfo.aria')"
        @click="onInfo"
      >
        <AppIcon name="information-circle" :size="16" />
      </button>
    </div>
    <div class="mp-taskrow__actions">
      <template v-if="task === 'PROGRESS'">
        <Button size="xs" color="primary" icon="camera" @click="onLogProgress">{{ taskLabel(task) }}</Button>
      </template>
      <template v-else>
        <input
          v-if="withDoneDate"
          v-model="doneDate"
          type="date"
          class="mp-taskrow__date"
          :aria-label="t('progress.doneDateAria')"
        />
        <Button size="xs" color="primary" icon="check" @click="onDone">{{ t('common.done') }}</Button>
        <Button
          v-if="status !== 'upcoming'"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="clock"
          @click="onPostpone"
        >
          {{ t('common.postpone') }}
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

.mp-taskrow__info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.mp-taskrow__info:hover {
  color: var(--text-muted);
  background: var(--surface-sunken);
}

.mp-taskrow__info:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
</style>
