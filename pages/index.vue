<script setup lang="ts">
import { groupByPlant, dueState, type DueTask } from '../utils/tasks.js';
import { todayYmd, addDaysYmd } from '../utils/localDate.js';
import { plantTitle } from '../utils/displayName.js';
// One implementation of "which pending evaluation may an action name" and of "which sign is worth
// suggesting next", shared with PlantDetail.vue — never a second copy in each renderer.
import { resolvableEvaluationId, checkedSignIdsFrom } from '../utils/repotEvaluation.js';
// Explicit import (like PlantDetail.vue's `onUnmounted`, and for the same reason): the composable's own
// `shallowRef` import from 'vue' makes it test-environment-agnostic, and this ONE implementation is now
// shared with PlantDetail.vue (round-5 finding V1) — never a second copy of the attempt-tracking logic.
import {
  useRepotAttempt, classifyRepotFailure, repotFailureMessageKey, isAttemptFrozen,
  type RepotCompletion, type RepotAttemptFailure,
} from '../composables/useRepotAttempt';
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
// FIX D3 — the signs catalogue carries the PLANT IT BELONGS TO, and every reader looks it up BY PLANT.
// This ONE modal instance serves every card on the page, so a bare page-level `evaluationSigns` ref was a
// value whose owner was implicit: `onEvaluate` moves `evaluationPlantId` to the new plant BEFORE fetching,
// and a FAILED fetch returns without touching the catalogue — leaving the id naming plant B while the list
// still held plant A's rows. The verdict modal ranks a corroborating sign out of that list, and sign ids
// are species-namespaced, so the already-ticked subtraction would remove nothing and the suggestion could
// name a sign from the WRONG SPECIES. No click sequence reaching it was found (the modal blocks the cards
// while a submit is in flight), so this is hardening, not a caught defect — but the guard-free shape costs
// nothing: `signsFor(plantId)` cannot return another plant's catalogue, because it compares before it
// returns. `typicalIntervalMonths` travels in the same record for the same reason — it came from the same
// one fetch and is just as plant-specific.
const evaluationCatalogue = ref<{ plantId: string; signs: RepotSign[]; typicalIntervalMonths: number | null } | null>(null);
function signsFor(plantId: string | null): RepotSign[] {
  return plantId && evaluationCatalogue.value?.plantId === plantId ? evaluationCatalogue.value.signs : [];
}
const evaluationPlantId = ref<string | null>(null);
// What the QUESTIONNAIRE renders: the catalogue of whichever plant the shared modal is currently showing,
// or nothing at all if the only catalogue on hand belongs to a different plant.
const evaluationSigns = computed(() => signsFor(evaluationPlantId.value));
// Informative-only context for the questionnaire (how often this species is typically repotted) — sourced
// from the SAME `GET /plants/:id/repot-signs` call as the signs above, never a second fetch, and gated on
// the same plant match for the same reason.
const evaluationTypicalIntervalMonths = computed(() =>
  evaluationCatalogue.value?.plantId === evaluationPlantId.value ? evaluationCatalogue.value.typicalIntervalMonths : null,
);
// What the VERDICT modal renders — snapshotted from the completion's OWN plant when the completion is
// handled (see `handleEvaluationCompletion`), never re-read from the live page state afterwards. The
// verdict's other three inputs (`verdict`, `verdictAnswer`, `verdictCheckedSignIds`) all come from that one
// completion record; this makes the fourth come from there too, so all four describe one plant by
// construction rather than by timing.
const verdictSigns = ref<RepotSign[]>([]);
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
  subscribeCompletions: subscribeEvaluationCompletions,
  begin: beginEvaluationAttempt,
  isLive: isLiveEvaluationAttempt,
  resolveSuccess: resolveEvaluationSuccess,
  resolveFailure: resolveEvaluationFailure,
  invalidate: invalidateEvaluationAttempt,
  hasResumableKeyFor: hasResumableEvaluationKeyFor,
} = useRepotAttempt<RepotEvaluationSubmit, RepotEvaluationResult>('evaluation');
const evaluationAttempt = computed(() => evaluationAttemptFor(evaluationPlantId.value));
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
// them from `verdictSigns` to find the strongest sign the owner has NOT reported. Kept as its own ref
// rather than widening `verdictAnswer` into the whole body, so the existing prop's meaning is untouched.
const verdictCheckedSignIds = ref<string[]>([]);
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
// FIX C: `onRepotPostpone` has no attempt/key of its own (no modal, no retry — see its own comment), so it
// cannot classify its failure through `useRepotAttempt.ts`'s per-attempt `error` field the way the
// evaluation submit and Done confirm now do. This ref carries the SAME classification for the postpone
// banner's own non-loader branch, so that branch stops hardcoding `repotEval.errorPending` and instead
// reports what the server actually said (a 400 reads differently from a 409/network failure here too).
const repotPostponeFailure = ref<RepotAttemptFailure>('unknown');

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
  subscribeCompletions: subscribeDoneCompletions,
  begin: beginDoneAttempt,
  isLive: isLiveDoneAttempt,
  resolveSuccess: resolveDoneSuccess,
  resolveFailure: resolveDoneFailure,
  invalidate: invalidateDoneAttempt,
  hasResumableKeyFor: hasResumableDoneKeyFor,
} = useRepotAttempt<{ occurredOn: string; payload: RepotDonePayload }>('done');
const doneAttempt = computed(() => doneAttemptFor(doneFormPlantId.value));
const repotPostponeSubmitting = ref(false);

