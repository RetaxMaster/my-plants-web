<script setup lang="ts">
import { type TaskCode, type DueState } from '../../../utils/tasks.js';
import { todayYmd, addDaysYmd, ymdToLocalDate } from '../../../utils/localDate.js';
import { plantTitle, speciesPrimaryName } from '../../../utils/displayName.js';

const { t, d, locale } = useI18n();
// Detail page uses ONLY the long phrasing ("Due in N days" / "Overdue by N days"),
// so destructure dueLabelLong (NOT dueLabel — that is the short Today-page form).
const { dueLabelLong, healthLabel } = useTaskMeta();

const route = useRoute();
const api = useApi();

const { earlyWaterOptions, postponeOptions, repotPostponeOptions } = useFeedbackReasons();

const pending = ref<{ task: TaskCode; type: 'DONE' | 'POSTPONED'; occurredOn?: string } | null>(null);
const earlyPickerOpen = ref(false);
const postponePickerOpen = ref(false);
// REPOT is an INSPECTION (spec F.7). NOTE: a queued UX change removes Postpone from this screen; when it
// lands, this picker moves with the button. The Today list is the canonical entry point.
const repotPickerOpen = ref(false);
const isDesktop = useIsDesktop();
const id = route.params.id as string;

const { data: plant, refresh: refreshPlant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
const { data: care, refresh } = await useAsyncData(`care-${id}`, () => api.getPlantCare(id));

// The browser tab shows the plant's own name (nickname, else localized species name); a plant that
// failed to load falls back to the generic "Plant" title rather than an empty tab.
useHead(() => ({ title: plant.value ? plantTitle(plant.value, locale.value) : t('meta.plantDetail.title') }));
useSeoMeta({ description: () => t('meta.plantDetail.description') });

const { data: places } = await useAsyncData('places-for-edit', () => api.listPlaces());

const { data: history, refresh: refreshHistory } = await useAsyncData(`history-${id}`, () => api.getPlantHistory(id));

// The photos gallery = every progress photo, flattened newest-first, each carrying its owning entryId.
const { data: photos, refresh: refreshPhotos } = await useAsyncData(`photos-${id}`, () => api.getPlantPhotos(id));

// Collapsed by default: show the first 6 (2 rows of 3). The expand/collapse button only appears when
// there are MORE than 6 photos (guard on the TOTAL count, not the sliced list).
const PHOTOS_COLLAPSED = 6;
const photosExpanded = ref(false);
const visiblePhotos = computed(() => {
  const all = photos.value ?? [];
  return photosExpanded.value ? all : all.slice(0, PHOTOS_COLLAPSED);
});

const editing = ref(false);

const entryOpen = ref(false);
const activeEntryId = ref<string | null>(null);

// Photo lightbox (spec §4): the gallery photo click opens a full-screen viewer, NOT the entry modal. The
// viewer pages across the WHOLE gallery (photos.value), so the alt/date list is built from all photos; the
// v-for index over the collapsed slice equals the absolute index because the slice is a prefix (slice(0,N)).
const lightboxOpen = ref(false);
const lightboxIndex = ref(0);
const lightboxImages = computed(() =>
  (photos.value ?? []).map((ph) => ({
    src: ph.imageUrl,
    alt: t('photos.alt', { date: d(ymdToLocalDate(ph.occurredOn), 'short') }),
  })),
);
function openLightbox(index: number) {
  lightboxIndex.value = index;
  lightboxOpen.value = true;
}

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

// Notes & health badge color: green when the plant is thriving (GOOD/EXCELLENT), amber otherwise.
const notesBadgeColor = computed<'green' | 'amber'>(() => {
  const h = plant.value?.latestProgress?.health;
  return h === 'GOOD' || h === 'EXCELLENT' ? 'green' : 'amber';
});

const { windowDistanceLabel, potTypeLabel, soilMixLabel, growthHabitLabel } = useProfileMeta();

// The plant's current Place — the source of the place-sourced care-basis factors (light/humidity/temp/
// setting/Near AC). Read-only here (no place editing on the detail).
const place = computed(() => (places.value ?? []).find((pl) => pl.id === plant.value?.placeId) ?? null);

const profileOpen = ref(false);
async function onProfileSaved() {
  await refreshPlant(); // profile + derived changed -> the meter and info items move
}

// Per-task info modal (C4): ONE reusable TaskInfoModal fed the clicked task code + (WATER only) the
// species dryness slug from the care payload. The default task is harmless — it is set before opening.
const taskInfoOpen = ref(false);
const taskInfoTask = ref<TaskCode>('WATER');
function openTaskInfo(e: { task: TaskCode }) {
  taskInfoTask.value = e.task;
  taskInfoOpen.value = true;
}
const taskInfoDryness = computed(() =>
  taskInfoTask.value === 'WATER' ? (care.value?.soilDrynessBeforeWatering ?? null) : null,
);
// REPOT-only: the species' repotting signs. The due date is an INSPECTION reminder, so the modal names
// what to look for. Species catalog data — rendered verbatim (the known API-supplied English-leak class).
const taskInfoRepotSigns = computed(() =>
  taskInfoTask.value === 'REPOT' ? (care.value?.crowding?.repotSigns ?? null) : null,
);

// A tri-state boolean -> localized Yes/No, or null (Missing info) when unknown.
function yn(v: boolean | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v ? t('common.yes') : t('common.no');
}

// The four care-basis groups. `counted: true` marks a user-fillable OR derivable factor that the
// completeness meter tracks; place-sourced factors are shown for context but never counted.
const careBasisGroups = computed(() => {
  const pr = plant.value?.profile;
  const dv = plant.value?.derived;
  const pl = place.value;
  if (!pr || !dv) return [];
  return [
    // NOTE: `usedByEngine` is a HARDCODED visual reference dot (green = the deterministic care engine
    // actually consumes this factor today; blue = captured/displayed but NOT yet fed into the engine).
    // It is a temporary dev aid to track what's left to wire into the engine — safe to remove later.
    {
      title: t('careBasis.groupLight'),
      items: [
        { icon: 'sun', label: t('careBasis.fields.level'), value: pl ? t('places.light_' + pl.lightType) : null, counted: false, usedByEngine: true },
        { icon: 'window', label: t('careBasis.fields.windowDistance'), value: windowDistanceLabel(pr.windowDistance), counted: true, usedByEngine: true },
        { icon: 'light-bulb', label: t('careBasis.fields.growLight'), value: yn(pr.growLight), counted: true, usedByEngine: true },
      ],
    },
    {
      title: t('careBasis.groupPotSoil'),
      items: [
        { icon: 'archive-box', label: t('careBasis.fields.potType'), value: potTypeLabel(pr.potType), counted: true, usedByEngine: true },
        { icon: 'arrows-pointing-out', label: t('careBasis.fields.potSize'), value: pr.potSizeCm != null ? t('careBasis.values.potSize', { n: pr.potSizeCm }) : null, counted: true, usedByEngine: true },
        { icon: 'funnel', label: t('careBasis.fields.drainage'), value: yn(pr.hasDrainage), counted: true, usedByEngine: true },
        { icon: 'square-3-stack-3d', label: t('careBasis.fields.soilMix'), value: soilMixLabel(pr.soilMix), counted: true, usedByEngine: true },
        { icon: 'calendar', label: t('careBasis.fields.lastRepotted'), value: dv.lastRepottedOn ? d(ymdToLocalDate(dv.lastRepottedOn), 'short') : null, counted: true, usedByEngine: true },
      ],
    },
    {
      title: t('careBasis.groupPlant'),
      items: [
        // Height is engine-read only through the crowding index (height ÷ pot size, habit-normalized):
        // it needs a pot size, a non-trailing habit, and a measurement fresh enough to still carry
        // authority. The API owns that rule; the dot only reflects it.
        { icon: 'arrow-trending-up', label: t('careBasis.fields.height'), value: dv.heightCm != null ? t('careBasis.values.height', { n: dv.heightCm }) : null, counted: true, usedByEngine: care.value?.crowding?.usedByEngine ?? false },
        // `ageMonths` feeds NO factor in the care engine (docs/care-engine.md §7.11). Its only effect
        // today is an unintended confidence credit, documented there as a deferred bug — advertising that
        // accident with a green dot would be dishonest. `growthHabit` below shares the same confidence
        // weight but DOES feed a factor, so it stays green.
        { icon: 'clock', label: t('careBasis.fields.age'), value: pr.ageMonths != null ? t('careBasis.values.age', { n: pr.ageMonths }) : null, counted: true, usedByEngine: false },
        { icon: 'arrow-up-right', label: t('careBasis.fields.growthHabit'), value: growthHabitLabel(pr.growthHabit), counted: true, usedByEngine: true },
      ],
    },
    {
      title: t('careBasis.groupPlaceClimate'),
      items: [
        { icon: 'cloud', label: t('careBasis.fields.humidity'), value: pl?.humidityCharacter ? t('places.humidity_' + pl.humidityCharacter) : null, counted: false, usedByEngine: true },
        { icon: 'sun', label: t('careBasis.fields.indoorTemp'), value: (pl && pl.indoorTempMinC != null && pl.indoorTempMaxC != null) ? t('careBasis.values.tempRange', { min: pl.indoorTempMinC, max: pl.indoorTempMaxC }) : null, counted: false, usedByEngine: true },
        { icon: 'home', label: t('careBasis.fields.setting'), value: pl ? (pl.indoor ? t('places.indoor') : t('places.outdoor')) : null, counted: false, usedByEngine: true },
        { icon: 'adjustments-horizontal', label: t('careBasis.fields.nearAc'), value: pl ? yn(pl.climateControlled) : null, counted: false, usedByEngine: true },
        { icon: 'fire', label: t('careBasis.fields.nearHeater'), value: yn(pr.nearHeater), counted: true, usedByEngine: true },
        { icon: 'arrows-right-left', label: t('careBasis.fields.airflow'), value: pl?.airflow ? t('places.airflow_' + pl.airflow) : null, counted: false, usedByEngine: true },
      ],
    },
  ];
});

// Completeness = filled/total over the COUNTED (fillable + derivable) factors only.
const meter = computed(() => {
  const counted = careBasisGroups.value.flatMap((g) => g.items).filter((i) => i.counted);
  const total = counted.length;
  const filled = counted.filter((i) => i.value !== null).length;
  const pct = total ? Math.round((filled / total) * 100) : 0;
  return { filled, total, pct };
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

async function sendDone(task: TaskCode, occurredOn?: string, reason?: string) {
  await api.sendFeedback(id, { task, type: 'DONE', occurredOn: occurredOn || today(), reason });
  // A completed action becomes a history item (kind:'action', e.g. "Watered today"), so refresh the
  // timeline in place too — not just the care rows — consistent with the progress-log path.
  await Promise.all([refresh(), refreshHistory()]);
}

async function sendPostpone(task: TaskCode, reason?: string) {
  await api.sendFeedback(id, { task, type: 'POSTPONED', occurredOn: today(), postponeToOn: addDaysYmd(1), reason });
  await refresh();
}

// A REPOT postpone sends NO client date: the API derives a FLOOR from the reason, and a floor can never pin.
async function sendRepotPostpone(reason: string) {
  await api.sendFeedback(id, { task: 'REPOT', type: 'POSTPONED', occurredOn: today(), reason });
  await refresh();
}

// A WATER done on a not-yet-due task (status 'upcoming') is an early watering → ask why; otherwise send.
function onDone(task: TaskCode, status: 'overdue' | 'today' | 'upcoming', occurredOn?: string) {
  if (task === 'WATER' && status === 'upcoming') {
    pending.value = { task, type: 'DONE', occurredOn };
    earlyPickerOpen.value = true;
    return;
  }
  return sendDone(task, occurredOn);
}

function onPostpone(task: TaskCode) {
  if (task === 'WATER') {
    pending.value = { task, type: 'POSTPONED' };
    postponePickerOpen.value = true;
    return;
  }
  if (task === 'REPOT') {
    repotPickerOpen.value = true;
    return;
  }
  return sendPostpone(task);
}

function confirmEarly(reason: string) {
  const p = pending.value;
  pending.value = null;
  if (p) void sendDone(p.task, p.occurredOn, reason);
}

function confirmPostpone(reason: string) {
  const p = pending.value;
  pending.value = null;
  if (p) void sendPostpone(p.task, reason);
}

function confirmRepotPostpone(reason: string) {
  void sendRepotPostpone(reason);
}
</script>

<template>
  <div v-if="plant">
    <UiScreenHeader
      :back="$t('plantDetail.backAll')"
      :title="plantTitle(plant, locale)"
      :subtitle="plant.speciesScientificName && plant.speciesScientificName !== plantTitle(plant, locale) ? plant.speciesScientificName : undefined"
      @back="navigateTo('/plants')"
    >
      <template #action>
        <UiButton color="neutral" variant="soft" icon="pencil-square" @click="openEdit">{{ $t('common.edit') }}</UiButton>
      </template>
    </UiScreenHeader>

    <!-- Hero photo -->
    <UiPlantPhoto
      :src="plant.coverImageUrl"
      :alt="$t('plantPhoto.alt', { name: plantTitle(plant, locale) })"
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
      <!-- Left column: identity, notes & health, photos, history -->
      <div class="mp-detail__col">
        <!-- Identity -->
        <UiCard padded>
          <UiPlantName :title="plantTitle(plant, locale)" :scientific="plant.speciesScientificName" :size="18" />
          <div class="mp-detail__id-rows">
            <div class="mp-detail__id-row">
              <UiAppIcon name="sparkles" :size="15" color="var(--text-faint)" class="mp-detail__id-icon" />
              <span class="mp-detail__id-label">{{ $t('plantDetail.species') }}</span>
              <span class="mp-detail__id-value">{{ speciesPrimaryName(plant, locale) }}</span>
            </div>
            <div v-if="placeName" class="mp-detail__id-row">
              <UiAppIcon name="map-pin" :size="15" color="var(--text-faint)" class="mp-detail__id-icon" />
              <span class="mp-detail__id-label">{{ $t('plantDetail.livesIn') }}</span>
              <span class="mp-detail__id-value">{{ placeName }}</span>
            </div>
            <div class="mp-detail__id-row">
              <UiAppIcon name="calendar" :size="15" color="var(--text-faint)" class="mp-detail__id-icon" />
              <span class="mp-detail__id-label">{{ $t('plantDetail.acquiredLabel') }}</span>
              <span class="mp-detail__id-value">{{ $d(ymdToLocalDate(plant.acquiredOn), 'short') }}</span>
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
              :to="`/blog/${plant.speciesSlug}`"
            >
              {{ $t('plantDetail.readGuide') }}
            </UiButton>
          </div>
        </UiCard>

        <!-- Notes & health (from the latest progress entry) -->
        <div v-if="plant.latestProgress">
          <UiSectionTitle>{{ $t('plantDetail.notes') }}</UiSectionTitle>
          <UiCard padded clickable class="mp-detail__notes" @click="openEntry(plant.latestProgress!.entryId)">
            <div class="mp-detail__notes-head">
              <UiBadge :color="notesBadgeColor" size="xs" dot>{{ healthLabel(plant.latestProgress.health) }}</UiBadge>
              <span class="mp-detail__notes-date">{{ $d(ymdToLocalDate(plant.latestProgress.occurredOn), 'short') }}</span>
            </div>
            <p v-if="plant.latestProgress.observations" class="mp-detail__notes-obs">{{ plant.latestProgress.observations }}</p>
          </UiCard>
        </div>

        <!-- Plant Doctor entry (always available, even before the first progress entry) -->
        <div class="mp-detail__diagnose">
          <UiButton
            block
            variant="soft"
            color="cafe"
            icon="heart"
            :to="`/plants/${id}/diagnose`"
          >
            {{ $t('plantDetail.diagnose') }}
          </UiButton>
        </div>

        <!-- Photos gallery -->
        <div>
          <UiSectionTitle>{{ $t('photos.title') }}</UiSectionTitle>
          <UiCard v-if="!photos || !photos.length" padded>
            <UiEmptyState>{{ $t('photos.empty') }}</UiEmptyState>
          </UiCard>
          <UiCard v-else padded>
            <ul class="mp-detail__gallery">
              <li v-for="(ph, index) in visiblePhotos" :key="ph.id">
                <button type="button" class="mp-detail__thumb" @click="openLightbox(index)">
                  <img :src="ph.imageUrl" :alt="$t('photos.alt', { date: $d(ymdToLocalDate(ph.occurredOn), 'short') })" loading="lazy" />
                </button>
              </li>
            </ul>
            <button
              v-if="photos.length > PHOTOS_COLLAPSED"
              type="button"
              class="mp-detail__gallery-toggle"
              @click="photosExpanded = !photosExpanded"
            >
              <span>{{ photosExpanded ? $t('photos.showLess') : $t('photos.showAll', { n: photos.length }) }}</span>
              <UiAppIcon :name="photosExpanded ? 'chevron-up' : 'chevron-down'" :size="16" color="currentColor" />
            </button>
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

      <!-- Right column: care, the care plan is based on -->
      <div class="mp-detail__col">
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
                show-info
                @done="e => onDone(e.task, t3.status, e.occurredOn)"
                @postpone="e => onPostpone(e.task)"
                @info="openTaskInfo"
                @log-progress="openProgress"
              />
            </div>
          </UiCard>
        </div>

        <!-- The care plan is based on -->
        <div>
          <UiSectionTitle>{{ $t('careBasis.title') }}</UiSectionTitle>
          <UiCard padded class="mp-detail__basis">
            <div class="mp-detail__basis-inner">
              <div class="mp-detail__basis-head">
                <UiMeter
                  :filled="meter.filled"
                  :total="meter.total"
                  :label="$t('careBasis.meterLabel', { filled: meter.filled, total: meter.total, pct: meter.pct })"
                  class="mp-detail__basis-meter"
                />
                <UiButton size="xs" variant="soft" color="neutral" icon="plus" @click="profileOpen = true">
                  {{ $t('careBasis.addMissingInfo') }}
                </UiButton>
              </div>
              <div v-for="group in careBasisGroups" :key="group.title" class="mp-detail__basis-group">
                <div class="mp-detail__basis-group-title">{{ group.title }}</div>
                <div class="mp-detail__basis-items">
                  <UiInfoItem
                    v-for="item in group.items"
                    :key="item.label"
                    :icon="item.icon"
                    :label="item.label"
                    :value="item.value"
                    :missing-label="$t('careBasis.missing')"
                    :used-by-engine="item.usedByEngine"
                  />
                </div>
              </div>
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
    <UiImageLightbox v-model="lightboxOpen" v-model:index="lightboxIndex" :images="lightboxImages" />
    <PlantProfileModal v-model="profileOpen" :plant-id="id" @saved="onProfileSaved" />
    <UiTaskInfoModal v-model:open="taskInfoOpen" :task="taskInfoTask" :soil-dryness="taskInfoDryness" :repot-signs="taskInfoRepotSigns" />

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

    <UiReasonPicker
      v-model:open="earlyPickerOpen"
      :title="$t('feedback.earlyWaterTitle')"
      :options="earlyWaterOptions"
      @confirm="confirmEarly"
    />
    <UiReasonPicker
      v-model:open="postponePickerOpen"
      :title="$t('feedback.postponeTitle')"
      :options="postponeOptions"
      :confirm-label="$t('common.postpone')"
      @confirm="confirmPostpone"
    />
    <UiReasonPicker
      v-model:open="repotPickerOpen"
      :title="$t('feedback.repotInspectTitle')"
      :options="repotPostponeOptions"
      :signs="care?.crowding?.repotSigns ?? []"
      :signs-heading="$t('feedback.repotSignsHeading')"
      :confirm-label="$t('common.postpone')"
      @confirm="confirmRepotPostpone"
    />
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

/* Identity: three labeled rows (icon + muted label + strong value). */
.mp-detail__id-rows {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.mp-detail__id-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.mp-detail__id-icon {
  flex: none;
}

.mp-detail__id-label {
  flex: none;
  width: 68px;
  font: var(--text-xs) / 1.2 var(--font-sans);
  color: var(--text-muted);
}

.mp-detail__id-value {
  min-width: 0;
  font: var(--weight-semibold) var(--text-sm) / 1.3 var(--font-sans);
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-detail__viability {
  margin-top: 16px;
}

.mp-detail__guide {
  margin-top: 16px;
}

.mp-detail__notes-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-sans);
  color: var(--text-strong);
}

.mp-detail__notes-date {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--text-faint);
}

.mp-detail__notes-obs {
  margin: var(--space-2) 0 0;
  font: var(--text-sm) / 1.4 var(--font-sans);
  color: var(--text-body);
}

.mp-detail__gallery {
  /* Compact grid of small square thumbnails, 3 per row. */
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Quiet full-width expand/collapse control below the grid (only when >6 photos). */
.mp-detail__gallery-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  width: 100%;
  margin-top: var(--space-3);
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  font: var(--weight-medium) var(--text-sm) / 1 var(--font-sans);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.mp-detail__gallery-toggle:hover {
  background: var(--surface-sunken);
  color: var(--text-strong);
}

.mp-detail__gallery-toggle:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
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

.mp-detail__basis-inner {
  /* Grid the ACTUAL content wrapper, not the UiCard root: UiCard applies the class to its
     outer element but slots content into an inner .mp-card__body, so a grid/gap on the root
     never reaches the head + groups. Gridding this inner div gives the generous separation
     between the meter head and each factor group so the group titles never collide with the
     row above them. */
  display: grid;
  gap: var(--space-6);
}

.mp-detail__basis-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.mp-detail__basis-meter {
  flex: 1;
  min-width: 0;
}

.mp-detail__basis-group {
  display: grid;
  gap: var(--space-4);
}

.mp-detail__basis-group-title {
  font: var(--weight-semibold) var(--text-xs) / 1 var(--font-sans);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.mp-detail__basis-items {
  /* Three-ish columns with generous row/column gaps so items never overlap. */
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-5) var(--space-4);
}
</style>
