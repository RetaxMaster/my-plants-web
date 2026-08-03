<script setup lang="ts">
import { groupByPlant, dueState, type DueTask } from '../utils/tasks.js';
import { todayYmd, addDaysYmd } from '../utils/localDate.js';
import { plantTitle } from '../utils/displayName.js';
// Explicit import (like PlantDetail.vue's `onUnmounted`, and for the same reason): the composable's own
// `shallowRef` import from 'vue' makes it test-environment-agnostic, and this ONE implementation is now
// shared with PlantDetail.vue (round-5 finding V1) — never a second copy of the attempt-tracking logic.
import { useRepotAttempt } from '../composables/useRepotAttempt';
import type {
  Plant, RepotSign, RepotEvaluationSubmit, RepotEvaluationResult, RepotDonePayload, PendingRepotEvaluation,
} from '../types/api.js';

const { t, d, locale } = useI18n();
const { dueLabel } = useTaskMeta();

useHead(() => ({ title: t('meta.today.title') }));
useSeoMeta({ description: () => t('meta.today.description') });
const api = useApi();

const { earlyWaterOptions, postponeOptions } = useFeedbackReasons();

// A WATER action that teaches the schedule opens a reason picker; on confirm we send with the reason.
// Everything else sends immediately with no prompt.
const pending = ref<{ plantId: string; task: DueTask['task']; type: 'DONE' | 'POSTPONED'; occurredOn?: string } | null>(null);
const earlyPickerOpen = ref(false);
const postponePickerOpen = ref(false);

// REPOT is a verdict-driven state machine (Task 27): the card offers "time to evaluate" until an
// evaluation resolves it (RepotEvaluationModal.vue, Task 25), and only a 'REPOT' verdict unlocks the
// classic Done | Postpone — see TaskRow.vue's `showEvaluate`.
const evaluationOpen = ref(false);
const evaluationSigns = ref<RepotSign[]>([]);
const evaluationPlantId = ref<string | null>(null);
// The active REPOT-evaluation submit attempt, or null when none is outstanding — `useRepotAttempt.ts`
// (round-5 finding V1: extracted so PlantDetail.vue, the SECOND renderer of this same flow, can share the
// identical discipline instead of re-deriving it — see that composable's own doc comment for the full
// race this fixes and why `shallowRef`, not `ref`, is load-bearing here).
const {
  attempt: evaluationAttempt,
  begin: beginEvaluationAttempt,
  isLive: isLiveEvaluationAttempt,
  resolveSuccess: resolveEvaluationSuccess,
  resolveFailure: resolveEvaluationFailure,
  invalidate: invalidateEvaluationAttempt,
  hasKeyFor: hasEvaluationKeyFor,
} = useRepotAttempt();
// The verdict the last evaluation submit returned, shown in its own modal (RepotVerdictModal.vue).
const verdict = ref<RepotEvaluationResult | null>(null);
const verdictOpen = ref(false);
// Set only when the SIGNS FETCH itself fails (network/5xx) — never for a genuinely empty catalogue, which
// is a valid outcome and must keep opening the questionnaire. Selects the load-specific message + retry
// affordance on the shared repotError banner below, instead of the generic "already has an answer" text.
const evaluationLoadFailed = ref(false);

// REPOT is also the one task whose completion physically replaces the medium (Spec 1 §6/Task 21), so its
// Done path opens a small pre-filled form (RepotDoneForm.vue, Task 26) instead of posting directly.
const doneFormOpen = ref(false);
const doneFormPlantId = ref<string | null>(null);
const doneFormProfile = ref<{ potSizeCm: number | null; soilMix: string | null }>({ potSizeCm: null, soilMix: null });
// Same single-object attempt discipline as evaluationAttempt above — its OWN `useRepotAttempt()` instance
// (never shared with the evaluation flow's, so a Done confirm and an evaluation submit for the same plant
// never contend for the same attempt object).
const {
  attempt: doneAttempt,
  begin: beginDoneAttempt,
  isLive: isLiveDoneAttempt,
  resolveSuccess: resolveDoneSuccess,
  resolveFailure: resolveDoneFailure,
  invalidate: invalidateDoneAttempt,
} = useRepotAttempt();
const repotPostponeSubmitting = ref(false);

