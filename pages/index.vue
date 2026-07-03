<script setup lang="ts">
import { groupByPlant, type DueTask } from '../utils/tasks.js';
import { todayYmd, addDaysYmd } from '../utils/localDate.js';
import { plantTitle } from '../utils/displayName.js';
import { dueLabel as fmtDueLabel } from '../utils/tasks.js';
import type { Plant } from '../types/api.js';

const api = useApi();
const isDesktop = useIsDesktop();
const { data: tasks, refresh } = await useAsyncData('today', () => api.todaysTasks());
const { data: plants } = await useAsyncData('plants', () => api.listPlants());
const { data: places } = await useAsyncData('places-for-today', () => api.listPlaces());

const plantById = (id: string): Plant | undefined => (plants.value ?? []).find((x) => x.id === id);
const plantName = (id: string): string => {
  const p = plantById(id);
  return p ? plantTitle(p) : id;
};
const placeName = (id: string): string => {
  const p = plantById(id);
  if (!p) return '';
  return (places.value ?? []).find((pl) => pl.id === p.placeId)?.name ?? '';
};

const grouped = computed(() => groupByPlant((tasks.value ?? []) as DueTask[]));
const dueCount = computed(() => (tasks.value ?? []).length);

const today = todayYmd();
const dateLabel = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});
const subtitle = computed(() =>
  dueCount.value
    ? `${dateLabel} · ${dueCount.value} ${dueCount.value === 1 ? 'task' : 'tasks'} due`
    : dateLabel,
);

function rowStatus(due: string): 'overdue' | 'today' | 'upcoming' {
  const label = fmtDueLabel(new Date(due), new Date());
  if (label === 'Overdue') return 'overdue';
  if (label === 'Today') return 'today';
  return 'upcoming';
}

async function markDone(plantId: string, task: DueTask['task'], occurredOn?: string) {
  await api.sendFeedback(plantId, { task, type: 'DONE', occurredOn: occurredOn || today });
  await refresh();
}

async function postpone(plantId: string, task: DueTask['task']) {
  await api.sendFeedback(plantId, { task, type: 'POSTPONED', occurredOn: today, postponeToOn: addDaysYmd(1) });
  await refresh();
}

const progressPlantId = ref<string | null>(null);
const progressOpen = ref(false);

function openProgress(plantId: string) {
  progressPlantId.value = plantId;
  progressOpen.value = true;
}

async function onProgressSaved() {
  await refresh(); // Progress re-anchors to next Monday and drops off Today
}
</script>

<template>
  <div>
    <UiScreenHeader eyebrow="Today" title="Today's care" :subtitle="subtitle" />

    <UiCard v-if="!grouped.size" padded>
      <UiEmptyState>Nothing due today. 🌿</UiEmptyState>
    </UiCard>

    <UiCardGrid v-else :desktop="isDesktop" :min="340" :gap="14">
      <UiCard v-for="[plantId, plantTasks] in grouped" :key="plantId">
        <template #header>
          <NuxtLink :to="`/plants/${plantId}`" class="mp-today__plant">
            <UiPlantAvatar :size="40" />
            <div class="mp-today__plant-info">
              <UiPlantName
                :title="plantName(plantId)"
                :scientific="plantById(plantId)?.speciesScientificName"
              />
              <div v-if="placeName(plantId)" class="mp-today__place">{{ placeName(plantId) }}</div>
            </div>
            <UiAppIcon name="chevron-right" :size="18" color="var(--text-faint)" />
          </NuxtLink>
        </template>
        <div class="mp-today__rows">
          <UiTaskRow
            v-for="t in plantTasks"
            :key="t.task"
            :task="t.task"
            :status="rowStatus(t.nextDueOn)"
            :due-label="fmtDueLabel(new Date(t.nextDueOn), new Date())"
            @done="e => markDone(plantId, e.task, e.occurredOn)"
            @postpone="e => postpone(plantId, e.task)"
            @log-progress="() => openProgress(plantId)"
          />
        </div>
      </UiCard>
    </UiCardGrid>

    <ProgressLogModal
      v-if="progressPlantId"
      v-model="progressOpen"
      :plant-id="progressPlantId"
      @saved="onProgressSaved"
    />
  </div>
</template>

<style scoped>
.mp-today__plant {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
}

.mp-today__plant-info {
  flex: 1;
  min-width: 0;
}

.mp-today__place {
  font: 12px var(--font-sans);
  color: var(--text-muted);
  margin-top: 2px;
}

.mp-today__rows {
  display: grid;
}

.mp-today__rows > :deep(.mp-taskrow:not(:last-child)) {
  border-bottom: 1px solid var(--border-subtle);
}
</style>
