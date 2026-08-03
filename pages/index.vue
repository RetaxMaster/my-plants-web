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
// The active REPOT-evaluation submit attempts — ONE per plant (U1) — `useRepotAttempt.ts` (round-5 finding
// V1: extracted so PlantDetail.vue, the SECOND renderer of this same flow, can share the identical
// discipline instead of re-deriving it — see that composable's own doc comment for the full race this
// fixes, the per-plant map, and why `shallowRef`, not `ref`, is load-bearing here). `useRepotAttempt` now
// takes a FLOW KEY (W1): `'evaluation'` and PlantDetail.vue's own call with the SAME key resolve to the
// identical MODULE-SCOPE store, so an evaluation attempt started here is still resumable after navigating
// to the plant's detail page, and vice versa. `evaluationAttempt` is a computed reading the entry for
// whichever plant the shared evaluation modal is CURRENTLY showing (`evaluationPlantId`), so switching to a
// different plant's card never discards another plant's entry.
const {
  attemptFor: evaluationAttemptFor,
  begin: beginEvaluationAttempt,
  isLive: isLiveEvaluationAttempt,
  resolveSuccess: resolveEvaluationSuccess,
  resolveFailure: resolveEvaluationFailure,
  invalidate: invalidateEvaluationAttempt,
  hasKeyFor: hasEvaluationKeyFor,
} = useRepotAttempt<RepotEvaluationSubmit>('evaluation');
const evaluationAttempt = computed(() => evaluationAttemptFor(evaluationPlantId.value));
// The verdict the last evaluation submit returned, shown in its own modal (RepotVerdictModal.vue).
const verdict = ref<RepotEvaluationResult | null>(null);
const verdictOpen = ref(false);
// Set when a REPOT loader fails (network/5xx) — either the evaluation signs fetch below, OR (B3) the Done
// form's `api.getPlant` profile fetch — never for a genuinely empty signs catalogue, which is a valid
// outcome and must keep opening the questionnaire. Selects the load-specific message + retry affordance on
// the shared repotError banner below, instead of the generic "already has an answer" text. Shared by BOTH
// loaders on purpose (B3): a second flag with its own template branch would be a parallel copy of the same
// banner for no reason, since only one loader can be in flight at a time from the owner's perspective.
const evaluationLoadFailed = ref(false);
// Holds whichever loader most recently failed, so the banner's retry button re-runs the SAME fetch that
// failed instead of hard-wiring to one specific loader (B3) — set at the start of each loader's fetch,
// re-runnable verbatim.
const repotRetry = ref<(() => void) | null>(null);

// REPOT is also the one task whose completion physically replaces the medium (Spec 1 §6/Task 21), so its
// Done path opens a small pre-filled form (RepotDoneForm.vue, Task 26) instead of posting directly.
const doneFormOpen = ref(false);
const doneFormPlantId = ref<string | null>(null);
const doneFormProfile = ref<{ potSizeCm: number | null; soilMix: string | null }>({ potSizeCm: null, soilMix: null });
// Same per-plant-map discipline as evaluationAttempt above — its OWN `useRepotAttempt()` instance (never
// shared with the evaluation flow's, so a Done confirm and an evaluation submit for the same plant never
// contend for the same attempt object). `TBody` bundles `completeRepot`'s two non-plantId, non-key
// arguments together (U2): `occurredOn` and `evaluationId` are each read fresh at confirm time, but once a
// key is minted for a plant, `beginDoneAttempt` freezes that WHOLE envelope on the attempt and every retry
// resends it verbatim, regardless of what a fresh read would produce.
const {
  attemptFor: doneAttemptFor,
  begin: beginDoneAttempt,
  isLive: isLiveDoneAttempt,
  resolveSuccess: resolveDoneSuccess,
  resolveFailure: resolveDoneFailure,
  invalidate: invalidateDoneAttempt,
  hasKeyFor: hasDoneKeyFor,
} = useRepotAttempt<{ occurredOn: string; payload: RepotDonePayload }>('done');
const doneAttempt = computed(() => doneAttemptFor(doneFormPlantId.value));
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
//
// W2: that `error` prop no longer reads off THIS shared flag for the two mutation flows below — it reads
// off `evaluationAttempt?.error` / `doneAttempt?.error` instead (set by `useRepotAttempt.ts`'s
// `resolveFailure`, keyed by plantId AND by flow). `repotError` stays for exactly two things that genuinely
// HAVE no per-plant attempt of their own: `onRepotPostpone` (no modal, no key, no attempt) and the two
// LOADER failures below (the repot-signs fetch, the Done form's profile prefetch) — both fail BEFORE any
// key is ever minted, so there is no attempt yet to hang the failure off of. Before W2, this flag was ALSO
// set/cleared inside `onEvaluationSubmit`/`onRepotDoneConfirm`, which is exactly how plant B's mutation
// failure could render on plant A's reopened modal (and how a Done failure could render inside the
// evaluation modal): one boolean, shared across every plant AND every flow. The page-level banner below
// stays — it is still the only feedback surface for `onRepotPostpone`, which has no modal at all.
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
  // stored, leaving the owner stuck on the next submit's 422. So a key outstanding for THIS plant is a
  // resume: keep the key AND the prior error untouched (RepotEvaluationModal.vue then keeps its answers
  // frozen across the reopen, and `frozen && error` still surfaces the "start over" escape hatch).
  //
  // U1: `useRepotAttempt` now keys attempts by plantId, so opening a DIFFERENT plant's card here can never
  // touch that other plant's outstanding entry — there is nothing to invalidate when moving on. The old
  // comment here ("switching to a different plant intentionally abandons the previous plant's outstanding
  // attempt … a worse bug than the one this fixes") described the single-slot design this replaces: that
  // trade only existed because there was ONE slot to contend for. It is no longer true, and abandoning
  // another plant's key silently — without the owner ever choosing "start over" — was itself the reachable
  // defect U1 closes (a lost Done-completion response on plant A, discarded the moment plant B's card
  // opened, let a later retry on A mint a fresh key and record a second, non-deduplicated repot).
  const resuming = hasEvaluationKeyFor(plantId);
  evaluationPlantId.value = plantId;
  if (!resuming) {
    repotError.value = false;
  }
  evaluationLoadFailed.value = false;
  repotRetry.value = () => onEvaluate(plantId);
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