// Every REPOT mutating flow can genuinely fail — the state a card was built from can go stale between
// render and click (another tab resolves the same evaluation, a slow refresh races a second click): a
// 409 when an unresolved verdict already changed underneath the request, a 400 when the evaluationId it
// was holding no longer resolves, or a 422 when a retried submission's body no longer matches what the
// idempotency layer stored. `repotEval.errorPending` already ships in both locales for exactly this
// (code review found it shipped-but-unused, which is what surfaced that these 3 flows had NO catch at
// all — an unhandled rejection that silently did nothing on failure).
//
// Round-2 review (Codex) caught that the FIRST fix shipped this only as a page-level banner: `onEvaluate-
// Submit` and `onRepotDoneConfirm` both deliberately keep their own modal OPEN on failure (see their
// comments below), and `Modal.vue` renders its backdrop through a `<Teleport to="body">` with `position:
// fixed; z-index: 1000` covering the whole viewport — so a banner sitting in the page's ordinary document
// flow renders BEHIND the still-open modal, invisible to the owner. `onRepotPostpone` has no modal, so its
// use of the SAME banner WAS visible, which is exactly why the bug survived a manual check. The actual fix:
// RepotEvaluationModal.vue and RepotDoneForm.vue each take their own optional `error` prop and render it
// via `Alert` INSIDE their own (teleported) body, so it renders above the backdrop instead of behind it.
// The page-level banner below stays — it is still the only feedback surface for `onRepotPostpone`, which
// has no modal at all.
const repotError = ref(false);

const isDesktop = useIsDesktop();
const { data: tasks, refresh } = await useAsyncData('today', () => api.todaysTasks());
// Secondary: only used to label task rows (plant name + place chip + cover photo). Deferred to client so
// "Hoy" renders from ONE SSR read; the helpers below already fall back gracefully while these are null.
const { data: plants } = useLazyAsyncData('plants', () => api.listPlants(), { server: false });
const { data: places } = useLazyAsyncData('places-for-today', () => api.listPlaces(), { server: false });

const plantById = (id: string): Plant | undefined => (plants.value ?? []).find((x) => x.id === id);
const plantName = (id: string): string => {
  const p = plantById(id);
  return p ? plantTitle(p, locale.value) : id;
};
const placeName = (id: string): string => {
  const p = plantById(id);
  if (!p) return '';
  return (places.value ?? []).find((pl) => pl.id === p.placeId)?.name ?? '';
};

const grouped = computed(() => groupByPlant((tasks.value ?? []) as DueTask[]));
const dueCount = computed(() => (tasks.value ?? []).length);

const today = todayYmd();
const dateLabel = computed(() => d(new Date(), 'long'));
const subtitle = computed(() =>
  dueCount.value
    ? `${dateLabel.value} · ${t('today.tasksDue', { n: dueCount.value }, dueCount.value)}`
    : dateLabel.value,
);

function rowStatus(due: string): 'overdue' | 'today' | 'upcoming' {
  const k = dueState(due).kind;
  if (k === 'overdue') return 'overdue';
  if (k === 'today') return 'today';
  return 'upcoming';
}

// The pending REPOT evaluation for a plant, read off the Today list the page already holds — never a
// fresh fetch. Used BOTH to render the card's :pending-verdict (before any click) and to attach the
// evaluationId to a REPOT Done/Postpone that follows a resolved verdict.
function pendingEvaluationFor(plantId: string): PendingRepotEvaluation | null {
  return (tasks.value ?? []).find((entry) => entry.plantId === plantId && entry.task === 'REPOT')?.pendingEvaluation ?? null;
}

async function sendDone(plantId: string, task: DueTask['task'], occurredOn?: string, reason?: string) {
  await api.sendFeedback(plantId, { task, type: 'DONE', occurredOn: occurredOn || today, reason });
  await refresh();
}

async function sendPostpone(plantId: string, task: DueTask['task'], reason?: string) {
  await api.sendFeedback(plantId, { task, type: 'POSTPONED', occurredOn: today, postponeToOn: addDaysYmd(1), reason });
  await refresh();
}

