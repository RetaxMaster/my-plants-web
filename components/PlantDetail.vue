<script setup lang="ts">
// Shared plant-detail body (Plant Lifecycle feature, Task 28). Rendered by THREE thin entry points —
// pages/plants/[id]/index.vue, pages/pantheon/[id].vue, pages/gifted/[id].vue — so there is exactly ONE
// implementation of the detail markup (fork-prevention rule). The invariant across all three: a frozen
// (MEMORIAL/GIFTED) plant is read-only (no edit/cover/profile/note/care mutations) but stays
// doctor-consultable, and shows its SNAPSHOT place/city labels instead of the live place relation.
// onUnmounted is imported explicitly (like AgentProposalBanner.vue / ArticleToc.vue) so the reconcile
// timer cleanup resolves under the component test harness, which stubs the other Vue APIs as globals but
// not this hook. Nuxt's auto-import skips an already-imported name, so there is no duplicate in the build.
import { onUnmounted } from 'vue';
import { type TaskCode, type DueState } from '../utils/tasks.js';
import { todayYmd, addDaysYmd, ymdToLocalDate } from '../utils/localDate.js';
import { plantTitle, speciesPrimaryName } from '../utils/displayName.js';

const props = defineProps<{ id: string }>();

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
const id = props.id;

const { data: plant, refresh: refreshPlant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
const { data: care, refresh } = await useAsyncData(`care-${id}`, () => api.getPlantCare(id));

// The browser tab shows the plant's own name (nickname, else localized species name); a plant that
// failed to load falls back to the generic "Plant" title rather than an empty tab.
useHead(() => ({ title: plant.value ? plantTitle(plant.value, locale.value) : t('meta.plantDetail.title') }));
useSeoMeta({ description: () => t('meta.plantDetail.description') });

// Frozen (Plant Lifecycle feature): a non-ACTIVE plant is read-only in the UI — no edit/cover/profile/
// note/care-feedback affordances — but stays doctor-consultable, and shows snapshot place/city labels.
const isFrozen = computed(() => !!plant.value?.lifecycleState && plant.value.lifecycleState !== 'ACTIVE');

// Task 27 (commemorative design pass): the frozen banner and hero photo pick up the SAME
// pantheon/gifted modifier classes the section list pages use (`assets/css/chrome.css`) — a
// class-level aesthetic, not a fork. MEMORIAL is memorial/serene; GIFTED is warm/luminous.
const frozenModifierClass = computed(() =>
  plant.value?.lifecycleState === 'MEMORIAL'
    ? 'mp-frozen-banner--pantheon'
    : plant.value?.lifecycleState === 'GIFTED'
      ? 'mp-frozen-banner--gifted'
      : '',
);
const frozenPhotoModifierClass = computed(() =>
  plant.value?.lifecycleState === 'MEMORIAL'
    ? 'mp-plantphoto--pantheon'
    : plant.value?.lifecycleState === 'GIFTED'
      ? 'mp-plantphoto--gifted'
      : '',
);

// The "back" link + its destination follow whichever section rendered this shared body: /plants for the
// normal active detail, /pantheon or /gifted for a frozen plant's entry point there.
const backTarget = computed(() => {
  if (route.path.startsWith('/pantheon/')) return '/pantheon';
  if (route.path.startsWith('/gifted/')) return '/gifted';
  return '/plants';
});
const backLabel = computed(() => {
  if (route.path.startsWith('/pantheon/')) return t('pantheon.title');
  if (route.path.startsWith('/gifted/')) return t('gifted.title');
  return t('plantDetail.backAll');
});

// Secondary reads — deferred to client so the detail page's first render issues only the two essential
// reads (identity + care header). `places` feeds only the edit modal + the (null-safe) place labels;
// the Photos and History sections below are wrapped so they appear on hydration, never flashing an empty
// state while their data is still null.
const { data: places } = useLazyAsyncData('places-for-edit', () => api.listPlaces(), { server: false });

const { data: history, refresh: refreshHistory } =
  useLazyAsyncData(`history-${id}`, () => api.getPlantHistory(id), { server: false });

// The photos gallery = every progress photo, flattened newest-first, each carrying its owning entryId.
const { data: photos, refresh: refreshPhotos } =
  useLazyAsyncData(`photos-${id}`, () => api.getPlantPhotos(id), { server: false });

// Collapsed by default: show the first 6 (2 rows of 3). The expand/collapse button only appears when
// there are MORE than 6 photos (guard on the TOTAL count, not the sliced list).
const PHOTOS_COLLAPSED = 6;
const photosExpanded = ref(false);
const visiblePhotos = computed(() => {
  const all = photos.value ?? [];
  return photosExpanded.value ? all : all.slice(0, PHOTOS_COLLAPSED);
});

// --- Async photo reconcile (stale-gallery fix). Unlike the cover photo (processed in-request), progress
// and import photos are stored PENDING and finished by a background worker AFTER the write returns. The
// gallery is READY-only, so the one refetch that fires when we return to this page lands while the new
// photos are still processing and would otherwise stay invisible until a manual reload. There is no push
// channel, so while the history reports ANY still-processing photo (`processingCount`, which counts only
// non-terminal PENDING/PROCESSING/RECOVERING — never a terminal READY/FAILED, so it always drains) we
// refetch the gallery + history + plant on a bounded interval until everything settles. This is NOT the
// entry modal's idle "still processing" indicator (spec §6.2, manual-refresh-only): it is a transient,
// self-terminating reconciliation armed ONLY while a just-added photo is genuinely mid-processing, and it
// stops the instant `processingCount` hits 0. A hard cap bounds it even if the worker were wedged.
const RECONCILE_EVERY_MS = 2500;
const RECONCILE_MAX_MS = 90_000;
const hasProcessingPhotos = computed(() =>
  (history.value ?? []).some((i) => i.kind === 'progress' && i.processingCount > 0),
);
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileStartedAt = 0;
function stopReconcile() {
  if (reconcileTimer) { clearTimeout(reconcileTimer); reconcileTimer = null; }
}
async function reconcileTick() {
  // Sequential (recursive setTimeout, not setInterval) so a slow refetch never overlaps the next tick.
  // Drop this plant's cached GET reads FIRST: no mutation runs between ticks, so without this the refresh()
  // calls below re-run their fetchers but the page-lifetime GET cache re-serves the pre-processing value
  // and the gallery/counts never catch up (the exact defeat the reconcile exists to beat).
  api.invalidatePlant(id);
  await Promise.all([refreshPhotos(), refreshHistory(), refreshPlant()]);
  reconcileTimer =
    hasProcessingPhotos.value && Date.now() - reconcileStartedAt <= RECONCILE_MAX_MS
      ? setTimeout(reconcileTick, RECONCILE_EVERY_MS)
      : null;
}
watch(hasProcessingPhotos, (processing) => {
  if (import.meta.server) return;
  if (processing && !reconcileTimer) {
    reconcileStartedAt = Date.now();
    reconcileTimer = setTimeout(reconcileTick, RECONCILE_EVERY_MS);
  } else if (!processing) {
    stopReconcile();
  }
}, { immediate: true });
onUnmounted(stopReconcile);

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
// Frozen plants never reach these — the overlay button that opens this modal is hidden (isFrozen).
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

const recordOpen = ref(false);
const activeRecordId = ref<string | null>(null);
function openRecord(recordId: string) {
  activeRecordId.value = recordId;
  recordOpen.value = true;
}

// Note modal (Task 17): one NoteModal instance, toggled between 'create' (the "Agregar nota" button)
// and 'edit' (a click on a 'note' history row). `activeNote` only matters in edit mode. The "Agregar
// nota" trigger is hidden when frozen; the history row is a READ affordance (kept visible) even frozen.
const noteOpen = ref(false);
const noteMode = ref<'create' | 'edit'>('create');
const activeNote = ref<{ noteId: string; body: string } | null>(null);
function openAddNote() {
  noteMode.value = 'create';
  activeNote.value = null;
  noteOpen.value = true;
}
function openNote(note: { noteId: string; body: string }) {
  noteMode.value = 'edit';
  activeNote.value = note;
  noteOpen.value = true;
}
async function onNoteSaved() {
  await refreshHistory();
}

function openEdit() {
  if (!plant.value) return;
  editing.value = true;
}

async function onEdited() {
  // A place change also writes a "Mudanza" MOVE entry to the timeline, so refresh the history in place
  // too — not only the identity + care rows. Without this the move history stays stale until a reload,
  // even though "Lives in" (from the plant read) updates. Mirrors the note-add path, which already
  // refreshes the history it mutates.
  await Promise.all([refreshPlant(), refresh(), refreshHistory()]); // title/place, care, AND move history
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

// Place name for the identity "Lives in" row + the hero photo chip. A frozen plant never reads the live
// relation — it shows the SNAPSHOT labels taken the moment it froze (place/city may have since changed,
// or (a GIFTED import) may never have existed at all).
const placeName = computed(() => {
  if (!plant.value) return '';
  if (isFrozen.value) {
    const label = plant.value.frozenPlaceLabel;
    if (!label) return '';
    const city = plant.value.frozenCityLabel;
    return city ? `${label} · ${city}` : label;
  }
  return (places.value ?? []).find((pl) => pl.id === plant.value!.placeId)?.name ?? '';
});

// Over-photo viability chip: dot color + short label from the shared viability i18n keys. `viability` is
// null for a frozen plant (the recompute-free frozen branch never computes a semaphore) — the chip itself
// is guarded out in the template (`v-if="care && care.viability"`), this just stays null-safe too.
const viabilityDot = computed(() => {
  const level = care.value?.viability?.level;
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
// Juvenile state (Spec 2 §7.3): FERTILIZE-only dose warning, plus surfaced as its own care-basis chip so
// the state isn't modal-only. `care.value?.juvenile` is optional (older API during a rolling deploy), so
// its absence reads as "unknown", never as false.
const isJuvenile = computed(() => care.value?.juvenile?.isJuvenile === true);

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
    {
      title: t('careBasis.groupLight'),
      items: [
        { icon: 'sun', label: t('careBasis.fields.level'), value: pl ? t('places.light_' + pl.lightType) : null, counted: false },
        { icon: 'window', label: t('careBasis.fields.windowDistance'), value: windowDistanceLabel(pr.windowDistance), counted: true },
        { icon: 'light-bulb', label: t('careBasis.fields.growLight'), value: yn(pr.growLight), counted: true },
      ],
    },
    {
      title: t('careBasis.groupPotSoil'),
      items: [
        { icon: 'archive-box', label: t('careBasis.fields.potType'), value: potTypeLabel(pr.potType), counted: true },
        { icon: 'arrows-pointing-out', label: t('careBasis.fields.potSize'), value: pr.potSizeCm != null ? t('careBasis.values.potSize', { n: pr.potSizeCm }) : null, counted: true },
        { icon: 'funnel', label: t('careBasis.fields.drainage'), value: yn(pr.hasDrainage), counted: true },
        { icon: 'square-3-stack-3d', label: t('careBasis.fields.soilMix'), value: soilMixLabel(pr.soilMix), counted: true },
        { icon: 'calendar', label: t('careBasis.fields.lastRepotted'), value: dv.lastRepottedOn ? d(ymdToLocalDate(dv.lastRepottedOn), 'short') : null, counted: true },
      ],
    },
    {
      title: t('careBasis.groupPlant'),
      items: [
        // Height is engine-read only through the crowding index (height ÷ pot size, habit-normalized):
        // it needs a pot size, a non-trailing habit, and a measurement fresh enough to still carry
        // authority. The API owns that rule.
        { icon: 'arrow-trending-up', label: t('careBasis.fields.height'), value: dv.heightCm != null ? t('careBasis.values.height', { n: dv.heightCm }) : null, counted: true },
        // `ageMonths` feeds NO factor in the care engine (docs/care-engine.md §7.11). Its only effect
        // today is an unintended confidence credit, documented there as a deferred bug. `growthHabit`
        // below shares the same confidence weight but DOES feed a factor.
        { icon: 'clock', label: t('careBasis.fields.age'), value: pr.ageMonths != null ? t('careBasis.values.age', { n: pr.ageMonths }) : null, counted: true },
        { icon: 'sparkles', label: t('careBasis.fields.juvenile'), value: isJuvenile.value ? t('common.yes') : null, counted: false },
        { icon: 'arrow-up-right', label: t('careBasis.fields.growthHabit'), value: growthHabitLabel(pr.growthHabit), counted: true },
      ],
    },
    {
      title: t('careBasis.groupPlaceClimate'),
      items: [
        { icon: 'cloud', label: t('careBasis.fields.humidity'), value: pl?.humidityCharacter ? t('places.humidity_' + pl.humidityCharacter) : null, counted: false },
        { icon: 'sun', label: t('careBasis.fields.indoorTemp'), value: (pl && pl.indoorTempMinC != null && pl.indoorTempMaxC != null) ? t('careBasis.values.tempRange', { min: pl.indoorTempMinC, max: pl.indoorTempMaxC }) : null, counted: false },
        { icon: 'home', label: t('careBasis.fields.setting'), value: pl ? (pl.indoor ? t('places.indoor') : t('places.outdoor')) : null, counted: false },
        { icon: 'adjustments-horizontal', label: t('careBasis.fields.nearAc'), value: pl ? yn(pl.climateControlled) : null, counted: false },
        { icon: 'fire', label: t('careBasis.fields.nearHeater'), value: yn(pr.nearHeater), counted: true },
        { icon: 'arrows-right-left', label: t('careBasis.fields.airflow'), value: pl?.airflow ? t('places.airflow_' + pl.airflow) : null, counted: false },
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

// --- Lifecycle transitions (Plant Lifecycle feature, Task 30): memorialize/gift on an ACTIVE plant,
// revive on a GIFTED one. MEMORIAL is terminal — no revive action ever renders for it. Every transition
// is a confirmation-gated write; `transitionPending` guards against a double-submit on either trigger
// button (both stay disabled/loading while the request is in flight) and errors surface rather than being
// swallowed — the pantheon/gifted confirm modals close on confirm (UiConfirmModal's own contract), so their
// failure surfaces as a page-level banner; the revive modal stays open on failure, so its error renders
// inline via the place field's own error slot.
const memorializeConfirmOpen = ref(false);
const giftConfirmOpen = ref(false);
const reviveOpen = ref(false);
const revivePlaceId = ref('');
const transitionPending = ref(false);
const transitionError = ref('');
const reviveError = ref('');

// Revive requires a placeId belonging to the SAME owner (no transfer-to-another-user in this feature) —
// same filter PlantEditModal uses for its own place picker.
const revivePlaceOptions = computed(() =>
  (places.value ?? [])
    .filter((p) => p.ownerId === plant.value?.ownerId)
    .map((p) => ({
      label: t('plantEdit.placeOption', { name: p.name, kind: p.indoor ? t('places.indoor') : t('places.outdoor') }),
      value: p.id,
    })),
);

function openRevive() {
  reviveError.value = '';
  revivePlaceId.value = '';
  reviveOpen.value = true;
}

async function confirmMemorialize() {
  if (transitionPending.value) return;
  transitionPending.value = true;
  transitionError.value = '';
  try {
    await api.memorializePlant(id);
    await navigateTo(`/pantheon/${id}`);
  } catch {
    transitionError.value = t('plantDetail.lifecycle.error');
  } finally {
    transitionPending.value = false;
  }
}

async function confirmGift() {
  if (transitionPending.value) return;
  transitionPending.value = true;
  transitionError.value = '';
  try {
    await api.giftPlant(id);
    await navigateTo(`/gifted/${id}`);
  } catch {
    transitionError.value = t('plantDetail.lifecycle.error');
  } finally {
    transitionPending.value = false;
  }
}

async function confirmRevive() {
  if (transitionPending.value || !revivePlaceId.value) return;
  transitionPending.value = true;
  reviveError.value = '';
  try {
    await api.revivePlant(id, revivePlaceId.value);
    reviveOpen.value = false;
    await navigateTo(`/plants/${id}`);
  } catch {
    reviveError.value = t('plantDetail.lifecycle.error');
  } finally {
    transitionPending.value = false;
  }
}
</script>

<template>
  <div v-if="plant">
    <UiScreenHeader
      :back="backLabel"
      :title="plantTitle(plant, locale)"
      :subtitle="plant.speciesScientificName && plant.speciesScientificName !== plantTitle(plant, locale) ? plant.speciesScientificName : undefined"
      @back="navigateTo(backTarget)"
    >
      <template v-if="!isFrozen" #action>
        <UiButton color="neutral" variant="soft" icon="pencil-square" @click="openEdit">{{ $t('common.edit') }}</UiButton>
      </template>
    </UiScreenHeader>

    <!-- Frozen banner (Plant Lifecycle feature): a MEMORIAL/GIFTED plant is read-only everywhere below,
         but remains doctor-consultable. -->
    <UiAlert
      v-if="isFrozen"
      :color="plant.lifecycleState === 'MEMORIAL' ? 'amber' : 'green'"
      :icon="plant.lifecycleState === 'MEMORIAL' ? 'archive-box' : 'gift'"
      :description="$t(`plantDetail.frozen.${plant.lifecycleState}`)"
      :class="['mp-detail__frozen-banner', frozenModifierClass]"
    />

    <!-- Hero photo -->
    <UiPlantPhoto
      :src="plant.coverImageUrl"
      :alt="$t('plantPhoto.alt', { name: plantTitle(plant, locale) })"
      :height="heroHeight"
      :class="['mp-detail__hero', frozenPhotoModifierClass]"
    >
      <template #chips>
        <UiPhotoChip v-if="placeName" icon="map-pin" :label="placeName" />
        <UiPhotoChip v-if="care && care.viability" :dot="viabilityDot" :label="$t('viability.' + care.viability.level)" />
      </template>
      <template v-if="!isFrozen" #overlay>
        <UiButton size="xs" variant="soft" color="neutral" icon="camera" @click="openCover">
          {{ $t('plantPhoto.edit') }}
        </UiButton>
      </template>
    </UiPlantPhoto>

    <!-- Lifecycle actions (Plant Lifecycle feature, Task 30): memorialize/gift on an ACTIVE plant, revive
         on a GIFTED one. MEMORIAL is terminal — no action renders for it. -->
    <UiAlert
      v-if="transitionError"
      color="red"
      :description="transitionError"
      class="mp-detail__lifecycle-error"
    />
    <div v-if="plant.lifecycleState === 'ACTIVE'" class="mp-detail__lifecycle">
      <UiButton
        variant="soft"
        color="neutral"
        icon="archive-box"
        :disabled="transitionPending"
        :loading="transitionPending"
        @click="memorializeConfirmOpen = true"
      >
        {{ $t('plantDetail.lifecycle.memorializeAction') }}
      </UiButton>
      <UiButton
        variant="soft"
        color="neutral"
        icon="gift"
        :disabled="transitionPending"
        :loading="transitionPending"
        @click="giftConfirmOpen = true"
      >
        {{ $t('plantDetail.lifecycle.giftAction') }}
      </UiButton>
    </div>
    <div v-else-if="plant.lifecycleState === 'GIFTED'" class="mp-detail__lifecycle">
      <UiButton
        variant="soft"
        color="cafe"
        icon="arrow-path"
        :disabled="transitionPending"
        @click="openRevive"
      >
        {{ $t('plantDetail.lifecycle.reviveAction') }}
      </UiButton>
    </div>

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
            v-if="care && care.viability"
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
              <UiBadge v-if="plant.latestProgress.health" :color="notesBadgeColor" size="xs" dot>{{ healthLabel(plant.latestProgress.health) }}</UiBadge>
              <span class="mp-detail__notes-date">{{ $d(ymdToLocalDate(plant.latestProgress.occurredOn), 'short') }}</span>
            </div>
            <p v-if="plant.latestProgress.observations" class="mp-detail__notes-obs">{{ plant.latestProgress.observations }}</p>
          </UiCard>
        </div>

        <!-- Plant Doctor entry (always available, even for a frozen plant or before the first progress entry) -->
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

        <!-- Photos gallery (deferred read: the section appears once photos hydrate). Kept visible when frozen. -->
        <div v-if="photos">
          <UiSectionTitle>{{ $t('photos.title') }}</UiSectionTitle>
          <UiCard v-if="!photos.length" padded>
            <!-- A frozen (memorial/gifted) plant is read-only, so the default "Log progress with a
                 photo…" CTA would invite an impossible action. Show a frozen-appropriate, CTA-free copy. -->
            <UiEmptyState>{{ isFrozen ? $t('photos.emptyFrozen') : $t('photos.empty') }}</UiEmptyState>
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

        <!-- History (deferred read: the section appears once history hydrates). Kept visible when frozen;
             only the "Agregar nota" mutating trigger is hidden. -->
        <div v-if="history">
          <div class="mp-detail__history-head">
            <UiSectionTitle>{{ $t('plantDetail.history') }}</UiSectionTitle>
            <UiButton v-if="!isFrozen" size="xs" variant="soft" color="neutral" icon="pencil-square" @click="openAddNote">
              {{ $t('history.addNote') }}
            </UiButton>
          </div>
          <UiCard v-if="!history.length" padded>
            <UiEmptyState>{{ $t('plantDetail.historyEmpty') }}</UiEmptyState>
          </UiCard>
          <UiCard v-else :padded="false">
            <div class="mp-detail__history">
              <HistoryTimeline :items="history" @open-entry="openEntry" @open-record="openRecord" @open-note="openNote" />
            </div>
          </UiCard>
        </div>
      </div>

      <!-- Right column: care, the care plan is based on -->
      <div class="mp-detail__col">
        <!-- Care -->
        <div>
          <UiAlert
            v-if="care?.viability?.level === 'caution'"
            color="amber"
            class="mp-detail__alert"
            :title="$t('plantDetail.cautionTitle')"
            :description="$t('plantDetail.cautionDesc')"
          />
          <UiAlert
            v-if="care?.viability?.level === 'poor'"
            color="red"
            class="mp-detail__alert"
            :title="$t('plantDetail.poorTitle')"
            :description="$t('plantDetail.poorDesc')"
          />

          <UiSectionTitle>{{ $t('plantDetail.care') }}</UiSectionTitle>

          <!-- A frozen plant's care payload always carries tasks:[] (no recompute), so this empty state is
               what renders — the `isFrozen` clause defends the case defensively too, never trusting a
               single source for a read-only guarantee. -->
          <UiCard v-if="!care || !care.tasks.length || isFrozen" padded>
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
                <UiButton v-if="!isFrozen" size="xs" variant="soft" color="neutral" icon="plus" @click="profileOpen = true">
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
    <ClinicalRecordModal v-model="recordOpen" :plant-id="id" :record-id="activeRecordId" />
    <NoteModal v-model="noteOpen" :plant-id="id" :mode="noteMode" :note="activeNote" @saved="onNoteSaved" />
    <UiImageLightbox v-model="lightboxOpen" v-model:index="lightboxIndex" :images="lightboxImages" />
    <PlantProfileModal v-model="profileOpen" :plant-id="id" @saved="onProfileSaved" />
    <UiTaskInfoModal v-model:open="taskInfoOpen" :task="taskInfoTask" :soil-dryness="taskInfoDryness" :repot-signs="taskInfoRepotSigns" :is-juvenile="isJuvenile" />

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

    <!-- Lifecycle transition modals (Plant Lifecycle feature, Task 30). -->
    <UiConfirmModal
      v-model="memorializeConfirmOpen"
      :title="$t('plantDetail.lifecycle.memorializeTitle')"
      :message="$t('plantDetail.lifecycle.memorializeBody')"
      :confirm-label="$t('plantDetail.lifecycle.memorializeConfirm')"
      confirm-icon="archive-box"
      @confirm="confirmMemorialize"
    />
    <UiConfirmModal
      v-model="giftConfirmOpen"
      :title="$t('plantDetail.lifecycle.giftTitle')"
      :message="$t('plantDetail.lifecycle.giftBody')"
      :confirm-label="$t('plantDetail.lifecycle.giftConfirm')"
      confirm-icon="gift"
      @confirm="confirmGift"
    />
    <UiModal v-model="reviveOpen" :title="$t('plantDetail.lifecycle.reviveTitle')">
      <div class="mp-detail__revive-form">
        <p class="mp-detail__revive-body">{{ $t('plantDetail.lifecycle.reviveBody') }}</p>
        <UiFormGroup :label="$t('plantDetail.lifecycle.revivePlace')" :error="reviveError">
          <UiSelectField
            v-model="revivePlaceId"
            :options="revivePlaceOptions"
            :placeholder="$t('plantDetail.lifecycle.revivePlacePlaceholder')"
            :disabled="transitionPending"
          />
        </UiFormGroup>
      </div>
      <template #footer>
        <UiButton color="neutral" variant="ghost" :disabled="transitionPending" @click="reviveOpen = false">
          {{ $t('common.cancel') }}
        </UiButton>
        <UiButton
          color="primary"
          :disabled="!revivePlaceId"
          :loading="transitionPending"
          @click="confirmRevive"
        >
          {{ $t('plantDetail.lifecycle.reviveConfirm') }}
        </UiButton>
      </template>
    </UiModal>
  </div>
  <UiEmptyState v-else>{{ $t('common.loading') }}</UiEmptyState>
</template>

<style scoped>
.mp-detail__hero {
  margin-bottom: 18px;
}

.mp-detail__frozen-banner {
  margin-bottom: 14px;
}

.mp-detail__lifecycle-error {
  margin-bottom: 14px;
}

.mp-detail__lifecycle {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: 18px;
}

.mp-detail__revive-form {
  display: grid;
  gap: var(--space-3);
}

.mp-detail__revive-body {
  margin: 0;
  font: var(--text-sm) / 1.4 var(--font-sans);
  color: var(--text-body);
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

.mp-detail__history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: 12px;
}

/* Neutralize UiSectionTitle's own bottom margin here — the flex row's own layout supplies the spacing
   below it instead, so the title + button share one vertical rhythm. */
.mp-detail__history-head :deep(.mp-section-title) {
  margin-bottom: 0;
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
