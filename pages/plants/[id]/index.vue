<script setup lang="ts">
import { type TaskCode, type DueState } from '../../../utils/tasks.js';
import { todayYmd, addDaysYmd } from '../../../utils/localDate.js';
import { plantTitle } from '../../../utils/displayName.js';

const { t } = useI18n();
// Detail page uses ONLY the long phrasing ("Due in N days" / "Overdue by N days"),
// so destructure dueLabelLong (NOT dueLabel — that is the short Today-page form).
const { dueLabelLong } = useTaskMeta();

const route = useRoute();
const api = useApi();
const isDesktop = useIsDesktop();
const id = route.params.id as string;

const { data: plant, refresh: refreshPlant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
const { data: care, refresh } = await useAsyncData(`care-${id}`, () => api.getPlantCare(id));

const { data: places } = await useAsyncData('places-for-edit', () => api.listPlaces());

const { data: history, refresh: refreshHistory } = await useAsyncData(`history-${id}`, () => api.getPlantHistory(id));

const editing = ref(false);

const entryOpen = ref(false);
const activeEntryId = ref<string | null>(null);

// "Log progress" is now a full-screen route (/plants/:id/progress), not a modal — the care rows +
// history timeline are refreshed by key when it navigates back after a successful save.
function openProgress() {
  return navigateTo(`/plants/${id}/progress`);
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

// The care endpoint returns { daysUntilDue, status }; map it to the shared DueState
// shape so the i18n dueLabelLong() renders it (no English wording lives here).
function careDueState(row: { daysUntilDue: number; status: string }): DueState {
  if (row.status === 'overdue') return { kind: 'overdue', days: Math.abs(row.daysUntilDue) };
  if (row.status === 'today') return { kind: 'today', days: 0 };
  if (row.daysUntilDue === 1) return { kind: 'tomorrow', days: 1 };
  return { kind: 'inDays', days: row.daysUntilDue };
}

async function markDone(task: TaskCode, occurredOn?: string) {
  await api.sendFeedback(id, { task, type: 'DONE', occurredOn: occurredOn || today() });
  // A completed action becomes a history item (kind:'action', e.g. "Watered today"), so refresh the
  // timeline in place too — not just the care rows — consistent with the progress-log path.
  await Promise.all([refresh(), refreshHistory()]);
}

async function postpone(task: TaskCode) {
  await api.sendFeedback(id, { task, type: 'POSTPONED', occurredOn: today(), postponeToOn: addDaysYmd(1) });
  await refresh();
}
</script>

<template>
  <div v-if="plant">
    <UiScreenHeader
      :back="$t('plantDetail.backAll')"
      :title="plantTitle(plant)"
      :subtitle="plant.speciesScientificName && plant.speciesScientificName !== plantTitle(plant) ? plant.speciesScientificName : undefined"
      @back="navigateTo('/plants')"
    >
      <template #action>
        <UiButton color="neutral" variant="soft" icon="pencil-square" @click="openEdit">{{ $t('common.edit') }}</UiButton>
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
              {{ $t('plantDetail.acquired', { date: plant.acquiredOn.slice(0, 10) }) }}<template v-if="placeName"> · {{ placeName }}</template>
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
            {{ $t('plantDetail.readGuide') }}
          </UiButton>
        </div>
      </UiCard>

      <!-- Care -->
      <div>
        <UiAlert
          v-if="care && care.viability.level === 'caution'"
          color="amber"
          class="mp-detail__alert"
          :title="$t('plantDetail.cautionTitle')"
          :description="$t('plantDetail.cautionDesc')"
        />
        <UiAlert
          v-if="care && care.viability.level === 'poor'"
          color="red"
          class="mp-detail__alert"
          :title="$t('plantDetail.poorTitle')"
          :description="$t('plantDetail.poorDesc')"
        />

        <UiSectionTitle>{{ $t('plantDetail.care') }}</UiSectionTitle>

        <UiCard v-if="!care || !care.tasks.length" padded>
          <UiEmptyState>{{ $t('plantDetail.careEmpty') }}</UiEmptyState>
        </UiCard>
        <UiCard v-else :padded="false">
          <div class="mp-detail__rows">
            <UiTaskRow
              v-for="t3 in care.tasks"
              :key="t3.task"
              :task="t3.task"
              :status="t3.status"
              :due-label="dueLabelLong(careDueState(t3))"
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
        <UiSectionTitle>{{ $t('plantDetail.history') }}</UiSectionTitle>
        <UiCard v-if="!history || !history.length" padded>
          <UiEmptyState>{{ $t('plantDetail.historyEmpty') }}</UiEmptyState>
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
    <ProgressEntryModal v-model="entryOpen" :plant-id="id" :entry-id="activeEntryId" />
  </div>
  <UiEmptyState v-else>{{ $t('common.loading') }}</UiEmptyState>
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