// Every REPOT mutating flow can genuinely fail — the state a card was built from can go stale between
// render and click (another tab resolves the same evaluation, a slow refresh races a second click): a
// 409 when an unresolved verdict already changed underneath the request, a 400 when the request's VALUES
// were rejected outright (e.g. a decimal/over-max pot size), or a 422 when a retried submission's body no
// longer matches what the idempotency layer stored. FIX C: these are no longer collapsed into one message —
// `classifyRepotFailure`/`repotFailureMessageKey` (useRepotAttempt.ts) tell them apart, because a 400 means
// nothing committed and the owner can correct the input, while a 409/422 genuinely needs "reload / start
// over" (code review originally found `repotEval.errorPending` shipped-but-unused, which is what surfaced
// that these 3 flows had NO catch at all — an unhandled rejection that silently did nothing on failure).
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
  const resuming = hasResumableEvaluationKeyFor(plantId);
  evaluationPlantId.value = plantId;
  if (!resuming) {
    repotError.value = false;
  }
  evaluationLoadFailed.value = false;
  repotRetry.value = () => onEvaluate(plantId);
  let signs: RepotSign[];
  let typicalIntervalMonths: number | null;
  try {
    const result = await api.getRepotSigns(plantId);
    signs = result.signs;
    typicalIntervalMonths = result.typicalIntervalMonths;
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
  // this fetch was in flight, `evaluationPlantId` has already moved on — opening THIS plant's modal now
  // would show its questionnaire under the wrong plant's card. (FIX D3: the catalogue itself is stored with
  // its own plantId below, so a mismatch can no longer misattribute the LIST even if this guard is passed —
  // this guard now only governs whether the modal opens, which is the one thing a stored key cannot answer.)
  if (evaluationPlantId.value !== plantId) return;
  // FIX D3: the catalogue is stored WITH the plant it was fetched for, so nothing downstream has to
  // remember which plant it belongs to.
  evaluationCatalogue.value = { plantId, signs, typicalIntervalMonths };
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
    // X1: `resolveEvaluationSuccess` is the ONLY place that clears the attempt AND publishes the flow's
    // completion signal (naming this plant + the verdict) — it already no-ops both (clears nothing,
    // publishes nothing) when `attempt` is no longer live, so there is no separate staleness check to
    // duplicate here any more (the old `isLiveEvaluationAttempt` guard this replaced governed exactly that).
    // Closing the modal, showing the verdict, and refreshing the today list are handled EXCLUSIVELY by the
    // completion watcher below — see its own comment for why that is the SINGLE owner of that effect, on
    // both this renderer and PlantDetail.vue, so neither one can double-handle its own completion.
    resolveEvaluationSuccess(attempt, result);
  } catch (e) {
    if (!isLiveEvaluationAttempt(attempt)) return;
    // Key AND stored body deliberately kept (not cleared) on failure: a lost-response retry must reuse
    // both, per the stable-idempotency-key rule and U2's whole-envelope freeze. The modal stays open so the
    // owner can see the error and retry the SAME submission rather than silently losing it. The modal
    // freezes its inputs for as long as `isAttemptFrozen(evaluationAttempt)` says so — true for every
    // failure kind EXCEPT 'invalid' (FIX C) — but the byte-identical retry no longer depends on that alone —
    // `beginEvaluationAttempt` above resends the attempt's STORED body regardless of what the (frozen) form
    // would recompute.
    // W2/FIX C1: no shared-UI guard needed to surface the error any more — `resolveEvaluationFailure` sets
    // `error` (the classified FAILURE KIND, never a bare boolean) on THIS plant's own attempt entry, and
    // `evaluationAttempt` (the computed the template reads) already only ever reflects whichever plant
    // `evaluationPlantId` currently names. There is no shared flag left for a stale response to write into,
    // so a late failure for a plant the owner has moved on from simply updates that plant's own
    // (currently unwatched) entry and nothing else.
    resolveEvaluationFailure(attempt, classifyRepotFailure(e));
  }
}

