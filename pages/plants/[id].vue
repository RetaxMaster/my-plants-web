<script setup lang="ts">
import { TASK_LABELS, type TaskCode } from '../../utils/tasks.js';
import { todayYmd, addDaysYmd } from '../../utils/localDate.js';
import { plantTitle } from '../../utils/displayName.js';
import type { Viability } from '../../types/api.js';

const route = useRoute();
const api = useApi();
const id = route.params.id as string;

const { data: plant, refresh: refreshPlant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
const { data: care, refresh } = await useAsyncData(`care-${id}`, () => api.getPlantCare(id));

const { data: places } = await useAsyncData('places-for-edit', () => api.listPlaces());

const editing = ref(false);
const editNickname = ref('');
const editPlaceId = ref('');
const preview = ref<Viability | null>(null);
const savingEdit = ref(false);

const placeOptions = computed(() =>
  (places.value ?? [])
    .filter((p) => plant.value && p.ownerId === plant.value.ownerId)
    .map((p) => ({ label: `${p.name} (${p.indoor ? 'Indoor' : 'Outdoor'})`, value: p.id })),
);

function openEdit() {
  if (!plant.value) return;
  editNickname.value = plant.value.nickname ?? '';
  editPlaceId.value = plant.value.placeId;
  preview.value = null;
  editing.value = true;
}

watch(editPlaceId, async (pid) => {
  if (!plant.value || !pid || pid === plant.value.placeId) { preview.value = null; return; }
  const result = await api.previewPlantViability(plant.value.id, pid);
  // Ignore an out-of-order response: only apply it if this is still the selected place.
  if (editPlaceId.value === pid) preview.value = result;
});

async function saveEdit() {
  if (!plant.value) return;
  savingEdit.value = true;
  try {
    await api.updatePlant(plant.value.id, { nickname: editNickname.value, placeId: editPlaceId.value });
    await Promise.all([refreshPlant(), refresh()]); // title/place AND care
    editing.value = false;
  } finally { savingEdit.value = false; }
}

const today = () => todayYmd();

// Per-task optional back-date for Done. Empty string = use today.
const doneDate = reactive<Record<string, string>>({});

function dueLabel(t: { daysUntilDue: number; status: string }): string {
  if (t.status === 'overdue') return `Overdue by ${Math.abs(t.daysUntilDue)} day(s)`;
  if (t.status === 'today') return 'Due today';
  return t.daysUntilDue === 1 ? 'Due tomorrow' : `Due in ${t.daysUntilDue} days`;
}

function dueColor(status: string) {
  return status === 'overdue' ? 'red' : status === 'today' ? 'amber' : 'gray';
}

async function markDone(task: TaskCode) {
  const occurredOn = doneDate[task] || today();
  await api.sendFeedback(id, { task, type: 'DONE', occurredOn });
  doneDate[task] = '';
  await refresh();
}

async function postpone(task: TaskCode) {
  await api.sendFeedback(id, { task, type: 'POSTPONED', occurredOn: today(), postponeToOn: addDaysYmd(1) });
  await refresh();
}
</script>

<template>
  <div v-if="plant">
    <NuxtLink to="/plants" class="text-sm text-gray-500 hover:underline">← All plants</NuxtLink>
    <h2 class="text-xl font-bold mt-2">
      {{ plantTitle(plant) }}
      <span v-if="plant.speciesScientificName && plant.speciesScientificName !== plantTitle(plant)" class="text-base font-normal text-gray-500 italic">({{ plant.speciesScientificName }})</span>
    </h2>
    <UButton class="mt-2" size="xs" color="gray" variant="soft" icon="i-heroicons-pencil-square" @click="openEdit">Edit</UButton>
    <p class="text-sm text-gray-500 mt-1">Acquired {{ plant.acquiredOn.slice(0, 10) }}</p>

    <ViabilityBadge
      v-if="care"
      class="mt-3"
      :level="care.viability.level"
      :reasons="care.viability.reasons"
    />

    <h3 class="text-lg font-semibold mt-6 mb-2">Care</h3>
    <p v-if="!care || !care.tasks.length" class="text-gray-500">Nothing to do right now. 🌿</p>
    <UCard v-else>
      <div
        v-for="t in care.tasks"
        :key="t.task"
        class="flex flex-wrap items-center justify-between gap-2 py-2 border-b last:border-b-0 border-gray-100"
      >
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ TASK_LABELS[t.task] }}</span>
          <UBadge :color="dueColor(t.status)" variant="subtle" size="xs">{{ dueLabel(t) }}</UBadge>
        </div>
        <div class="flex items-center gap-2">
          <UInput
            v-model="doneDate[t.task]"
            type="date"
            size="xs"
            :placeholder="today()"
            aria-label="Back-date this done"
          />
          <UButton size="xs" color="green" icon="i-heroicons-check" @click="markDone(t.task)">Done</UButton>
          <UButton size="xs" color="gray" variant="ghost" icon="i-heroicons-clock" @click="postpone(t.task)">
            Postpone
          </UButton>
        </div>
      </div>
    </UCard>

    <UModal v-model="editing">
      <UCard>
        <template #header><h3 class="font-semibold">Edit plant</h3></template>
        <div class="grid gap-3">
          <UFormGroup label="Nickname"><UInput v-model="editNickname" /></UFormGroup>
          <UFormGroup label="Place"><USelect v-model="editPlaceId" :options="placeOptions" /></UFormGroup>
          <div v-if="preview">
            <p class="text-xs text-gray-500 mb-1">Projected viability in the new place:</p>
            <ViabilityBadge :level="preview.level" :reasons="preview.reasons" />
          </div>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="gray" variant="ghost" @click="editing = false">Cancel</UButton>
            <UButton color="green" :loading="savingEdit" @click="saveEdit">Save</UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
  <p v-else class="text-gray-500">Loading…</p>
</template>
