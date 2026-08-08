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
import { repotExplanation } from '../utils/repotExplanation.js';
import { fertilizeExplanation } from '../utils/fertilizeExplanation.js';
// Explicit, like every other util this file uses: one implementation of "which pending evaluation may an
// action name" and one of "which sign is worth suggesting next", shared with pages/index.vue.
import { resolvableEvaluationId, checkedSignIdsFrom } from '../utils/repotEvaluation.js';
// Explicit import, same reasoning as `onUnmounted` above: the composable's OWN `shallowRef` import makes
// it test-environment-agnostic. Round-5 finding V1 — extracted so this file and pages/index.vue (the
// FIRST renderer of the same REPOT flows) share ONE attempt-tracking implementation instead of two
// separately-maintained copies (the fourth time in this review a fix landed on one of these files and not
// its sibling — see the composable's own doc comment for the race this closes).
import {
  useRepotAttempt, classifyRepotFailure, repotFailureMessageKey, isAttemptFrozen,
  type RepotCompletion, type RepotAttemptFailure,
} from '../composables/useRepotAttempt';
import type { RepotSign, RepotEvaluationSubmit, RepotEvaluationResult, RepotDonePayload } from '../types/api.js';

const props = defineProps<{ id: string }>();

const { t, d, locale } = useI18n();
// Detail page uses ONLY the long phrasing ("Due in N days" / "Overdue by N days"),
// so destructure dueLabelLong (NOT dueLabel — that is the short Today-page form).
const { dueLabelLong, healthLabel } = useTaskMeta();

const route = useRoute();
const api = useApi();

const { earlyWaterOptions, postponeOptions } = useFeedbackReasons();

const pending = ref<{ task: TaskCode; type: 'DONE' | 'POSTPONED'; occurredOn?: string } | null>(null);
const earlyPickerOpen = ref(false);
const postponePickerOpen = ref(false);
const isDesktop = useIsDesktop();
const id = props.id;

// REPOT is a verdict-driven state machine (Task 27 shipped it on the Today page; migrated here Task 28):
// the card offers "time to evaluate" until an evaluation resolves it (RepotEvaluationModal.vue), and only
// a 'REPOT' verdict unlocks the classic Done | Postpone — see TaskRow.vue's `showEvaluate`. Same flow, same
// components, same idempotency discipline as pages/index.vue — this is the second (and last) renderer.
const evaluationOpen = ref(false);
const evaluationSigns = ref<RepotSign[]>([]);
// Informative-only context for the questionnaire (how often this species is typically repotted) — sourced
// from the SAME `GET /plants/:id/repot-signs` call as `evaluationSigns` above, never a second fetch.
const evaluationTypicalIntervalMonths = ref<number | null>(null);
// The active REPOT-evaluation submit attempt for THIS plant — `useRepotAttempt.ts`, the SAME
// implementation pages/index.vue uses for its own evaluation flow (round-5 finding V1: the two renderers
// previously kept SEPARATE `evaluationSubmitting`/`evaluationKey` refs and an unconditional `finally`,
// which reopened the exact "submitting" race round-4's V1 had already fixed on the sibling page — see the
// composable's own doc comment for the full race, the per-plant map (U1), and why `shallowRef`, not `ref`,
// matters). This component is pinned to one plant's `id` for its whole lifetime, so `evaluationAttempt`
// just reads that one plant's map entry, but it goes through the SAME `attemptFor` seam pages/index.vue
// uses for its many plants — never a second, single-plant-shaped API on this composable. W1: the FLOW KEY
// `'evaluation'` passed here resolves to the SAME module-scope store pages/index.vue's own
// `useRepotAttempt<RepotEvaluationSubmit>('evaluation')` call resolves to — an attempt started on the Today
// page for this plant is visible (and resumable) here, and vice versa.
const {
  attemptFor: evaluationAttemptFor,
  subscribeCompletions: subscribeEvaluationCompletions,
  begin: beginEvaluationAttempt,
  isLive: isLiveEvaluationAttempt,
  resolveSuccess: resolveEvaluationSuccess,
  resolveFailure: resolveEvaluationFailure,
  invalidate: invalidateEvaluationAttempt,
  hasResumableKeyFor: hasResumableEvaluationKeyFor,
} = useRepotAttempt<RepotEvaluationSubmit, RepotEvaluationResult>('evaluation');
const evaluationAttempt = computed(() => evaluationAttemptFor(id));
// The verdict the last evaluation submit returned, shown in its own modal (RepotVerdictModal.vue).
const verdict = ref<RepotEvaluationResult | null>(null);
// ...and the ANSWER that produced it, read off the completion record's frozen request body. The API's
// verdict payload deliberately carries no echo of the question, and "no signs yet" and "I couldn't check
// it" both come back as the same RE-EVALUATE verdict — while meaning opposite things to the owner, who in
// one case looked and saw nothing and in the other never looked at all. The modal needs the distinction to
// say something true; nothing else does, which is why it stays a display concern and not a contract change.
const verdictAnswer = ref<RepotEvaluationSubmit['answer'] | null>(null);
// ...and the sign IDS that answer carried, from the same frozen request body. Feeds ONLY the verdict
// modal's "one more thing worth going to look for" line (owner request, 2026-08-07) — the modal subtracts
// them from `evaluationSigns` to find the strongest sign the owner has NOT reported. Kept as its own ref
// rather than widening `verdictAnswer` into the whole body, so the existing prop's meaning is untouched.
const verdictCheckedSignIds = ref<string[]>([]);
const verdictOpen = ref(false);
// Set only when the SIGNS FETCH itself fails (network/5xx) — never for a genuinely empty catalogue, which
// is a valid outcome and must keep opening the questionnaire. Selects the load-specific message + retry
// affordance on the shared repotError banner below, instead of the generic "already has an answer" text.
const evaluationLoadFailed = ref(false);

