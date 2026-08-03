<script setup lang="ts">
import { groupByPlant, dueState, type DueTask } from '../utils/tasks.js';
import { todayYmd, addDaysYmd } from '../utils/localDate.js';
import { plantTitle } from '../utils/displayName.js';
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
const evaluationSubmitting = ref(false);
// STABLE per submission: minted lazily on the first attempt, reused verbatim across retries of that same
// submission, and discarded the moment it succeeds or the owner abandons the modal. NEVER content-derived —
// two genuinely separate evaluations of one plant must not collapse into one.
const evaluationKey = ref<string | null>(null);
// The verdict the last evaluation submit returned, shown in its own modal (RepotVerdictModal.vue).
const verdict = ref<RepotEvaluationResult | null>(null);
const verdictOpen = ref(false);

// REPOT is also the one task whose completion physically replaces the medium (Spec 1 §6/Task 21), so its
// Done path opens a small pre-filled form (RepotDoneForm.vue, Task 26) instead of posting directly.
const doneFormOpen = ref(false);
const doneFormPlantId = ref<string | null>(null);
const doneFormProfile = ref<{ potSizeCm: number | null; soilMix: string | null }>({ potSizeCm: null, soilMix: null });
const doneFormSubmitting = ref(false);
// Same stable-key discipline as evaluationKey.
const doneKey = ref<string | null>(null);
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
// opens; an empty list simply renders no signs rather than blocking the picker.
async function onEvaluate(plantId: string) {
  evaluationPlantId.value = plantId;
  evaluationKey.value = null;
  repotError.value = false;
  const signs = await api.getRepotSigns(plantId).then((r) => r.signs).catch(() => []);
  // Race guard (code review finding F4): if the owner clicked a DIFFERENT card's evaluate action while
  // this fetch was in flight, `evaluationPlantId` has already moved on — applying this response now would
  // silently show the wrong plant's signs list under the wrong plant's modal.
  if (evaluationPlantId.value !== plantId) return;
  evaluationSigns.value = signs;
  evaluationOpen.value = true;
}

async function onEvaluationSubmit(body: RepotEvaluationSubmit) {
  const plantId = evaluationPlantId.value;
  if (!plantId) return;
  if (!evaluationKey.value) evaluationKey.value = crypto.randomUUID();
  evaluationSubmitting.value = true;
  repotError.value = false;
  try {
    const result = await api.submitRepotEvaluation(plantId, body, evaluationKey.value);
    evaluationKey.value = null; // discarded on success; never reused again
    evaluationOpen.value = false;
    verdict.value = result;
    verdictOpen.value = true;
    await refresh();
  } catch {
    // Key deliberately kept (not cleared) on failure: a lost-response retry must reuse the same key, per
    // the stable-idempotency-key rule. The modal stays open so the owner can see the error and retry the
    // SAME submission rather than silently losing it.
    repotError.value = true;
  } finally {
    evaluationSubmitting.value = false;
  }
}

// Done: opens the completion form, pre-filled with the plant's current profile (only reachable once a
// 'REPOT' verdict is pending — see TaskRow's showEvaluate).
async function onRepotDone(plantId: string) {
  doneFormPlantId.value = plantId;
  doneKey.value = null;
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
  if (!doneKey.value) doneKey.value = crypto.randomUUID();
  doneFormSubmitting.value = true;
  repotError.value = false;
  try {
    const pendingEval = pendingEvaluationFor(plantId); // read off the today list the page already holds
    await api.completeRepot(
      plantId,
      today,
      { ...payload, ...(pendingEval ? { evaluationId: pendingEval.id } : {}) },
      doneKey.value,
    );
    doneKey.value = null; // discarded on success; never reused again
    doneFormOpen.value = false;
    await refresh();
  } catch {
    // Key deliberately kept on failure, same reasoning as onEvaluationSubmit.
    repotError.value = true;
  } finally {
    doneFormSubmitting.value = false;
  }
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
      :description="$t('repotEval.errorPending')"
      announce
      class="mp-today__repot-error"
    />

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
      :submitting="evaluationSubmitting"
      :error="repotError ? $t('repotEval.errorPending') : null"
      @submit="onEvaluationSubmit"
    />
    <UiRepotVerdictModal v-model:open="verdictOpen" :result="verdict" />
    <UiRepotDoneForm
      v-model:open="doneFormOpen"
      :current-pot-size-cm="doneFormProfile.potSizeCm"
      :current-soil-mix="doneFormProfile.soilMix"
      :submitting="doneFormSubmitting"
      :error="repotError ? $t('repotEval.errorPending') : null"
      @confirm="onRepotDoneConfirm"
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
