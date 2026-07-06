<script setup lang="ts">
import { type TaskCode, type DueState } from '../../../utils/tasks.js';
import { todayYmd, addDaysYmd } from '../../../utils/localDate.js';
import { plantTitle } from '../../../utils/displayName.js';

const { t } = useI18n();
// Detail page uses ONLY the long phrasing ("Due in N days" / "Overdue by N days"),
// so destructure dueLabelLong (NOT dueLabel — that is the short Today-page form).
const { dueLabelLong, healthLabel } = useTaskMeta();

const route = useRoute();
const api = useApi();
const isDesktop = useIsDesktop();
const id = route.params.id as string;

const { data: plant, refresh: refreshPlant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
const { data: care, refresh } = await useAsyncData(`care-${id}`, () => api.getPlantCare(id));

const { data: places } = await useAsyncData('places-for-edit', () => api.listPlaces());

const { data: history, refresh: refreshHistory } = await useAsyncData(`history-${id}`, () => api.getPlantHistory(id));

// The photos gallery = every progress photo, flattened newest-first, each carrying its owning entryId.
const { data: photos, refresh: refreshPhotos } = await useAsyncData(`photos-${id}`, () => api.getPlantPhotos(id));

const editing = ref(false);

const entryOpen = ref(false);
const activeEntryId = ref<string | null>(null);

// Cover-photo editing (hero affordance). We hold the picked File in local state and upload immediately
// (we DO have a plantId here) via setCoverPhoto; deleteCoverPhoto clears it. Errors surface non-blockingly.
const coverOpen = ref(false);
const coverFiles = ref<File[]>([]);
const coverBusy = ref(false);
const coverError = ref('');

const heroHeight = computed(() => (isDesktop.value ? 280 : 190));

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

function openCover() {
  coverError.value = '';
  coverFiles.value = [];
  coverOpen.value = true;
}

// Uploading the moment a file is picked (deferred selection would be pointless with a plantId in hand).
watch(coverFiles, async (list) => {
  const file = list[0];
  if (!file || coverBusy.value) return;
  coverBusy.value = true;
  coverError.value = '';
  try {
    await api.setCoverPhoto(id, file);
    await refreshPlant();
    coverOpen.value = false;
  } catch {
    coverError.value = t('plantPhoto.uploadError');
  } finally {
    coverFiles.value = [];
    coverBusy.value = false;
  }
});

async function removeCover() {
  if (coverBusy.value) return;
  coverBusy.value = true;
  coverError.value = '';
  try {
    await api.deleteCoverPhoto(id);
    await refreshPlant();
    coverOpen.value = false;
  } catch {
    coverError.value = t('plantPhoto.uploadError');
  } finally {
    coverBusy.value = false;
  }
}

const placeName = computed(() => {
  if (!plant.value) return '';
  return (places.value ?? []).find((pl) => pl.id === plant.value!.placeId)?.name ?? '';
});

// Over-photo viability chip: dot color + short label from the shared viability i18n keys.
const viabilityDot = computed(() => {
  const level = care.value?.viability.level;
  if (level === 'poor') return 'var(--photo-dot-poor)';
  if (level === 'caution') return 'var(--photo-dot-caution)';
  return 'var(--photo-dot-good)';
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

    <!-- Hero photo -->
    <UiPlantPhoto
      :src="plant.coverImageUrl"
      :alt="$t('plantPhoto.alt', { name: plantTitle(plant) })"
      :height="heroHeight"
      class="mp-detail__hero"
    >
      <template #chips>
        <UiPhotoChip v-if="placeName" icon="map-pin" :label="placeName" />
        <UiPhotoChip v-if="care" :dot="viabilityDot" :label="$t('viability.' + care.viability.level)" />
      </template>
      <template #overlay>
        <UiButton size="xs" variant="soft" color="neutral" icon="camera" @click="openCover">
          {{ $t('plantPhoto.edit') }}
        </UiButton>
      </template>
    </UiPlantPhoto>

    <div :class="isDesktop ? 'mp-detail mp-detail--desktop' : 'mp-detail'">
      <!-- Left column -->
      <div class="mp-detail__col">
        <!-- Identity -->
        <UiCard padded>
          <div class="mp-detail__identity-info">
            <UiPlantName :title="plantTitle(plant)" :scientific="plant.speciesScientificName" :size="18" />
            <div class="mp-detail__meta">
              {{ $t('plantDetail.acquired', { date: $d(new Date(plant.acquiredOn), 'short') }) }}<template v-if="placeName"> · {{ placeName }}</template>
            </div>
          </div>
          <UiViabilityBadge
            v-if="care"
            :level="care.viability.level"
            :reasons="care.viability.reasons"
            class="mp-detail__viability"
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

        <!-- Notes & health (from the latest progress entry) -->
        <UiCard v-if="plant.latestProgress" padded clickable class="mp-detail__notes" @click="openEntry(plant.latestProgress!.entryId)">
          <div class="mp-detail__notes-head">
            <strong>{{ healthLabel(plant.latestProgress.health) }}</strong>
            <span class="mp-detail__notes-date">{{ $d(new Date(plant.latestProgress.occurredOn), 'short') }}</span>
          </div>
          <p v-if="plant.latestProgress.observations" class="mp-detail__notes-obs">{{ plant.latestProgress.observations }}</p>
        </UiCard>
      </div>

      <!-- Right column -->
      <div class="mp-detail__col">
        <!-- Photos gallery -->
        <div>
          <UiSectionTitle>{{ $t('photos.title') }}</UiSectionTitle>
          <UiCard v-if="!photos || !photos.length" padded>
            <UiEmptyState>{{ $t('photos.empty') }}</UiEmptyState>
          </UiCard>
          <UiCard v-else padded>
            <ul class="mp-detail__gallery">
              <li v-for="ph in photos" :key="ph.id">
                <button type="button" class="mp-detail__thumb" @click="openEntry(ph.entryId)">
                  <img :src="ph.imageUrl" :alt="$t('photos.alt', { date: $d(new Date(ph.occurredOn), 'short') })" loading="lazy" />
                </button>
              </li>
            </ul>
          </UiCard>
        </div>

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
    </div>

    <PlantEditModal
      v-model="editing"
      :plant="plant"
      :places="places ?? []"
      @saved="onEdited"
    />
    <ProgressEntryModal v-model="entryOpen" :plant-id="id" :entry-id="activeEntryId" />

    <!-- Cover-photo editor -->
    <UiModal v-model="coverOpen" :title="$t('plantPhoto.editTitle')">
      <div class="mp-detail__cover">
        <UiImageDropzone v-model="coverFiles" :max="1" :disabled="coverBusy" />
        <p v-if="coverError" class="mp-detail__cover-error">{{ coverError }}</p>
      </div>
      <template #footer>
        <UiButton
          v-if="plant.coverImageUrl"
          color="neutral"
          variant="ghost"
          class="mp-btn-danger"
          icon="trash"
          :loading="coverBusy"
          @click="removeCover"
        >
          {{ $t('plantPhoto.remove') }}
        </UiButton>
        <UiButton color="neutral" variant="ghost" @click="coverOpen = false">{{ $t('common.close') }}</UiButton>
      </template>
    </UiModal>
  </div>
  <UiEmptyState v-else>{{ $t('common.loading') }}</UiEmptyState>
</template>

<style scoped>
.mp-detail__hero {
  margin-bottom: 18px;
}

.mp-detail {
  display: grid;
  gap: 18px;
}

.mp-detail--desktop {
  grid-template-columns: 340px 1fr;
  gap: 20px;
  align-items: start;
}

.mp-detail__col {
  display: grid;
  gap: 18px;
  min-width: 0;
}

.mp-detail__identity-info {
  min-width: 0;
}

.mp-detail__meta {
  font: 12px var(--font-sans);
  color: var(--text-faint);
  margin-top: 4px;
}

.mp-detail__viability {
  margin-top: 16px;
}

.mp-detail__guide {
  margin-top: 16px;
}

.mp-detail__notes-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-family: var(--font-sans);
  color: var(--text-strong);
}

.mp-detail__notes-date {
  font-size: var(--text-xs);
  color: var(--text-faint);
}

.mp-detail__notes-obs {
  margin: var(--space-2) 0 0;
  font: var(--text-sm) / 1.4 var(--font-sans);
  color: var(--text-body);
}

.mp-detail__gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mp-detail__thumb {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  background: var(--surface-sunken);
}

.mp-detail__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mp-detail__thumb:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-detail__alert {
  margin-bottom: 14px;
}

.mp-detail__rows,
.mp-detail__history {
  display: grid;
  padding: 0 var(--space-4);
}

.mp-detail__rows > :deep(.mp-taskrow:not(:last-child)) {
  border-bottom: 1px solid var(--border-subtle);
}

.mp-detail__cover {
  display: grid;
  gap: var(--space-3);
}

.mp-detail__cover-error {
  margin: 0;
  font: var(--text-xs) var(--font-sans);
  color: var(--care-poor);
}
</style>