async function onEvaluationSubmit(body: RepotEvaluationSubmit) {
  const plantId = evaluationPlantId.value;
  if (!plantId) return;
  // Capture the exact attempt this request belongs to (round-3/adversarial finding Y1): this ONE modal
  // instance serves EVERY plant card on the page, so switching cards while a submit is in flight abandons
  // the request without cancelling it. Its response still arrives later.
  //
  // Two SEPARATE staleness questions apply here, not one (U1 split what the single slot used to answer with
  // a single check):
  //   1. `isLiveEvaluationAttempt` — is this still the live attempt for ITS OWN plant (never superseded by
  //      "start over" or a newer submit for that SAME plant)? This governs the attempt's own bookkeeping
  //      (key/body/submitting) and must always run, regardless of which plant the shared modal is showing —
  //      a plant the owner has since navigated away from still needs its OWN key/retry state kept correct.
  //   2. `evaluationPlantId.value === plantId`, checked separately below — is this plant STILL the one the
  //      ONE shared modal is CURRENTLY displaying? A late response for a plant the owner has moved on from
  //      must never touch the modal, the verdict, or the page-level error banner — only the CURRENT
  //      target's own response may drive that shared UI. `refresh()` is the one exception: it re-reads the
  //      whole Today list, which benefits every card, so it always runs regardless of the current target.
  //
  // U2: `beginEvaluationAttempt` freezes the WHOLE submitted body on the attempt the moment the key is
  // minted, and returns that STORED body (never this freshly-passed one) on a retry — so `attempt.body`,
  // never the `body` parameter, is what actually gets sent below.
  //
  // W2: no page-level `repotError.value = false` here any more — `beginEvaluationAttempt` itself resets
  // THIS attempt's own `error` field the moment a submit (fresh or retry) begins, so there is nothing left
  // to clear on the shared flag, and clearing it here used to also (wrongly) hide an unrelated postpone
  // error for a different plant.
  const attempt = beginEvaluationAttempt(plantId, body);
  try {
    const result = await api.submitRepotEvaluation(plantId, attempt.body, attempt.key);
    // Stale-attempt guard (same class as the signs-fetch race, F4, above): if this plant's OWN key was
    // superseded by "start over" or a newer submit for the SAME plant while this request was in flight, its
    // response belongs to an ABANDONED attempt and must be ignored entirely, never touching this plant's
    // now-active attempt state.
    if (!isLiveEvaluationAttempt(attempt)) return;
    // Clear the WHOLE attempt (key + body + submitting together) here, before `await refresh()` below —
    // never in a deferred `finally` — so a newer attempt started during that refresh can never be clobbered
    // by this one's own bookkeeping once refresh() finally resolves (round-4 finding V1's second failure
    // mode). This always runs for THIS plant, independent of the shared-modal target check below.
    resolveEvaluationSuccess(attempt); // discarded on success; never reused again
    // Shared-UI guard: only touch the ONE shared modal/verdict if it is STILL showing this plant — the owner
    // may have already opened a DIFFERENT plant's card while this request was in flight (U1: that no longer
    // discards this plant's attempt, but it also must not let this late response hijack whatever the modal
    // is showing now).
    if (evaluationPlantId.value === plantId) {
      evaluationOpen.value = false;
      verdict.value = result;
      verdictOpen.value = true;
    }
    await refresh();
  } catch {
    if (!isLiveEvaluationAttempt(attempt)) return;
    // Key AND stored body deliberately kept (not cleared) on failure: a lost-response retry must reuse
    // both, per the stable-idempotency-key rule and U2's whole-envelope freeze. The modal stays open so the
    // owner can see the error and retry the SAME submission rather than silently losing it. The modal also
    // freezes its inputs for as long as this key is outstanding (`:frozen="!!evaluationAttempt?.key"`), but
    // the byte-identical retry no longer depends on that alone — `beginEvaluationAttempt` above resends the
    // attempt's STORED body regardless of what the (frozen) form would recompute.
    // W2: no shared-UI guard needed to surface the error any more — `resolveEvaluationFailure` sets
    // `error: true` on THIS plant's own attempt entry, and `evaluationAttempt` (the computed the template
    // reads) already only ever reflects whichever plant `evaluationPlantId` currently names. There is no
    // shared flag left for a stale response to write into, so a late failure for a plant the owner has
    // moved on from simply updates that plant's own (currently unwatched) entry and nothing else.
    resolveEvaluationFailure(attempt);
  }
}