// Evaluate: opens the signs checklist. Fetches the species' repotting signs fresh every time the modal
// opens; an empty SUCCESSFUL list simply renders no signs rather than blocking the picker. A FAILED fetch
// is a different thing entirely and must NOT open the questionnaire (code review finding W16): the
// universal, app-seeded pot-physics rows mean a real success is essentially never empty, so treating a
// dropped request as "no signs" would hand the owner nothing to check and then record their forced
// `not-needed` answer as genuine negative evidence, pushing the repot date out on an infrastructure fault.
async function onEvaluate(plantId: string) {
  // Resume, don't reset (code review finding V12): closing the modal via X/Escape/backdrop routes back
  // here on re-open — the card still shows "evaluate" because no verdict resolved it — and treating that
  // like a fresh attempt threw away the only key able to replay an evaluation the server may already have
  // stored, leaving the owner stuck on the next submit's 422. So a key outstanding for THIS SAME plant is
  // a resume: keep the key AND the prior error untouched (RepotEvaluationModal.vue then keeps its answers
  // frozen across the reopen, and `frozen && error` still surfaces the "start over" escape hatch). A key
  // belongs to one plant's exact submitted body, so switching to a DIFFERENT plant intentionally abandons
  // the previous plant's outstanding attempt rather than carrying a stale key into a new plant's body,
  // which the server would then 422 forever — a worse bug than the one this fixes.
  const resuming = evaluationPlantId.value === plantId && hasEvaluationKeyFor(plantId);
  evaluationPlantId.value = plantId;
  if (!resuming) {
    // Invalidate whatever attempt was previously active — a different plant, or this same plant with no
    // outstanding key — THE MOMENT we move on, rather than hoping its own in-flight request notices it went
    // stale and clears up after itself (round-4 finding V1). Nulling the whole object in one write clears
    // `submitting` too, so a still-true flag from an abandoned attempt can never leak into this fresh one.
    invalidateEvaluationAttempt();
    repotError.value = false;
  }
  evaluationLoadFailed.value = false;
  let signs: RepotSign[];
  try {
    signs = (await api.getRepotSigns(plantId)).signs;
  } catch {
    // Race guard (code review finding F4): only surface the failure if we're still on the plant that
    // triggered it — a later click on a different card already moved evaluationPlantId on.
    if (evaluationPlantId.value === plantId) {
      evaluationLoadFailed.value = true;
      repotError.value = true;
    }
    return;
  }
  // Race guard (code review finding F4): if the owner clicked a DIFFERENT card's evaluate action while
  // this fetch was in flight, `evaluationPlantId` has already moved on — applying this response now would
  // silently show the wrong plant's signs list under the wrong plant's modal.
  if (evaluationPlantId.value !== plantId) return;
  evaluationSigns.value = signs;
  evaluationOpen.value = true;
}

// Retry affordance for the page-level banner when `evaluationLoadFailed` is set — re-runs the exact same
// fetch against the plant that triggered it.
function retryEvaluate() {
  if (evaluationPlantId.value) void onEvaluate(evaluationPlantId.value);
}