// REPOT is also the one task whose completion physically replaces the medium (Spec 1 §6/Task 21), so its
// Done path opens a small pre-filled form (RepotDoneForm.vue) instead of posting directly.
const doneFormOpen = ref(false);
const doneFormProfile = ref<{ potSizeCm: number | null; soilMix: string | null }>({ potSizeCm: null, soilMix: null });
// A3 (spec §2.3) — the date the owner typed into the card's own back-date input (`withDoneDate`), captured
// when the form is OPENED. It now only SEEDS `UiRepotDoneForm`'s own date field (`seed-occurred-on`); the
// form owns the one editable date surface for the submission and its `confirm` payload's `occurredOn` is
// what actually reaches the request — see `onRepotDoneConfirm` below. Empty means "no seed", the same
// fallback every other Done path already has, and the form itself defaults to today. Owner request,
// 2026-08-07: a repot he did some days ago and is only recording now must be recordable on the day it
// happened, not on the day he typed it. It reaches `refreshSubstrateCore` too (`completeRepotCore` anchors
// `refreshedOn` to `occurredOn`), so a back-dated repot back-dates the substrate clock — which is the point.
const doneFormOccurredOn = ref('');
// Same per-plant-map discipline as evaluationAttempt above — its OWN `useRepotAttempt()` instance (never
// shared with the evaluation flow's, so a Done confirm and an evaluation submit for the same plant never
// contend for the same attempt object). `TBody` bundles `completeRepot`'s two non-plantId, non-key
// arguments together (U2): `occurredOn` and `evaluationId` are each read fresh at confirm time, but once a
// key is minted, `beginDoneAttempt` freezes that WHOLE envelope on the attempt and every retry resends it
// verbatim, regardless of what a fresh read would produce.
const {
  attemptFor: doneAttemptFor,
  subscribeCompletions: subscribeDoneCompletions,
  begin: beginDoneAttempt,
  isLive: isLiveDoneAttempt,
  resolveSuccess: resolveDoneSuccess,
  resolveFailure: resolveDoneFailure,
  invalidate: invalidateDoneAttempt,
  hasResumableKeyFor: hasResumableDoneKeyFor,
} = useRepotAttempt<{ occurredOn: string; payload: RepotDonePayload }>('done');
const doneAttempt = computed(() => doneAttemptFor(id));
const repotPostponeSubmitting = ref(false);

// Every REPOT mutating flow can genuinely fail — the state a card was built from can go stale between
// render and click. FIX C: the message shown is no longer one hardcoded string for every kind of failure —
// `classifyRepotFailure`/`repotFailureMessageKey` (useRepotAttempt.ts) tell a 409/422 ("an outstanding
// answer, reload") apart from a 400 ("the server rejected your VALUES, correct them") apart from anything
// else. RepotEvaluationModal.vue and RepotDoneForm.vue each render this via their own opt-in `error` prop
// (Alert INSIDE their own teleported body, above the backdrop — see pages/index.vue's identical comment for
// the reasoning).
//
// W2: that `error` prop no longer reads off THIS shared flag for the two mutation flows — it reads off
// `evaluationAttempt?.error` / `doneAttempt?.error` instead (set by `useRepotAttempt.ts`'s `resolveFailure`,
// keyed by plantId AND by flow — see pages/index.vue's identical comment for the full reasoning, including
// why a shared flag could leak one flow's failure into the other's modal on THIS same plant). `repotError`
// stays for exactly two things with no attempt of their own: `onRepotPostpone` (no modal, no key) and the
// evaluation-signs LOADER failure below — both fail BEFORE any key is ever minted. The page-level banner
// below stays the only feedback surface for the postpone flow, which has no modal at all.
const repotError = ref(false);
// FIX C: same reasoning as pages/index.vue's identical ref — `onRepotPostpone` has no attempt/key of its own
// to classify through `useRepotAttempt.ts`'s per-attempt `error` field, so this carries the SAME
// classification for the postpone banner's own non-loader branch below.
const repotPostponeFailure = ref<RepotAttemptFailure>('unknown');

const { data: plant, refresh: refreshPlant } = await useAsyncData(`plant-${id}`, () => api.getPlant(id));
const { data: care, refresh } = await useAsyncData(`care-${id}`, () => api.getPlantCare(id));