// Explicit escape hatch (code review finding W17): abandons the outstanding key so the form unfreezes and
// a later submit mints a fresh one, instead of forcing a page reload to get out of a stuck retry.
function onEvaluationStartOver() {
  if (evaluationPlantId.value) invalidateEvaluationAttempt(evaluationPlantId.value);
}

// Done: opens the completion form, pre-filled with the plant's current profile (only reachable once a
// 'REPOT' verdict is pending — see TaskRow's showEvaluate).
async function onRepotDone(plantId: string) {
  // Resume, don't reset (B1 — mirrors onEvaluate's identical guard above). The comment this replaces
  // ("always a fresh attempt, the Done form has no resume path") was false: RepotDoneForm.vue's own
  // `watch(open, ...)` guard deliberately skips the field reset while `frozen`, specifically to support a
  // RESUME after the owner closes the form (X/Escape/backdrop) without resolving an outstanding confirm.
  // Unconditionally invalidating before reopening made that resume guard unreachable — dead code standing
  // in for a live bug: a Done confirm that committed on the server but lost its response kept the key and
  // froze the form; the owner dismissed the modal; the next open discarded the key and re-prefilled; the
  // next confirm then minted a FRESH idempotency key, so the server recorded a SECOND, non-deduplicated
  // completion of a repot it had already recorded.
  //
  // U1: `useRepotAttempt` now keys attempts by plantId, so this check no longer needs to ALSO confirm we're
  // still on the same plant we were last time (`doneFormPlantId.value === plantId`) — a key outstanding for
  // `plantId` is a resume regardless of what the shared form was last showing, because opening a DIFFERENT
  // plant's card never touches this plant's entry in the first place. This runs BEFORE the fallible
  // `api.getPlant` call below (B3, and load-bearing for the ordering): a resume must never depend on a
  // network fetch.
  const resuming = hasDoneKeyFor(plantId);
  doneFormPlantId.value = plantId;
  if (resuming) {
    // The frozen body must stay byte-identical to the one the outstanding key was minted for: no error
    // clear, and no re-read of the profile prefill — just reopen the form.
    doneFormOpen.value = true;
    return;
  }
  repotError.value = false;
  evaluationLoadFailed.value = false;
  repotRetry.value = () => onRepotDone(plantId);
  try {
    const plant = await api.getPlant(plantId);
    // Race guard (code review finding F4): the SAME class as onEvaluate above — a second card click during
    // this fetch must not overwrite the already-moved-on target with this stale response's profile.
    if (doneFormPlantId.value !== plantId) return;
    doneFormProfile.value = { potSizeCm: plant.profile.potSizeCm, soilMix: plant.profile.soilMix };
    doneFormOpen.value = true;
  } catch {
    // B3: this fetch previously had no catch at all, so a 5xx/timeout produced an unhandled rejection — the
    // form never opened, `repotError` stayed false, and the Done button simply looked dead: no error, no
    // retry, no explanation. Reuse the SAME page-level banner + retry mechanism `onEvaluate` above already
    // uses for its own load failure (finding W16) via the shared `evaluationLoadFailed`/`repotRetry` state —
    // never a second banner or a second flag with its own template branch.
    if (doneFormPlantId.value !== plantId) return;
    evaluationLoadFailed.value = true;
    repotError.value = true;
  }
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
  //
  // U2: `occurredOn` and `evaluationId` are each read fresh, right here, on EVERY confirm click — including
  // a retry. That is deliberate: `beginDoneAttempt` freezes the WHOLE envelope on the attempt the moment the
  // key is minted and returns the STORED envelope (never this freshly-built one) on a retry, so recomputing
  // here costs nothing and a retry still resends the byte-identical body the key was minted for — never a
  // NEW `occurredOn` (a midnight rollover between confirms) or a NEW `evaluationId` (an intervening
  // `refresh()` that resolved a different pending evaluation), either of which would 422 forever against the
  // server's idempotency interceptor.
  const pendingEval = pendingEvaluationFor(plantId); // read off the today list the page already holds
  // W2: no page-level `repotError.value = false` here any more — same reasoning as onEvaluationSubmit above
  // — `beginDoneAttempt` resets THIS attempt's own `error` field the moment a confirm (fresh or retry) begins.
  const attempt = beginDoneAttempt(plantId, {
    occurredOn: today,
    payload: { ...payload, ...(pendingEval ? { evaluationId: pendingEval.id } : {}) },
  });
  try {
    await api.completeRepot(plantId, attempt.body.occurredOn, attempt.body.payload, attempt.key);
    // Stale-attempt guard (same class as onEvaluationSubmit's, F4/Y1): if this plant's OWN key was
    // superseded by "start over" or a newer confirm for the SAME plant while this request was in flight, its
    // response belongs to an ABANDONED attempt and must be ignored entirely, never touching this plant's
    // now-active attempt state.
    if (!isLiveDoneAttempt(attempt)) return;
    // Clear the WHOLE attempt (key + body + submitting together) here, before `await refresh()` below —
    // never in a deferred `finally` — so a newer attempt started during that refresh can never be clobbered
    // by this one's own bookkeeping once refresh() finally resolves (round-4 finding V1's second failure
    // mode). This always runs for THIS plant, independent of the shared-form target check below.
    resolveDoneSuccess(attempt); // discarded on success; never reused again
    // Shared-UI guard (same reasoning as onEvaluationSubmit's): only close the ONE shared Done form if it is
    // STILL showing this plant — the owner may have already opened a DIFFERENT plant's Done form while this
    // request was in flight (U1: that no longer discards this plant's attempt, but it also must not let this
    // late response hijack whatever the form is showing now).
    if (doneFormPlantId.value === plantId) {
      doneFormOpen.value = false;
    }
    await refresh();
  } catch {
    if (!isLiveDoneAttempt(attempt)) return;
    // Key AND stored envelope deliberately kept on failure, same reasoning as onEvaluationSubmit. W2: no
    // shared-UI guard needed to surface the error any more — `resolveDoneFailure` sets `error: true` on
    // THIS plant's own attempt entry, and `doneAttempt` already only ever reflects whichever plant
    // `doneFormPlantId` currently names — there is no shared flag left for a stale response to write into.
    resolveDoneFailure(attempt);
  }
}