// Explicit escape hatch (code review finding W17): abandons the outstanding key so the form unfreezes and
// a later submit mints a fresh one, instead of forcing a page reload to get out of a stuck retry.
function onEvaluationStartOver() {
  if (evaluationPlantId.value) invalidateEvaluationAttempt(evaluationPlantId.value);
}

// X1: the flow's TERMINAL OUTCOME, shared across renderers via `useRepotAttempt.ts`'s module-scope
// `completion` signal — published by `resolveEvaluationSuccess` the instant a LIVE submit succeeds,
// regardless of which renderer's own request produced it. Both this page and PlantDetail.vue consume the SAME
// per-flow completion log (R11-1), so a submit confirmed here, whose response only settles after the owner has navigated to the
// plant's detail page, still closes THAT page's own modal and refreshes ITS OWN data — the race X1 exists to
// close (a departed page's promise keeps running after navigation). `invalidate()` (the "start over" escape
// hatch) never publishes a completion, so abandoning an attempt can never be mistaken for completing one
// here.
//
// Z1: refreshing the Today list is NEVER gated on modal ownership. `resolveEvaluationSuccess` has already
// deleted the completed plant's attempt by the time this runs, whether or not that plant is the one the ONE
// shared modal currently shows — an early return here used to skip `refresh()` too, leaving a plant the
// owner isn't currently looking at stale with its attempt gone: its own card's next click minted a FRESH key
// and could duplicate the already-recorded repot. `refresh()` below runs unconditionally, exactly like the
// pre-wave-9 code did, for exactly that reason. Only the modal-owning actions — closing the modal, showing
// the verdict — stay conditional on `completion.plantId` still matching `evaluationPlantId`, the plant the
// shared modal is CURRENTLY showing.
//
// R11-1: this handler is registered through `subscribeCompletions`, which owns BOTH the backlog published
// during this page's own async setup and every later record, draining them oldest-first through this ONE
// function. The renderer no longer states a baseline, a catch-up or a watcher — those lived here as four
// hand-written copies across two files, and round 10 found two of them had already diverged on whether the
// refresh was gated. There is nothing left here for a future edit to get out of step.
async function handleEvaluationCompletion(completion: RepotCompletion<RepotEvaluationResult, RepotEvaluationSubmit>) {
  const isCurrentModal = completion.plantId === evaluationPlantId.value;
  if (isCurrentModal) {
    evaluationOpen.value = false;
    verdict.value = completion.result;
    verdictAnswer.value = completion.body.answer;
    verdictCheckedSignIds.value = checkedSignIdsFrom(completion.body);
    // FIX D3: the catalogue is looked up by the COMPLETION's own plant, not read off whatever the page-level
    // ref happens to hold — so the four things the verdict modal renders all describe one plant by
    // construction. An empty list simply produces no corroborating suggestion, which is a complete answer.
    verdictSigns.value = signsFor(completion.plantId);
    verdictOpen.value = true;
  }
  await refresh();
}

