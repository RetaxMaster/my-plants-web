<script setup lang="ts">
import { TASK_LABELS, dueLabel, type TaskCode } from '../utils/tasks.js';

const props = defineProps<{ plantId: string; task: TaskCode; nextDueOn: string }>();
const emit = defineEmits<{ done: [TaskCode]; postpone: [TaskCode] }>();

const due = computed(() => dueLabel(new Date(props.nextDueOn)));
const dueColor = computed(() => (due.value === 'Overdue' ? 'red' : due.value === 'Today' ? 'amber' : 'gray'));
</script>

<template>
  <div class="flex items-center justify-between gap-2 py-2">
    <div class="flex items-center gap-2">
      <span class="font-medium">{{ TASK_LABELS[task] }}</span>
      <UBadge :color="dueColor" variant="subtle" size="xs">{{ due }}</UBadge>
    </div>
    <div class="flex gap-2">
      <UButton size="xs" color="green" icon="i-heroicons-check" @click="emit('done', task)">Done</UButton>
      <UButton size="xs" color="gray" variant="ghost" icon="i-heroicons-clock" @click="emit('postpone', task)">Postpone</UButton>
    </div>
  </div>
</template>