async function onEvaluationSubmit(body: RepotEvaluationSubmit) {
  const plantId = evaluationPlantId.value;
  if (!plantId) return;
  // Capture the exact attempt this request belongs to (round-3/adversarial finding Y1): this ONE modal
  // instance serves EVERY plant card on the page, so switching cards while a submit is in flight abandons
  // the request without cancelling it. Its response still arrives later, and `isLiveEvaluationAttempt` (a
  // reference-identity check inside `useRepotAttempt.ts`) is the token that answers "is this still the
  // live attempt?" — a stale attempt's own object was already replaced (by the invalidation in
  // `onEvaluate`, by "start over", or by a newer submit), so it catches that unconditionally, whether the
  // replacement happened before this request even settled or only during its own awaited `refresh()` below
  // (round-4 finding V1).
  const attempt = beginEvaluationAttempt(plantId);
  repotError.value = false;
  try {
    const result = await api.submitRepotEvaluation(plantId, body, attempt.key);
    // Stale-attempt guard (same class as the signs-fetch race, F4, above): if the owner moved on — a
    // different plant's evaluate was clicked, or this plant's key was superseded by "start over" — while
    // this request was in flight, its response belongs to an ABANDONED attempt and must be ignored
    // entirely, never touching the now-active attempt's state.
    if (!isLiveEvaluationAttempt(attempt)) return;
    // Clear the WHOLE attempt (key + submitting together) here, before `await refresh()` below — never in a
    // deferred `finally` — so a newer attempt started during that refresh can never be clobbered by this
    // one's own bookkeeping once refresh() finally resolves (round-4 finding V1's second failure mode).
    resolveEvaluationSuccess(attempt); // discarded on success; never reused again
    evaluationOpen.value = false;
    verdict.value = result;
    verdictOpen.value = true;
    await refresh();
  } catch {
    if (!isLiveEvaluationAttempt(attempt)) return;
    // Key deliberately kept (not cleared) on failure: a lost-response retry must reuse the same key, per
    // the stable-idempotency-key rule. The modal stays open so the owner can see the error and retry the
    // SAME submission rather than silently losing it. The modal freezes its inputs for exactly as long as
    // this key is outstanding (`:frozen="!!evaluationAttempt?.key"`), so the retry recomputes the SAME body
    // — never a same-key/different-body retry, which the server's idempotency interceptor answers 422 forever.
    resolveEvaluationFailure(attempt);
    repotError.value = true;
  }
}

// Explicit escape hatch (code review finding W17): abandons the outstanding key so the form unfreezes and
// a later submit mints a fresh one, instead of forcing a page reload to get out of a stuck retry.
function onEvaluationStartOver() {
  invalidateEvaluationAttempt();
  repotError.value = false;
}

// Done: opens the completion form, pre-filled with the plant's current profile (only reachable once a
// 'REPOT' verdict is pending — see TaskRow's showEvaluate).
async function onRepotDone(plantId: string) {
  doneFormPlantId.value = plantId;
  // Always a fresh attempt (unlike onEvaluate, the Done form has no resume path): this also invalidates any
  // in-flight attempt for whatever plant was previously active, clearing `submitting` in the same write so
  // it can never leak into this freshly-opened form (round-4 finding V1).
  invalidateDoneAttempt();
  repotError.value = false;
  const plant = await api.getPlant(plantId);
  // Race guard (code review finding F4): the SAME class as onEvaluate above — a second card click during
  // this fetch must not overwrite the already-moved-on target with this stale response's profile.
  if (doneFormPlantId.value !== plantId) return;
  doneFormProfile.value = { potSizeCm: plant.profile.potSizeCm, soilMix: plant.profile.soilMix };
  doneFormOpen.value = true;
}

async function onRepotDoneConfirm(payload: Omit<RepotDonePayload, 'evaluationId'>) {
  const plantId = doneFormPlantId.value;
  if (!plantId) return;
  // Capture the exact attempt this request belongs to — the SAME class of race as onEvaluationSubmit above
  // (Y1's sibling defect, ruled in the same pass): this ONE Done form is shared by every plant card, so
  // switching cards while a confirm is in flight abandons the request without cancelling it. Its response
  // still arrives later, and `isLiveDoneAttempt` (a reference-identity check inside `useRepotAttempt.ts`)
  // answers "is this still the live attempt?" unconditionally — whether that got superseded before this
  // request even settled or only during its own awaited `refresh()` below (round-4 finding V1).
  const attempt = beginDoneAttempt(plantId);
  repotError.value = false;
  try {
    const pendingEval = pendingEvaluationFor(plantId); // read off the today list the page already holds
    await api.completeRepot(
      plantId,
      today,
      { ...payload, ...(pendingEval ? { evaluationId: pendingEval.id } : {}) },
      attempt.key,
    );
    // Stale-attempt guard (same class as onEvaluationSubmit's, F4/Y1): if the owner moved on — a different
    // plant's Done form was opened, or this plant's key was superseded by "start over" — while this
    // request was in flight, its response belongs to an ABANDONED attempt and must be ignored entirely,
    // never touching the now-active attempt's state.
    if (!isLiveDoneAttempt(attempt)) return;
    // Clear the WHOLE attempt (key + submitting together) here, before `await refresh()` below — never in a
    // deferred `finally` — so a newer attempt started during that refresh can never be clobbered by this
    // one's own bookkeeping once refresh() finally resolves (round-4 finding V1's second failure mode).
    resolveDoneSuccess(attempt); // discarded on success; never reused again
    doneFormOpen.value = false;
    await refresh();
  } catch {
    if (!isLiveDoneAttempt(attempt)) return;
    // Key deliberately kept on failure, same reasoning as onEvaluationSubmit.
    resolveDoneFailure(attempt);
    repotError.value = true;
  }
}