subscribeEvaluationCompletions(
  (completion) => { void handleEvaluationCompletion(completion); },
  // R12-1 / R13-2: a GAP — more completions landed than the shared log retains before this renderer handled
  // them, so records it needed no longer exist to be replayed. The likeliest cause is being blocked in its
  // own async setup, but the detector only compares this reader's cursor against the trim point and does not
  // distinguish that case from any other way of falling behind. Either way it cannot know WHICH plants it
  // missed, so the only safe response is to reconcile everything it renders, unconditionally.
  () => { void refresh(); },
);

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
  //
  // FIX D1 — the SAME predicate `beginDoneAttempt` uses (`hasResumableKeyFor`), never the weaker "is a key
  // outstanding?". After a 400 the key is still in the store but `begin()` will NOT resume it (FIX C2), so
  // the reopen must take the FRESH path and re-read the prefill the next confirm will actually send.
  // On THIS renderer the symptom PlantDetail.vue suffered is currently unreachable — Today's card has no
  // back-date input and `occurredOn` is a module-level constant here — so the change is a sweep, not a bug
  // fix: the twin renderers have drifted on this flow five times already, and leaving one of them reading a
  // predicate that disagrees with `begin()` is one feature away from mattering. What it does change today:
  // a reopen after a 400 re-fetches the profile prefill, which is correct — a 400 committed nothing, so
  // there is no frozen envelope for the prefill to stay byte-identical to.
  const resuming = hasResumableDoneKeyFor(plantId);
  doneFormPlantId.value = plantId;
  if (resuming) {
    // A genuine resume: the frozen body must stay byte-identical to the one the outstanding key was minted
    // for — no error clear, and no re-read of the profile prefill. Just reopen the form.
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
  //
  // `resolvableEvaluationId` (utils/repotEvaluation.ts) rather than a bare `pendingEval.id`: the server
  // resolves an `evaluationId` only when it names an unresolved `REPOT` verdict, and refuses anything else
  // with a 400. Today's card only ever offers Done once such a verdict is pending, so this is
  // behaviour-preserving HERE — it is the sibling renderer (PlantDetail.vue, which now offers a standalone
  // Done while a RE-EVALUATE row may be the pending one) that needs the rule, and stating it once is what
  // stops these two files drifting on it for the fifth time.
  const evaluationId = resolvableEvaluationId(pendingEvaluationFor(plantId)); // off the today list the page already holds
  // W2: no page-level `repotError.value = false` here any more — same reasoning as onEvaluationSubmit above
  // — `beginDoneAttempt` resets THIS attempt's own `error` field the moment a confirm (fresh or retry) begins.
  const attempt = beginDoneAttempt(plantId, {
    occurredOn: today,
    payload: { ...payload, ...(evaluationId ? { evaluationId } : {}) },
  });
  try {
    await api.completeRepot(plantId, attempt.body.occurredOn, attempt.body.payload, attempt.key);
    // X1: same reasoning as onEvaluationSubmit's identical comment above — `resolveDoneSuccess` is the ONLY
    // place that clears the attempt AND publishes the completion signal (the Done flow has no verdict to
    // carry, so its completion names only the plant), and it already no-ops both when `attempt` is no longer
    // live. Closing the form and refreshing the today list are the completion watcher's job alone, below.
    resolveDoneSuccess(attempt);
  } catch (e) {
    if (!isLiveDoneAttempt(attempt)) return;
    // Key AND stored envelope deliberately kept on failure, same reasoning as onEvaluationSubmit. W2/FIX C1:
    // no shared-UI guard needed to surface the error any more — `resolveDoneFailure` sets `error` (the
    // classified FAILURE KIND) on THIS plant's own attempt entry, and `doneAttempt` already only ever
    // reflects whichever plant `doneFormPlantId` currently names — there is no shared flag left for a stale
    // response to write into.
    resolveDoneFailure(attempt, classifyRepotFailure(e));
  }
}