// The measure affordance (measured:22, spec §4.8): readings load alongside the care payload, through the
// same `useApi` seam every other read in this file uses. `PlantSoilReadings` is a REQUIRED prop on
// `SoilReadingModal` (never optional-shaped like the care payload), so the template falls back to an empty
// shape before the fetch resolves — same convention as `:places="places ?? []"` a few lines down.
const { data: readings, refresh: refreshReadings } = await useAsyncData(`soil-readings-${id}`, () => api.getSoilReadings(id));
const readingModalOpen = ref(false);
// A saved reading can change BOTH the readings list (SoilReadingModal's own data) and the care payload's
// `measurement` block (a new reading can flip `suggestMeasuring`/`tooSlowDrying`/`flatSeries`) — refresh
// both, never just one, or one of the two surfaces silently shows stale data right after a save.
async function onReadingSaved() {
  await Promise.all([refresh(), refreshReadings()]);
}

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

// The COVER photo's own viewer state (Task 16). Deliberately separate from the gallery lightbox above:
// the cover is not part of the gallery's paging sequence, and folding it in would silently change which
// photo the arrows step through. Same PRIMITIVE though — UiImageLightbox, reused, never a second viewer.
//
// It is NOT gated on `isFrozen`: freezing forbids mutation, and looking at a photo is not one. A
// memorialized plant's photo is the thing the pantheon exists for.
const coverLightboxOpen = ref(false);
const coverLightboxImages = computed(() =>
  plant.value?.coverImageUrl
    ? [{ src: plant.value.coverImageUrl, alt: t('plantPhoto.alt', { name: plantTitle(plant.value, locale.value) }) }]
    : [],
);
function openCoverLightbox() {
  if (coverLightboxImages.value.length === 0) return;
  coverLightboxOpen.value = true;
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
// A3 (spec §2.3) — set when PlantProfileModal reports an actual soil-mix change (never a save that left it
// untouched). Persistent: dismissing the completion form below does NOT clear it, because dismissing the
// modal does not answer the question the affordance exists to ask — only an explicit "Not now" (the
// affordance's own dismiss button) or a genuinely recorded repot (handleDoneCompletion below) does.
const soilChangePending = ref(false);
async function onProfileSaved(e: { soilMixChanged: boolean }) {
  // The mix lives on the plant's own profile (refreshPlant), but it also feeds the watering model's
  // optional channel (see PlantProfileModal.vue's own comment) — the CARE payload (task rows, due dates)
  // can move too, so both reads refresh, exactly like `onEdited` above refreshes plant+care+history for the
  // same reason.
  await Promise.all([refreshPlant(), refresh()]); // profile + derived changed -> the meter and info items move
  if (!e.soilMixChanged) return;
  // A3 (spec §2.3): the shortcut opens the flow that ALREADY owns the `substrate_refreshed_on` write —
  // never a fourth writer. The anti-fork rule is satisfied structurally rather than by discipline.
  soilChangePending.value = true;
  onRepotDone(undefined);
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
// what to look for. `care.value.crowding` carries NO signs any more (Task 16 removed `repotSigns` from the
// care payload outright) — sourced instead from `GET /plants/:id/repot-signs`, the SAME catalogue endpoint
// `onEvaluate` below reads for the questionnaire (one resolver, two renderers — never a second copy of the
// list). Secondary read, deferred to client like `places`/`history`/`photos` above. Localized server-side —
// rendered verbatim (the known API-supplied English-leak class) — and REFETCHED on a locale change: the BFF
// proxy forwards the active locale as `x-locale`, so this catalogue's response body is locale-dependent, and
// `useLazyAsyncData` re-keys only on its first argument and does not track reactive reads made inside the
// handler, so `watch: [locale]` is what re-runs it — without that option a language switch would leave
// these labels in the previous locale.
const { data: repotSignsCatalogue } =
  useLazyAsyncData(`repot-signs-${id}`, () => api.getRepotSigns(id).then((r) => r.signs), { server: false, watch: [locale] });
const taskInfoRepotSigns = computed(() =>
  taskInfoTask.value === 'REPOT' ? (repotSignsCatalogue.value ?? []).map((s) => s.label) : null,
);
// Juvenile state (Spec 2 §7.3): FERTILIZE-only dose warning, plus surfaced as its own care-basis chip so
// the state isn't modal-only. `care.value?.juvenile` is optional (older API during a rolling deploy), so
// its absence reads as "unknown", never as false.
const isJuvenile = computed(() => care.value?.juvenile?.isJuvenile === true);

// Explains WHY a date is where it is (Spec 1 §8, A1/A2). Returns undefined for every task with nothing to
// say, so the row renders exactly as it does today.
function taskExplanation(task: string): string | undefined {
  if (task === 'FERTILIZE') {
    // A1 + B1 (spec §2.1, ledger D3) — composition extracted to utils/fertilizeExplanation.ts, which
    // renders ONE SENTENCE PER CAUSE (FLOOR/SNAP) straight off the care payload's own `fertilize` block.
    // This REPLACES the previous hand-rolled `fertilizeFloorOn` re-derivation, which could only ever
    // report the floor and silently dropped the snap-to-watering-day cause when both acted.
    return fertilizeExplanation(care.value?.fertilize, t);
  }
  const s = care.value?.substrate;
  if (task === 'REPOT' && s?.repotDriver) {
    // Composition extracted to utils/repotExplanation.ts (its own dedicated unit test covers the
    // append-never-substitute rule) — see that file's comment for the full rationale.
    return repotExplanation(s, t);
  }
  return undefined;
}

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

// The pending REPOT evaluation for this plant, read off the already-loaded care payload — never a fresh
// fetch. Used BOTH to render the card's :pending-verdict (before any click) and to attach the
// evaluationId to a REPOT Done/Postpone that follows a resolved verdict. Mirrors pages/index.vue's
// `pendingEvaluationFor`, scoped to this plant's single care read instead of the whole Today list.
const pendingRepotEvaluation = computed(() => care.value?.tasks.find((t) => t.task === 'REPOT')?.pendingEvaluation ?? null);

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

// Evaluate: opens the signs checklist. Fetches the species' repotting signs fresh every time the modal
// opens (mirrors pages/index.vue's onEvaluate); an empty SUCCESSFUL list simply renders no signs rather
// than blocking the picker. A FAILED fetch is a different thing entirely and must NOT open the
// questionnaire (code review finding W16): the universal, app-seeded pot-physics rows mean a real success
// is essentially never empty, so treating a dropped request as "no signs" would hand the owner nothing to
// check and then record their forced `not-needed` answer as genuine negative evidence, pushing the repot
// date out on an infrastructure fault.
async function onEvaluate() {
  // Resume, don't reset (code review finding V12): closing the modal via X/Escape/backdrop routes back
  // here on re-open — the card still shows "evaluate" because no verdict resolved it — and treating that
  // like a fresh attempt threw away the only key able to replay an evaluation the server may already have
  // stored, leaving the owner stuck on the next submit's 422. So a key outstanding at this point is a
  // resume: keep the key AND the prior error untouched (RepotEvaluationModal.vue then keeps its answers
  // frozen across the reopen, and `frozen && error` still surfaces the "start over" escape hatch). This
  // component is pinned to one plant's `id` for its whole lifetime, so there is only ever one entry in the
  // composable's per-plant map (U1) for it to read — but it goes through the SAME
  // `hasResumableKeyFor`/attemptFor
  // seam pages/index.vue uses for its many plants, never a second, single-plant-shaped check.
  const resuming = hasResumableEvaluationKeyFor(id);
  if (!resuming) {
    repotError.value = false;
  }
  evaluationLoadFailed.value = false;
  try {
    const result = await api.getRepotSigns(id);
    evaluationSigns.value = result.signs;
    evaluationTypicalIntervalMonths.value = result.typicalIntervalMonths;
  } catch {
    evaluationLoadFailed.value = true;
    repotError.value = true;
    return;
  }
  evaluationOpen.value = true;
}

// Retry affordance for the page-level banner when `evaluationLoadFailed` is set.
function retryEvaluate() {
  void onEvaluate();
}

async function onEvaluationSubmit(body: RepotEvaluationSubmit) {
  // Capture the exact attempt this request belongs to (round-5 finding V1, the SAME race pages/index.vue's
  // onEvaluationSubmit already guards against — see `useRepotAttempt.ts`'s own doc comment): a successful
  // submit clears the attempt and closes the modal BEFORE awaiting `refresh()`/`refreshHistory()` below, so
  // while that await is still pending the owner can reopen and resubmit — `isLiveEvaluationAttempt` is the
  // token that stops the FIRST (now-stale) attempt's own bookkeeping from clobbering the SECOND, still-live
  // one once its late refresh finally resolves.
  //
  // U2: `beginEvaluationAttempt` freezes the WHOLE submitted body on the attempt the moment the key is
  // minted, and returns that STORED body (never this freshly-passed one) on a retry — so `attempt.body`,
  // never the `body` parameter, is what actually gets sent below.
  //
  // W2: no page-level `repotError.value = false` here any more — `beginEvaluationAttempt` itself resets
  // THIS attempt's own `error` field the moment a submit (fresh or retry) begins. See pages/index.vue's
  // identical comment for the full reasoning.
  const attempt = beginEvaluationAttempt(id, body);
  try {
    const result = await api.submitRepotEvaluation(id, attempt.body, attempt.key);
    // X1: same reasoning as pages/index.vue's identical comment — `resolveEvaluationSuccess` is the ONLY
    // place that clears the attempt AND publishes the flow's completion signal (naming this plant + the
    // verdict), and it already no-ops both when `attempt` is no longer live, so there is no separate
    // staleness check to duplicate here any more. Closing the modal, showing the verdict, and refreshing
    // care/history are handled EXCLUSIVELY by the completion watcher below — see its own comment for why
    // that is the SINGLE owner of that effect, on both this renderer and pages/index.vue, so neither one can
    // double-handle its own completion.
    resolveEvaluationSuccess(attempt, result);
  } catch (e) {
    if (!isLiveEvaluationAttempt(attempt)) return;
    // Key AND stored body deliberately kept (not cleared) on failure: a lost-response retry must reuse
    // both, per the stable-idempotency-key rule and U2's whole-envelope freeze. The modal stays open so the
    // owner can see the error and retry the SAME submission rather than silently losing it. The modal
    // freezes its inputs for as long as `isAttemptFrozen(evaluationAttempt)` says so — true for every
    // failure kind EXCEPT 'invalid' (FIX C) — but the byte-identical retry no longer depends on that alone —
    // `beginEvaluationAttempt` above resends the attempt's STORED body regardless of what the (frozen) form
    // would recompute. W2/FIX C1: `resolveEvaluationFailure` sets `error` (the classified FAILURE KIND) on
    // THIS attempt itself — no page-level flag to set, so this plant's own failure can never leak into the
    // Done form's error display, nor into a different plant's evaluation modal.
    resolveEvaluationFailure(attempt, classifyRepotFailure(e));
  }
}

// Explicit escape hatch (code review finding W17): abandons the outstanding key so the form unfreezes and
// a later submit mints a fresh one, instead of forcing a page reload to get out of a stuck retry.
function onEvaluationStartOver() {
  invalidateEvaluationAttempt(id);
}

// X1: the flow's TERMINAL OUTCOME, shared across renderers via `useRepotAttempt.ts`'s module-scope
// `completion` signal — published by `resolveEvaluationSuccess` the instant a LIVE submit succeeds,
// regardless of which renderer's own request produced it. This component and pages/index.vue consume the SAME
// per-flow completion log (R11-1), so a submit confirmed on the Today page, whose response only settles after the owner has
// navigated here, still closes THIS page's own modal and refreshes ITS OWN data — the race X1 exists to
// close (a departed page's promise keeps running after navigation). `invalidateEvaluationAttempt` (the
// "start over" escape hatch) never publishes a completion, so abandoning an attempt can never be mistaken
// for completing one here.
//
// Z1: same separation pages/index.vue draws between "refresh this renderer's own data" (unconditional) and
// "own the modal, so close it / show the verdict" (conditional). Here the two questions collapse onto the
// SAME check, `completion.plantId === id`: this component is pinned to one plant for its whole lifetime, so
// a completion naming a DIFFERENT plant carries no data this page has ever fetched — there is nothing of
// "this renderer's own data" to refresh for a foreign plant. That collapse is what pages/index.vue's own Z1
// comment calls "trivially true" — the SHAPE (two separate questions) still matches; only the boolean
// happens to answer both here.
//
// R11-1: this handler is registered through `subscribeCompletions`, which owns BOTH the backlog published
// during this component's own async setup — the route-transition gap where a departed Today page's promise
// settles while this page is still awaiting its plant/care reads — and every later record, draining them
// oldest-first through this ONE function. The renderer no longer states a baseline, a catch-up or a watcher.
async function handleEvaluationCompletion(completion: RepotCompletion<RepotEvaluationResult, RepotEvaluationSubmit>) {
  const isOwnPlant = completion.plantId === id;
  if (isOwnPlant) {
    evaluationOpen.value = false;
    verdict.value = completion.result;
    verdictAnswer.value = completion.body.answer;
    verdictCheckedSignIds.value = checkedSignIdsFrom(completion.body);
    verdictOpen.value = true;
    await Promise.all([refresh(), refreshHistory()]);
  }
}

subscribeEvaluationCompletions(
  (completion) => { void handleEvaluationCompletion(completion); },
  // R12-1 / R13-2: a GAP — more completions landed than the shared log retains before this renderer handled
  // them, so records it needed no longer exist to be replayed. The likeliest cause is being blocked in its
  // own async setup, but the detector only compares this reader's cursor against the trim point and does not
  // distinguish that case from any other way of falling behind. Either way it cannot know WHICH plants it
  // missed, so the only safe response is to reconcile everything it renders, unconditionally.
  () => { void Promise.all([refresh(), refreshHistory()]); },
);

// Done: opens the completion form, pre-filled with the plant's current profile (only reachable once a
// 'REPOT' verdict is pending — see TaskRow's showEvaluate).
function onRepotDone(occurredOn?: string) {
  // Resume, don't reset (B1 — mirrors onEvaluate's identical guard above, and pages/index.vue's twin fix
  // for the SAME defect). The comment this replaces ("always a fresh attempt, no resume path") was false:
  // RepotDoneForm.vue's own `watch(open, ...)` guard deliberately skips the field reset while `frozen`,
  // specifically to support a RESUME after the owner closes the form (X/Escape/backdrop) without resolving
  // an outstanding confirm. Unconditionally invalidating before reopening made that resume guard
  // unreachable — dead code standing in for a live bug: a Done confirm that committed on the server but
  // lost its response kept the key and froze the form; the owner dismissed the modal; the next open
  // discarded the key and re-prefilled; the next confirm then minted a FRESH idempotency key, so the server
  // recorded a SECOND, non-deduplicated completion of a repot it had already recorded.
  //
  // Unlike pages/index.vue's onRepotDone, there is no fallible fetch here (this component already holds
  // `plant.value` loaded for its whole lifetime) and no cross-plant case to guard — this component is
  // pinned to one plant's `id`, so the check is simply whether a key is already outstanding for it.
  //
  // FIX D1 — this asks `hasResumableDoneKeyFor`, the SAME predicate `beginDoneAttempt` itself uses to decide
  // resume-vs-fresh, NOT the weaker "is a key outstanding?" it used to ask. The two disagree on exactly one
  // case, and it is a live one: after a 400 the key is still in the store, but `begin()` will NOT resume it
  // (FIX C2 — a rejected key is useless, so the next confirm is a genuinely new submission). Gating on the
  // weak question took the early return anyway and skipped `doneFormOccurredOn`, so the corrected submission
  // went out under a FRESH key carrying the date the owner typed BEFORE the rejection — writing the repot,
  // and with it `substrate_refreshed_on`, on the wrong day, silently, on the one path the standalone Done
  // exists for.
  const resuming = hasResumableDoneKeyFor(id);
  if (resuming) {
    // A genuine resume: the frozen body must stay byte-identical to the one the outstanding key was minted
    // for, so nothing is re-read — not the error, not the profile prefill, and not the back-date, even if
    // the owner has since retyped it on the card. `beginDoneAttempt` resends the STORED envelope on a
    // resume, so accepting a new date here would only make the form display a date the request will not
    // carry. (The previous comment claimed that held for every failure; it does not hold for the 400, which
    // is why this branch must no longer be reached in that case at all.)
    doneFormOpen.value = true;
    return;
  }
  repotError.value = false;
  doneFormProfile.value = { potSizeCm: plant.value?.profile.potSizeCm ?? null, soilMix: plant.value?.profile.soilMix ?? null };
  doneFormOccurredOn.value = occurredOn ?? '';
  doneFormOpen.value = true;
}

async function onRepotDoneConfirm(payload: Omit<RepotDonePayload, 'evaluationId'> & { occurredOn: string }) {
  // Capture the exact attempt this request belongs to — the SAME race as onEvaluationSubmit above (round-5
  // finding V1): a successful confirm clears the attempt and closes the form BEFORE awaiting the refreshes
  // below, so while that await is still pending the owner can reopen and reconfirm — `isLiveDoneAttempt`
  // stops the FIRST (now-stale) attempt's own bookkeeping from clobbering the SECOND, still-live one once
  // its late refresh finally resolves.
  //
  // A3 (spec §2.3): `occurredOn` now arrives WITH the payload — `UiRepotDoneForm` is the one editable date
  // seam for the submission (Task 25), so this reads `payload.occurredOn` rather than re-deriving it from
  // `doneFormOccurredOn`/`today()` itself. `evaluationId` is still read fresh off the live task list at
  // confirm time (U2), including on a retry: that is safe BECAUSE `beginDoneAttempt` freezes the WHOLE
  // envelope on the attempt the moment the key is minted and returns the STORED envelope (never this
  // freshly-built one) on a retry — so a retry still resends the byte-identical body the key was minted
  // for, even across an intervening `refresh()` that resolved a different pending evaluation, which would
  // otherwise 422 forever against the server's idempotency interceptor.
  //
  // `resolvableEvaluationId` (utils/repotEvaluation.ts), not a bare `pendingEval.id`: a standalone Done can
  // now be pressed while the pending row is a RE-EVALUATE, and naming THAT row is a 400 from the server —
  // it resolves only an unresolved `REPOT` verdict. A RE-EVALUATE is superseded by the completion instead,
  // which needs no id. See that helper's own comment for the full reasoning.
  const { occurredOn, ...repotDonePayload } = payload;
  const evaluationId = resolvableEvaluationId(pendingRepotEvaluation.value);
  // W2: no page-level `repotError.value = false` here any more — same reasoning as onEvaluationSubmit above.
  const attempt = beginDoneAttempt(id, {
    occurredOn,
    payload: { ...repotDonePayload, ...(evaluationId ? { evaluationId } : {}) },
  });
  try {
    await api.completeRepot(id, attempt.body.occurredOn, attempt.body.payload, attempt.key);
    // X1: same reasoning as onEvaluationSubmit's identical comment above — `resolveDoneSuccess` is the ONLY
    // place that clears the attempt AND publishes the completion signal (the Done flow has no verdict to
    // carry, so its completion names only the plant), and it already no-ops both when `attempt` is no longer
    // live. Closing the form and refreshing care/history/the plant's own profile are the completion
    // watcher's job alone, below.
    resolveDoneSuccess(attempt);
  } catch (e) {
    if (!isLiveDoneAttempt(attempt)) return;
    // Key AND stored envelope deliberately kept on failure, same reasoning as onEvaluationSubmit. W2/FIX C1:
    // `resolveDoneFailure` sets `error` (the classified FAILURE KIND) on THIS attempt itself — no page-level
    // flag to set, so this plant's Done failure can never leak into the evaluation modal's error display.
    resolveDoneFailure(attempt, classifyRepotFailure(e));
  }
}

// Explicit escape hatch for the Done form (code review finding Y2, mirrors onEvaluationStartOver above):
// abandons the outstanding attempt so the form unfreezes and a later confirm mints a fresh one.
function onRepotDoneStartOver() {
  invalidateDoneAttempt(id);
}

// X1/Z1: the Done flow's sibling to the evaluation completion handling above — see its comments for the
// full reasoning (the same cross-renderer race, the same fixed-`id` collapse of "own the data" and "own the
// modal", the same single `subscribeCompletions` seam). The Done flow has no verdict to show, so this handler's only job is
// closing the form and refreshing care/history/the plant's own profile — a REPOT completion writes
// potSizeCm/soilMix and derives a new lastRepottedOn, fields this page renders off
// plant.value.profile/derived, so refreshPlant() runs here too, unlike the evaluation handler above which
// never touches the profile.
async function handleDoneCompletion(completion: RepotCompletion<void>) {
  const isOwnPlant = completion.plantId === id;
  if (isOwnPlant) {
    doneFormOpen.value = false;
    // A3 (spec §2.3): a genuinely recorded repot answers the affordance's own question — the substrate
    // clock now has the date it needed — so the affordance disappears here, same as the explicit dismiss.
    soilChangePending.value = false;
    await Promise.all([refresh(), refreshHistory(), refreshPlant()]);
  }
}

subscribeDoneCompletions(
  (completion) => { void handleDoneCompletion(completion); },
  // R12-1 / R13-2: a GAP — more completions landed than the shared log retains before this renderer handled
  // them, so records it needed no longer exist to be replayed. The likeliest cause is being blocked in its
  // own async setup, but the detector only compares this reader's cursor against the trim point and does not
  // distinguish that case from any other way of falling behind. Either way it cannot know WHICH plants it
  // missed, so the only safe response is to reconcile everything it renders, unconditionally.
  () => { void Promise.all([refresh(), refreshHistory(), refreshPlant()]); },
);

// A REPOT postpone after a verdict is "yes, it needs it, but I can't right now" — the outcome is already
// known, so no picker is needed. Sends the evaluationId when one is pending so the server resolves the
// same verdict row instead of leaving it open.
async function onRepotPostpone() {
  if (repotPostponeSubmitting.value) return; // in-flight guard: no key/modal to gate this action the way
  // the two flows above are gated, so a double-click without this would fire two POSTs carrying the SAME
  // evaluationId — the second 400s ("already-resolved") with no visible feedback.
  repotPostponeSubmitting.value = true;
  repotError.value = false;
  try {
    // Same helper as the Done path above, for the same reason — one rule about which pending row an action
    // may name, stated once. A REPOT Postpone is only ever offered once a `REPOT` verdict is pending, so
    // this is behaviour-preserving here; it is the drift it prevents that earns it.
    const evaluationId = resolvableEvaluationId(pendingRepotEvaluation.value);
    await api.sendFeedback(id, {
      task: 'REPOT',
      type: 'POSTPONED',
      occurredOn: today(),
      reason: 'needed-cannot-now',
      ...(evaluationId ? { payload: { evaluationId } } : {}),
    });
    await refresh();
  } catch (e) {
    repotError.value = true;
    // FIX C: classify the same way the two attempt-backed flows do — see `repotPostponeFailure`'s own
    // comment above.
    repotPostponeFailure.value = classifyRepotFailure(e);
  } finally {
    repotPostponeSubmitting.value = false;
  }
}

// A WATER done on a not-yet-due task (status 'upcoming') is an early watering → ask why. A REPOT done opens
// the completion form — reachable EITHER once a 'REPOT' verdict is pending (both surfaces) OR standalone on
// this page, where the card offers Done beside "time to evaluate" (`allow-standalone-done`, owner request
// 2026-08-07). Any other done sends immediately. The card's own back-date input travels with it: for a
// REPOT it is held until the form is confirmed, because the request is assembled there.
function onDone(task: TaskCode, status: 'overdue' | 'today' | 'upcoming', occurredOn?: string) {
  if (task === 'WATER' && status === 'upcoming') {
    pending.value = { task, type: 'DONE', occurredOn };
    earlyPickerOpen.value = true;
    return;
  }
  if (task === 'REPOT') {
    return onRepotDone(occurredOn);
  }
  return sendDone(task, occurredOn);
}

// Postpone: WATER asks why; a REPOT postpone (only reachable once a verdict is pending) sends immediately
// with the fixed "needed, can't right now" reason; every other task sends immediately (unchanged).
function onPostpone(task: TaskCode) {
  if (task === 'WATER') {
    pending.value = { task, type: 'POSTPONED' };
    postponePickerOpen.value = true;
    return;
  }
  if (task === 'REPOT') {
    return onRepotPostpone();
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
      :clickable="!!plant.coverImageUrl"
      :open-label="$t('plantPhoto.view', { name: plantTitle(plant, locale) })"
      :class="['mp-detail__hero', frozenPhotoModifierClass]"
      @open="openCoverLightbox"
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

          <!-- Only the postpone flow (no modal of its own) relies on this page-level banner; the evaluation
               and done-form flows surface the SAME message inside their own modal body — see the repotError
               comment above. -->
          <UiAlert
            v-if="repotError && !evaluationOpen && !doneFormOpen"
            color="red"
            :description="$t(evaluationLoadFailed ? 'repotEval.loadError' : repotFailureMessageKey(repotPostponeFailure))"
            announce
            class="mp-detail__repot-error"
          >
            <UiButton v-if="evaluationLoadFailed" size="sm" variant="soft" color="neutral" @click="retryEvaluate">
              {{ $t('repotEval.retry') }}
            </UiButton>
          </UiAlert>

          <UiSectionTitle>{{ $t('plantDetail.care') }}</UiSectionTitle>

          <!-- A frozen plant's care payload always carries tasks:[] (no recompute), so this empty state is
               what renders — the `isFrozen` clause defends the case defensively too, never trusting a
               single source for a read-only guarantee. -->
          <UiCard v-if="!care || !care.tasks.length || isFrozen" padded>
            <UiEmptyState>{{ $t('plantDetail.careEmpty') }}</UiEmptyState>
          </UiCard>
          <UiCard v-else :padded="false">
            <div class="mp-detail__rows">
              <!-- `allow-standalone-done` is REPOT-only (inert on every other task): this page keeps a
                   standalone "Done" beside "Time to evaluate", so a repot the owner already did can be
                   recorded — and back-dated, via `with-done-date` — without first answering a
                   questionnaire about a plant that is already in its new pot. The Today page deliberately
                   does NOT pass it: there, Done appears only once a verdict has said the repot is needed. -->
              <UiTaskRow
                v-for="t3 in care.tasks"
                :key="t3.task"
                :id="t3.task === 'REPOT' ? 'repot' : undefined"
                :task="t3.task"
                :status="t3.status"
                :due-label="dueLabelLong(careDueState(t3))"
                :explanation="taskExplanation(t3.task)"
                :pending-verdict="t3.pendingEvaluation?.verdict ?? null"
                :pending-reevaluate-on="t3.pendingEvaluation?.reevaluateOn ?? null"
                :suggest-measuring="t3.task === 'WATER' ? (care.measurement?.suggestMeasuring ?? false) : undefined"
                with-done-date
                show-info
                allow-standalone-done
                @done="e => onDone(e.task, t3.status, e.occurredOn)"
                @postpone="e => onPostpone(e.task)"
                @info="openTaskInfo"
                @log-progress="openProgress"
                @evaluate="onEvaluate"
                @measure="readingModalOpen = true"
              />
            </div>
          </UiCard>

          <!-- The two measurement findings (measured:22, spec §4.8). The too-slow finding is a
               SUBSTRATE/POT finding, not a watering one — it links to the repot card (`#repot`, the REPOT
               row's own id, above), never to the watering cadence. The flat-series finding names the
               INSTRUMENT, never the soil. Mutually exclusive: a flat series makes drying-rate confidence
               meaningless, so it takes priority when both would otherwise apply. -->
          <UiAlert
            v-if="care?.measurement?.tooSlowDrying"
            color="amber"
            :description="$t('reading.finding.tooSlow')"
            class="mp-detail__alert"
          >
            <NuxtLink :to="`/plants/${id}#repot`">{{ $t('reading.finding.tooSlowLink') }}</NuxtLink>
          </UiAlert>
          <UiAlert
            v-else-if="care?.measurement?.flatSeries"
            color="amber"
            :description="$t('reading.finding.flatSeries')"
            class="mp-detail__alert"
          />
        </div>

        <UiSoilReadingModal
          v-model:open="readingModalOpen"
          :plant-id="id"
          :data="readings ?? { instruments: [], protocol: null, readings: [] }"
          @saved="onReadingSaved"
        />

        <!-- The care plan is based on -->
        <div>
          <UiSectionTitle>{{ $t('careBasis.title') }}</UiSectionTitle>

          <!-- A3 (spec §2.3) — persistent affordance: saving a soil-mix change already updated the WATERING
               model, but the fertilize clock still needs the day the substrate was actually changed. Stays
               visible after a dismissed/closed repot form (dismissing the modal does not answer the
               question); disappears only on an explicit "Not now" or once a repot is genuinely recorded
               (handleDoneCompletion above). -->
          <UiAlert
            v-if="soilChangePending"
            color="amber"
            class="mp-detail__alert"
            :title="$t('soilMixChanged.title')"
            :description="$t('soilMixChanged.body')"
          >
            <UiButton size="xs" color="primary" @click="onRepotDone(undefined)">
              {{ $t('soilMixChanged.action') }}
            </UiButton>
            <UiButton size="xs" variant="ghost" color="neutral" @click="soilChangePending = false">
              {{ $t('soilMixChanged.dismiss') }}
            </UiButton>
          </UiAlert>

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
    <UiImageLightbox v-model="coverLightboxOpen" :images="coverLightboxImages" />
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
    <UiRepotEvaluationModal
      v-model:open="evaluationOpen"
      :signs="evaluationSigns"
      :typical-interval-months="evaluationTypicalIntervalMonths"
      :submitting="!!evaluationAttempt?.submitting"
      :error="evaluationAttempt?.error ? $t(repotFailureMessageKey(evaluationAttempt.error)) : null"
      :frozen="isAttemptFrozen(evaluationAttempt)"
      :frozen-answers="evaluationAttempt?.body ?? null"
      @submit="onEvaluationSubmit"
      @start-over="onEvaluationStartOver"
      @reload-signs="onEvaluate()"
    />
    <!-- `signs` is the SAME catalogue the questionnaire was answered against (fetched once by
         `onEvaluate`), never a second fetch — the modal only subtracts the ticked ids from it to name one
         sign worth going to check. -->
    <UiRepotVerdictModal
      v-model:open="verdictOpen"
      :result="verdict"
      :answer="verdictAnswer"
      :signs="evaluationSigns"
      :checked-sign-ids="verdictCheckedSignIds"
    />
    <UiRepotDoneForm
      v-model:open="doneFormOpen"
      :current-pot-size-cm="doneFormProfile.potSizeCm"
      :current-soil-mix="doneFormProfile.soilMix"
      :submitting="!!doneAttempt?.submitting"
      :error="doneAttempt?.error ? $t(repotFailureMessageKey(doneAttempt.error)) : null"
      :frozen="isAttemptFrozen(doneAttempt)"
      :frozen-snapshot="doneAttempt?.body ?? null"
      :seed-occurred-on="doneFormOccurredOn || undefined"
      @confirm="onRepotDoneConfirm"
      @start-over="onRepotDoneStartOver"
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

.mp-detail__repot-error {
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