// Explicit escape hatch for the Done form (code review finding Y2, mirrors onEvaluationStartOver above):
// abandons the outstanding attempt so the form unfreezes and a later confirm mints a fresh one.
function onRepotDoneStartOver() {
  if (doneFormPlantId.value) invalidateDoneAttempt(doneFormPlantId.value);
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
      <UiButton v-if="evaluationLoadFailed" size="sm" variant="soft" color="neutral" @click="repotRetry?.()">
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
      :error="evaluationAttempt?.error ? $t('repotEval.errorPending') : null"
      :frozen="!!evaluationAttempt?.key"
      :frozen-answers="evaluationAttempt?.body ?? null"
      @submit="onEvaluationSubmit"
      @start-over="onEvaluationStartOver"
    />
    <UiRepotVerdictModal v-model:open="verdictOpen" :result="verdict" />
    <UiRepotDoneForm
      v-model:open="doneFormOpen"
      :current-pot-size-cm="doneFormProfile.potSizeCm"
      :current-soil-mix="doneFormProfile.soilMix"
      :submitting="!!doneAttempt?.submitting"
      :error="doneAttempt?.error ? $t('repotEval.errorPending') : null"
      :frozen="!!doneAttempt?.key"
      :frozen-snapshot="doneAttempt?.body.payload ?? null"
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