// Explicit escape hatch for the Done form (code review finding Y2, mirrors onEvaluationStartOver above):
// abandons the outstanding attempt so the form unfreezes and a later confirm mints a fresh one.
function onRepotDoneStartOver() {
  invalidateDoneAttempt();
  repotError.value = false;
}

// A REPOT postpone after a verdict is "yes, it needs it, but I can't right now" — the outcome is already
// known, so no picker is needed. Sends the evaluationId when one is pending so the server resolves the
// same verdict row instead of leaving it open.
async function onRepotPostpone(plantId: string) {
  if (repotPostponeSubmitting.value) return; // in-flight guard (code review finding F3): no key/modal to
  // gate this action the way the two flows above are gated, so a double-click without this would fire two
  // POSTs carrying the SAME evaluationId — the second 400s ("already-resolved") with no visible feedback.
  repotPostponeSubmitting.value = true;
  repotError.value = false;
  try {
    const pendingEval = pendingEvaluationFor(plantId);
    await api.sendFeedback(plantId, {
      task: 'REPOT',
      type: 'POSTPONED',
      occurredOn: today,
      reason: 'needed-cannot-now',
      ...(pendingEval ? { payload: { evaluationId: pendingEval.id } } : {}),
    });
    await refresh();
  } catch {
    repotError.value = true;
  } finally {
    repotPostponeSubmitting.value = false;
  }
}

// Done: a WATER done that is NOT yet due (status 'upcoming') is an EARLY watering → ask why. A REPOT done
// (only reachable once a 'REPOT' verdict is pending) opens the completion form. Any other done sends
// immediately.
function onDone(plantId: string, task: DueTask['task'], status: 'overdue' | 'today' | 'upcoming', occurredOn?: string) {
  if (task === 'WATER' && status === 'upcoming') {
    pending.value = { plantId, task, type: 'DONE', occurredOn };
    earlyPickerOpen.value = true;
    return;
  }
  if (task === 'REPOT') {
    return onRepotDone(plantId);
  }
  return sendDone(plantId, task, occurredOn);
}

// Postpone: WATER asks why; a REPOT postpone (only reachable once a verdict is pending) sends immediately
// with the fixed "needed, can't right now" reason; every other task sends immediately (unchanged).
function onPostpone(plantId: string, task: DueTask['task']) {
  if (task === 'WATER') {
    pending.value = { plantId, task, type: 'POSTPONED' };
    postponePickerOpen.value = true;
    return;
  }
  if (task === 'REPOT') {
    return onRepotPostpone(plantId);
  }
  return sendPostpone(plantId, task);
}

function confirmEarly(reason: string) {
  const p = pending.value;
  pending.value = null;
  if (p) void sendDone(p.plantId, p.task, p.occurredOn, reason);
}

function confirmPostpone(reason: string) {
  const p = pending.value;
  pending.value = null;
  if (p) void sendPostpone(p.plantId, p.task, reason);
}

// "Log progress" opens the full-screen route (/plants/:id/progress); after saving there the user lands
// on the plant detail, so there's no in-place Today refresh to wire here.
function openProgress(plantId: string) {
  return navigateTo(`/plants/${plantId}/progress`);
}
</script>

