<script setup lang="ts">
import { type TaskCode } from '../../utils/tasks.js';
import { todayYmd, addDaysYmd } from '../../utils/localDate.js';
import { plantTitle } from '../../utils/displayName.js';

const route = useRoute();
const api = useApi();
const isDesktop = useIsDesktop();
const id = route.params.id as string;

const { data: plant, refresh: refreshPlant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
const { data: care, refresh } = await useAsyncData(`care-${id}`, () => api.getPlantCare(id));

const { data: places } = await useAsyncData('places-for-edit', () => api.listPlaces());

const { data: history, refresh: refreshHistory } = await useAsyncData(`history-${id}`, () => api.getPlantHistory(id));

const editing = ref(false);

const progressOpen = ref(false);
const entryOpen = ref(false);
const activeEntryId = ref<string | null>(null);

function openProgress() { progressOpen.value = true; }

async function onProgressSaved() {
  // Progress re-anchors (drops off the care rows) and a new entry appears in the timeline.
  await Promise.all([refresh(), refreshHistory()]);
}

function openEntry(entryId: string) {
  activeEntryId.value = entryId;
  entryOpen.value = true;
}

function openEdit() {
  if (!plant.value) return;
  editing.value = true;
}

async function onEdited() {
  await Promise.all([refreshPlant(), refresh()]); // title/place AND care
}

const placeName = computed(() => {
  if (!plant.value) return '';
  return (places.value ?? []).find((pl) => pl.id === plant.value!.placeId)?.name ?? '';
});

const today = () => todayYmd();

function dueLabel(t: { daysUntilDue: number; status: string }): string {
  if (t.status === 'overdue') return `Overdue by ${Math.abs(t.daysUntilDue)} day(s)`;
  if (t.status === 'today') return 'Due today';
  return t.daysUntilDue === 1 ? 'Due tomorrow' : `Due in ${t.daysUntilDue} days`;
}

async function markDone(task: TaskCode, occurredOn?: string) {
  await api.sendFeedback(id, { task, type: 'DONE', occurredOn: occurredOn || today() });
  await refresh();
}

async function postpone(task: TaskCode) {
  await api.sendFeedback(id, { task, type: 'POSTPONED', occurredOn: today(), postponeToOn: addDaysYmd(1) });
  await refresh();
}
</script>

<template>
  <div v-if="plant">
    <UiScreenHeader
      back="All plants"
      :title="plantTitle(plant)"
      :subtitle="plant.speciesScientificName && plant.speciesScientificName !== plantTitle(plant) ? plant.speciesScientificName : undefined"
      @back="navigateTo('/plants')"
    >
      <template #action>
        <UiButton color="neutral" variant="soft" icon="pencil-square" @click="openEdit">Edit</UiButton>
      </template>
    </UiScreenHeader>

    <div :class="isDesktop ? 'mp-detail mp-detail--desktop' : 'mp-detail'">
      <!-- Identity -->
      <UiCard padded>
        <div class="mp-detail__identity">
          <UiPlantAvatar :size="64" />
          <div class="mp-detail__identity-info">
            <UiPlantName :title="plantTitle(plant)" :scientific="plant.speciesScientificName" :size="18" />
            <div class="mp-detail__meta">
              Acquired {{ plant.acquiredOn.slice(0, 10) }}<template v-if="placeName"> · {{ placeName }}</template>
            </div>
          </div>
        </div>
        <UiViabilityBadge
          v-if="care"
          :level="care.viability.level"
          :reasons="care.viability.reasons"
        />
        <div class="mp-detail__guide">
          <UiButton
            block
            variant="soft"
            color="cafe"
            icon="book-open"
            @click="navigateTo(`/blog/${plant.speciesSlug}`)"
          >
            Read the care guide
          </UiButton>
        </div>
      </UiCard>

      <!-- Care -->
      <div>
        <UiAlert
          v-if="care && care.viability.level === 'caution'"
          color="amber"
          class="mp-detail__alert"
          title="Could be a better spot"
          description="Light and humidity here are a little low for this plant. Try a brighter window, or mist more often."
        />
        <UiAlert
          v-if="care && care.viability.level === 'poor'"
          color="red"
          class="mp-detail__alert"
          title="This spot isn't a good fit"
          description="Consider moving this plant somewhere with gentler light and more humidity."
        />

        <UiSectionTitle>Care</UiSectionTitle>

        <UiCard v-if="!care || !care.tasks.length" padded>
          <UiEmptyState>Nothing to do right now. 🌿</UiEmptyState>
        </UiCard>
        <UiCard v-else :padded="false">
          <div class="mp-detail__rows">
            <UiTaskRow
              v-for="t in care.tasks"
              :key="t.task"
              :task="t.task"
              :status="t.status"
              :due-label="dueLabel(t)"
              with-done-date
              @done="e => markDone(e.task, e.occurredOn)"
              @postpone="e => postpone(e.task)"
              @log-progress="openProgress"
            />
          </div>
        </UiCard>
      </div>

      <!-- History -->
      <div>
        <UiSectionTitle>History</UiSectionTitle>
        <UiCard v-if="!history || !history.length" padded>
          <UiEmptyState>No history yet. Log progress to start the journal. 🌱</UiEmptyState>
        </UiCard>
        <UiCard v-else :padded="false">
          <div class="mp-detail__history">
            <HistoryTimeline :items="history" @open-entry="openEntry" />
          </div>
        </UiCard>
      </div>
    </div>

    <PlantEditModal
      v-model="editing"
      :plant="plant"
      :places="places ?? []"
      @saved="onEdited"
    />
    <ProgressLogModal v-model="progressOpen" :plant-id="id" @saved="onProgressSaved" />
    <ProgressEntryModal v-model="entryOpen" :plant-id="id" :entry-id="activeEntryId" />
  </div>
  <UiEmptyState v-else>Loading…</UiEmptyState>
</template>

<style scoped>
.mp-detail {
  display: grid;
  gap: 18px;
}

.mp-detail--desktop {
  grid-template-columns: 340px 1fr;
  gap: 20px;
  align-items: start;
}

.mp-detail__identity {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.mp-detail__identity-info {
  min-width: 0;
}

.mp-detail__meta {
  font: 12px var(--font-sans);
  color: var(--text-faint);
  margin-top: 4px;
}

.mp-detail__guide {
  margin-top: 16px;
}

.mp-detail__alert {
  margin-bottom: 14px;
}

.mp-detail__rows {
  display: grid;
  padding: 0 var(--space-4);
}

.mp-detail__history {
  display: grid;
  padding: 0 var(--space-4);
}

.mp-detail__rows > :deep(.mp-taskrow:not(:last-child)) {
  border-bottom: 1px solid var(--border-subtle);
}
</style>
