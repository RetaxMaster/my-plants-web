<script setup lang="ts">
import { groupByPlant, type DueTask } from '../utils/tasks.js';
import { todayYmd, addDaysYmd } from '../utils/localDate.js';
import { plantTitle } from '../utils/displayName.js';
import type { Plant } from '../types/api.js';

const api = useApi();
const { data: tasks, refresh } = await useAsyncData('today', () => api.todaysTasks());
const { data: plants } = await useAsyncData('plants', () => api.listPlants());

const plantById = (id: string): Plant | undefined => (plants.value ?? []).find((x) => x.id === id);
const plantName = (id: string): string => {
  const p = plantById(id);
  return p ? plantTitle(p) : id;
};

const grouped = computed(() => groupByPlant((tasks.value ?? []) as DueTask[]));

const today = todayYmd();

async function markDone(plantId: string, task: DueTask['task']) {
  await api.sendFeedback(plantId, { task, type: 'DONE', occurredOn: today });
  await refresh();
}

async function postpone(plantId: string, task: DueTask['task']) {
  await api.sendFeedback(plantId, { task, type: 'POSTPONED', occurredOn: today, postponeToOn: addDaysYmd(1) });
  await refresh();
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-3">Today's care</h2>
    <p v-if="!grouped.size" class="text-gray-500">Nothing due today. 🌿</p>
    <div v-for="[plantId, plantTasks] in grouped" :key="plantId" class="mb-4">
      <UCard>
        <template #header>
          <NuxtLink :to="`/plants/${plantId}`" class="font-medium hover:underline">{{ plantName(plantId) }}</NuxtLink>
          <span
            v-if="plantById(plantId)?.speciesScientificName && plantById(plantId)?.speciesScientificName !== plantName(plantId)"
            class="text-xs text-gray-500 italic"
          > ({{ plantById(plantId)?.speciesScientificName }})</span>
        </template>
        <TaskCard
          v-for="t in plantTasks"
          :key="t.task"
          :plant-id="plantId"
          :task="t.task"
          :next-due-on="t.nextDueOn"
          @done="markDone(plantId, $event)"
          @postpone="postpone(plantId, $event)"
        />
      </UCard>
    </div>
  </div>
</template>