<template>
  <div>
    <UiScreenHeader :eyebrow="$t('today.eyebrow')" :title="$t('today.title')" :subtitle="subtitle" />

    <!-- Only the postpone flow (no modal of its own) relies on this page-level banner; the evaluation and
         done-form flows now surface the SAME message inside their own modal body — see the repotError
         comment above. -->
    <UiAlert
      v-if="repotError && !evaluationOpen && !doneFormOpen"
      color="red"
      :description="$t(evaluationLoadFailed ? 'repotEval.loadError' : 'repotEval.errorPending')"
      announce
      class="mp-today__repot-error"
    >
      <UiButton v-if="evaluationLoadFailed" size="sm" variant="soft" color="neutral" @click="retryEvaluate">
        {{ $t('repotEval.retry') }}
      </UiButton>
    </UiAlert>

    <UiCard v-if="!grouped.size" padded>
      <UiEmptyState>{{ $t('today.empty') }}</UiEmptyState>
    </UiCard>

    <UiCardGrid v-else :desktop="isDesktop" :min="340" :gap="14">
      <UiCard v-for="[plantId, plantTasks] in grouped" :key="plantId">
        <template #header>
          <NuxtLink :to="`/plants/${plantId}`" class="mp-today__plant">
            <UiPlantPhoto
              :src="plantById(plantId)?.coverImageUrl ?? null"
              :alt="$t('plantPhoto.alt', { name: plantName(plantId) })"
              :height="128"
              class="mp-today__banner"
            >
              <template v-if="placeName(plantId)" #chips>
                <UiPhotoChip icon="map-pin" :label="placeName(plantId)" />
              </template>
            </UiPlantPhoto>
            <div class="mp-today__plant-head">
              <UiPlantAvatar :size="40" />
              <div class="mp-today__plant-info">
                <UiPlantName
                  :title="plants ? plantName(plantId) : ''"
                  :scientific="plantById(plantId)?.speciesScientificName"
                />
                <div v-if="placeName(plantId)" class="mp-today__place">{{ placeName(plantId) }}</div>
              </div>
              <UiAppIcon name="chevron-right" :size="18" color="var(--text-faint)" />
            </div>
          </NuxtLink>
        </template>
        <div class="mp-today__rows">
          <UiTaskRow
            v-for="t2 in plantTasks"
            :key="t2.task"
            :task="t2.task"
            :status="rowStatus(t2.nextDueOn)"
            :due-label="dueLabel(dueState(t2.nextDueOn))"
            :pending-verdict="pendingEvaluationFor(plantId)?.verdict ?? null"
            :pending-reevaluate-on="pendingEvaluationFor(plantId)?.reevaluateOn ?? null"
            @done="e => onDone(plantId, e.task, rowStatus(t2.nextDueOn), e.occurredOn)"
            @postpone="e => onPostpone(plantId, e.task)"
            @log-progress="() => openProgress(plantId)"
            @evaluate="() => onEvaluate(plantId)"
          />
        </div>
      </UiCard>
    </UiCardGrid>

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
      :submitting="!!evaluationAttempt?.submitting"
      :error="repotError ? $t('repotEval.errorPending') : null"
      :frozen="!!evaluationAttempt?.key"
      @submit="onEvaluationSubmit"
      @start-over="onEvaluationStartOver"
    />
    <UiRepotVerdictModal v-model:open="verdictOpen" :result="verdict" />
    <UiRepotDoneForm
      v-model:open="doneFormOpen"
      :current-pot-size-cm="doneFormProfile.potSizeCm"
      :current-soil-mix="doneFormProfile.soilMix"
      :submitting="!!doneAttempt?.submitting"
      :error="repotError ? $t('repotEval.errorPending') : null"
      :frozen="!!doneAttempt?.key"
      @confirm="onRepotDoneConfirm"
      @start-over="onRepotDoneStartOver"
    />
  </div>
</template>

<style scoped>
.mp-today__repot-error {
  margin-bottom: var(--space-4);
}

.mp-today__plant {
  display: block;
  text-decoration: none;
}

.mp-today__banner {
  margin-bottom: var(--space-3);
}

.mp-today__plant-head {
  display: flex;
  align-items: center;
  gap: 12px;
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