// Explicit escape hatch for the Done form (code review finding Y2, mirrors onEvaluationStartOver above):
// abandons the outstanding attempt so the form unfreezes and a later confirm mints a fresh one.
function onRepotDoneStartOver() {
  if (doneFormPlantId.value) invalidateDoneAttempt(doneFormPlantId.value);
}

// X1/Z1: the Done flow's sibling to the evaluation completion handling above — see its comments for the
// full reasoning (the same cross-renderer race, the same unconditional-refresh rule, the same single
// `subscribeCompletions` seam). The Done flow has no verdict to show, so this handler's only job is closing the form; refreshing
// the today list stays unconditional regardless of which plant's form is currently open.
async function handleDoneCompletion(completion: RepotCompletion<void>) {
  const isCurrentModal = completion.plantId === doneFormPlantId.value;
  if (isCurrentModal) {
    doneFormOpen.value = false;
  }
  await refresh();
}

subscribeDoneCompletions(
  (completion) => { void handleDoneCompletion(completion); },
  // R12-1 / R13-2: a GAP — more completions landed than the shared log retains before this renderer handled
  // them, so records it needed no longer exist to be replayed. The likeliest cause is being blocked in its
  // own async setup, but the detector only compares this reader's cursor against the trim point and does not
  // distinguish that case from any other way of falling behind. Either way it cannot know WHICH plants it
  // missed, so the only safe response is to reconcile everything it renders, unconditionally.
  () => { void refresh(); },
);

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
    // Same helper as the Done path above, for the same reason — one rule about which pending row an action
    // may name, stated once (utils/repotEvaluation.ts). Behaviour-preserving here: a REPOT Postpone is only
    // ever offered once a `REPOT` verdict is pending.
    const evaluationId = resolvableEvaluationId(pendingEvaluationFor(plantId));
    await api.sendFeedback(plantId, {
      task: 'REPOT',
      type: 'POSTPONED',
      occurredOn: today,
      reason: 'needed-cannot-now',
      ...(evaluationId ? { payload: { evaluationId } } : {}),
    });
    await refresh();
  } catch (e) {
    repotError.value = true;
    // FIX C: classify the same way the two attempt-backed flows do, so the banner's message reflects what
    // the server actually said (see `repotPostponeFailure`'s own comment above) instead of a hardcoded
    // 'errorPending' string.
    repotPostponeFailure.value = classifyRepotFailure(e);
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
      :description="$t(evaluationLoadFailed ? 'repotEval.loadError' : repotFailureMessageKey(repotPostponeFailure))"
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
      :typical-interval-months="evaluationTypicalIntervalMonths"
      :submitting="!!evaluationAttempt?.submitting"
      :error="evaluationAttempt?.error ? $t(repotFailureMessageKey(evaluationAttempt.error)) : null"
      :frozen="isAttemptFrozen(evaluationAttempt)"
      :frozen-answers="evaluationAttempt?.body ?? null"
      @submit="onEvaluationSubmit"
      @start-over="onEvaluationStartOver"
      @reload-signs="evaluationPlantId && onEvaluate(evaluationPlantId)"
    />
    <!-- `signs` is the SAME catalogue the questionnaire was answered against (fetched once by
         `onEvaluate`), never a second fetch — the modal only subtracts the ticked ids from it to name one
         sign worth going to check. FIX D3: it is `verdictSigns`, snapshotted from the COMPLETION's own
         plant, not the live page-level catalogue — see its declaration. -->
    <UiRepotVerdictModal
      v-model:open="verdictOpen"
      :result="verdict"
      :answer="verdictAnswer"
      :signs="verdictSigns"
      :checked-sign-ids="verdictCheckedSignIds"
    />
    <UiRepotDoneForm
      v-model:open="doneFormOpen"
      :current-pot-size-cm="doneFormProfile.potSizeCm"
      :current-soil-mix="doneFormProfile.soilMix"
      :submitting="!!doneAttempt?.submitting"
      :error="doneAttempt?.error ? $t(repotFailureMessageKey(doneAttempt.error)) : null"
      :frozen="isAttemptFrozen(doneAttempt)"
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
