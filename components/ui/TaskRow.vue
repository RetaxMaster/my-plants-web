<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import Badge from './Badge.vue';
import Button from './Button.vue';
import type { TaskCode } from '~/utils/tasks';
import { dueState } from '~/utils/tasks';
// The WATER row's shared rules — the ONE place a measured verdict decides anything, applied identically by
// this component and by both pages. See `effectiveTaskStatus`'s own comment.
import { effectiveTaskStatus, waterDoneWouldBeDiscarded, type TodaysVerdict } from '~/utils/waterSurvey';
import { todayYmd, ymdToLocalDate } from '~/utils/localDate';
import { useTaskMeta } from '~/composables/useTaskMeta';

defineOptions({ inheritAttrs: false });

const { TASK_ICONS, taskLabel } = useTaskMeta();
const { t, d } = useI18n();

const props = withDefaults(
  defineProps<{
    task: TaskCode;
    status: 'overdue' | 'today' | 'upcoming';
    dueLabel: string;
    withDoneDate?: boolean;
    showInfo?: boolean;
    /** Optional one-line "why this date" explanation, rendered under the task label. */
    explanation?: string;
    /**
     * REPOT only, and DELIBERATELY UNDEFAULTED — see `showEvaluate` below. `undefined` (the prop simply
     * omitted by the caller) means that caller has NOT opted into the verdict-driven state machine and
     * gets the classic Done | Postpone unconditionally, exactly as before Task 27 — this is what keeps
     * `PlantDetail.vue`'s own REPOT card working unchanged until Task 28 explicitly wires it in. Only a
     * caller that EXPLICITLY passes `null` (no pending verdict yet) or a verdict string opts in: `null` ->
     * the card shows "time to evaluate"; `'REPOT'` -> the uncertainty is resolved and the classic
     * Done | Postpone returns, now correct: Done means "I repotted it" and Postpone means "yes, but I
     * can't right now".
     */
    pendingVerdict?: 'REPOT' | 'RE-EVALUATE' | null;
    /**
     * ADDITIVE, optional, and only meaningful alongside `pendingVerdict: 'RE-EVALUATE'` — the
     * `reevaluateOn` (YYYY-MM-DD) of that pending evaluation. V13: a RE-EVALUATE verdict means "come back
     * on this date", so `showEvaluate` must NOT offer the affordance again before that date arrives — the
     * server (`repot-evaluation.write-core.ts`) 409s a re-evaluation attempted before `reevaluateOn`, and
     * the card was inviting exactly that rejected action. Left undefined/null (should not happen for a
     * real RE-EVALUATE row, but data is data) the date is treated as ALREADY ARRIVED — see
     * `reevaluateArrived` below — so missing data never blocks the owner.
     */
    pendingReevaluateOn?: string | null;
    /**
     * REPOT only, opt-in per SURFACE, and the reason this is a PROP rather than a second component: the
     * plant-detail page keeps a standalone "Done" beside "Time to evaluate", and the Today page must not.
     *
     * The owner's case (2026-08-07): they repotted the plant, for whatever reason, without running the
     * questionnaire — or having run it and been told "not yet". On the plant's own page that must simply
     * work: "Time to evaluate" opens the questionnaire, "Done" records the repot, and (with
     * `withDoneDate`) the date input beside it back-dates it. Today stays a strict triage list: one action
     * per card, and Done appears there only once a verdict has decided the repot IS needed.
     *
     * Deliberately does NOT unlock Postpone. A REPOT Postpone means "yes, it needs it, but I can't right
     * now" — a conclusion, which is exactly what D38 stopped asking the owner for. There is no such thing
     * as postponing a repot nobody has established is needed; the answer to that is the questionnaire.
     */
    allowStandaloneDone?: boolean;
    /**
     * Whether this task can be SURVEYED before acting. REPOT is surveyed from its own visual signs and is
     * always surveyable; WATER is surveyable only when the owner selected an instrument — so this prop is
     * how the caller says "there is a way to check".
     *
     * ⚠️ FALSE MUST LEAVE THE ROW BYTE-IDENTICAL TO ITS PRE-SURVEY SHAPE. An owner who selected no
     * instrument has no way to satisfy a survey, and withholding Done from him would lock him out of his
     * own app over a feature he declined. Declining to measure is a supported choice, not a degraded state.
     */
    canSurvey?: boolean;
    /**
     * WATER only, opt-in per SURFACE, and DELIBERATELY UNDEFAULTED — the same pattern `pendingVerdict`
     * already uses. `undefined` (the prop simply omitted) means this caller has not opted into the
     * measuring affordance and renders exactly as before. Passing `false` shows the button unemphasised;
     * `true` means the app is ASKING for a reading because its own confidence is low, and the button is
     * emphasised.
     *
     * There is NO separate "measure" task and no mode (spec §4.8): a daily check spends the owner's
     * attention on the question the model is most confident about. This is an affordance on the WATER task
     * the app already shows.
     */
    suggestMeasuring?: boolean;
    /**
     * WATER only — what today's soil reading ANSWERED, straight off the payload both surfaces already
     * carry (`todaysVerdict` on the Today WATER row, `measurement.todaysVerdict` on the plant care
     * payload). `null` means nothing was measured today, and is the default, so a caller that omits the
     * prop renders exactly as before.
     *
     * It exists because of QA 2026-08-11's finding 3: a `WATER_NOW` verdict must make the watering read as
     * due TODAY even when the calendar still says nine days out — see `effectiveTaskStatus`, which owns
     * that rule for every consumer, this component included.
     */
    todaysVerdict?: TodaysVerdict;
    /**
     * WATER only — whether today's deciding reading has already been ANSWERED, by Hecho or by Posponer
     * (`watering.promptAnsweredToday` on the plant care payload). Defaults to `false`, so a caller that
     * omits it renders exactly as before.
     *
     * It is the EXIT of the promotion `todaysVerdict` above opens (QA round 3, HIGH): a verdict is a stored
     * fact and nothing retracts it, so without this the measured card stayed byte-identical after Hecho —
     * "Riega ahora", both buttons, across a full reload. The rule and the whole argument live in
     * `effectiveTaskStatus`; this prop only carries the fact.
     */
    promptAnsweredToday?: boolean;
    /**
     * WATER only — whether this pot was already WATERED on its own local today
     * (`watering.wateredToday` on the plant care payload). Defaults to `false`, so a caller that omits it
     * renders exactly as before.
     *
     * QA round 4, DEF-2 (HIGH): a measured `WATER_NOW` must not promote the row of a pot the owner has
     * already watered — the ordinary Hecho it then offers is a `200` the API's one-watering-per-day dedup
     * discards. It is a DIFFERENT fact from `promptAnsweredToday` (a watering recorded BEFORE the reading
     * is deliberately not an answer to it), which is why it is a second prop and not a widening of the
     * first. The rule lives in `effectiveTaskStatus`; this prop only carries the fact.
     */
    wateredToday?: boolean;
  }>(),
  {
    withDoneDate: false,
    showInfo: false,
    allowStandaloneDone: false,
    canSurvey: false,
    // Explicit `undefined` default, not simply omitted from this object — a `boolean`-typed prop with NO
    // entry here at all falls under Vue's own implicit boolean casting (`resolvePropValue`'s
    // `isAbsent && !hasDefault` branch): an absent boolean prop with no declared default resolves to
    // `false`, not `undefined`, which would make `suggestMeasuring !== undefined` true for EVERY WATER row
    // and leak the button onto every un-opted-in caller. Declaring the default HERE (even as `undefined`)
    // satisfies Vue's `hasDefault` check and keeps the prop genuinely tri-state.
    suggestMeasuring: undefined,
    todaysVerdict: null,
    promptAnsweredToday: false,
    wateredToday: false,
  },
);

const emit = defineEmits<{
  done: [{ task: TaskCode; occurredOn?: string }];
  postpone: [{ task: TaskCode }];
  logProgress: [{ task: TaskCode }];
  info: [{ task: TaskCode }];
  evaluate: [{ task: TaskCode }];
  measure: [];
}>();

// REPOT's own default, factored out so the initializer and the reset below can never disagree about it.
// The card's back-date is READONLY for REPOT (Task 26) — the owner cannot type into it at all, so it must
// never sit BLANK: a blank readonly field both LOOKS broken and, worse, emits `occurredOn: undefined` on
// Done, so the "one date seam" the plan describes (Task 25's `RepotDoneForm` field, seeded from this value)
// would carry nothing across it. `RepotDoneForm` itself already falls back to `todayYmd()` when it receives
// no seed (`props.seedOccurredOn || todayYmd()`) — seeding the card with `todayYmd()` here just makes that
// same default explicit and threaded end-to-end, instead of implicit three layers away. It is a SEED, not a
// claim about when the repot actually happened: the owner can still correct it in the form the Done click
// opens (`RepotDoneForm`'s own `occurredOn` field is the one editable date surface for a repot completion,
// per spec §2.3), which is exactly how "I repotted it a few days ago" (`allowStandaloneDone`) is handled —
// on the form, never on this read-only card.
const repotDoneDateDefault = () => (props.task === 'REPOT' ? todayYmd() : '');

const doneDate = ref(repotDoneDateDefault());

// The back-date must not become this row's sticky default. `PlantDetail.vue` keys its rows by TASK, so the
// instance survives the post-completion refresh: a date typed once to back-date a watering silently stayed
// in the box and rode along on the NEXT Done. Pre-existing for every task; newly consequential for REPOT,
// where that date is what anchors the substrate clock (`substrate_refreshed_on`).
//
// RESET (not cleared) ON A CHANGED `dueLabel`, deliberately NOT on the `done` emit. The emit looks like the
// obvious place and is the wrong one, because for REPOT the emit does not perform the completion — it OPENS
// the standalone Done form, and `PlantDetail.vue`'s `onRepotDone` captures the emitted `occurredOn` into
// `doneFormOccurredOn`. Resetting there breaks this sequence: Done (form opens, box resets) -> dismiss the
// form with X (no key was ever minted, so nothing is outstanding) -> Done again -> `occurredOn` reverts to
// the reset default, `doneFormOccurredOn` follows it, and `onRepotDoneConfirm`'s
// `doneFormOccurredOn.value || today()` writes the repot on TODAY regardless. That is a silent wrong-day
// write — the exact class of defect the previous round fixed — traded for the stale one.
//
// `dueLabel` changing means the schedule this row describes actually MOVED, which is what a recorded
// completion does and what a dismissed form does not. Its only false positive is a locale switch, which
// resets a WATER input the owner can see is empty and retype, or a REPOT input back to `todayYmd()`; its
// only false negative leaves today's behaviour. Neither can write a date the owner did not choose.
watch(
  () => props.dueLabel,
  () => {
    doneDate.value = repotDoneDateDefault();
  },
);

// QA round-3 defect D3, presentation half. A REPOT row now reaches the Today list on the strength of an
// unresolved 'REPOT' verdict alone, whatever its computed date says (`care-plan.service.ts`'s `todaysTasks`
// owns that rule). Its `nextDueOn` is reported UNCHANGED — deliberately, because nothing rewrote the
// schedule — so a plant evaluated early arrives here with `status: 'upcoming'` and a due label reading "in
// 675 days". Rendered as-is that card would contradict itself twice over: an urgent action under a
// not-due-for-two-years badge, and — worse — NO Postpone button at all, since Postpone is hidden for
// 'upcoming' (see the template). The verdict is ground truth about the plant; the date is the estimate it
// corrected. So the verdict wins here.
//
// Deliberately scoped to `status === 'upcoming'`: a plant that is BOTH overdue and verdict-carrying keeps
// its overdue badge, which is the more urgent and more accurate of the two statements.
//
// Lives in this component, not in its callers, because both surfaces that render a REPOT card (the Today
// page and PlantDetail) pass `pendingVerdict` already — one implementation, so the two cannot drift.
const verdictOverridesDue = computed(
  () => props.task === 'REPOT' && props.pendingVerdict === 'REPOT' && props.status === 'upcoming',
);

// QA 2026-08-11, finding 3 — THE WATER SIBLING of the REPOT rule directly above, and the same argument in
// the owner's own words: the schedule is a prediction, the measurement is the observation. A `WATER_NOW`
// verdict on today's reading makes the watering read as due TODAY even where the calendar says "faltan 9
// días", which is what puts the ordinary Hecho | Posponer pair back on the card (`showPostpone` withholds
// Posponer on an `upcoming` row, so without this the app told the owner to water and offered him no way to
// say he could not).
//
// ⚠️ THE RULE ITSELF LIVES IN `utils/waterSurvey.ts`, NOT HERE. This component is one of THREE consumers —
// the two pages apply the identical rule to the status they hand `onDone`, which is what decides whether
// the early-watering reason picker opens. A local copy of the condition here is exactly how the badge and
// the handler would come to disagree, and the disagreement is visible to the owner: "water it now",
// followed one tap later by "why are you watering early?".
//
// ⚠️ AND IT ENDS — `promptAnsweredToday` is the exit QA round 3 found missing: once the owner has answered
// the card (Hecho or Posponer), the promotion stands down and the row goes back to its calendar badge.
const effectiveStatus = computed<'overdue' | 'today' | 'upcoming'>(() =>
  verdictOverridesDue.value
    ? 'today'
    : effectiveTaskStatus({
        task: props.task,
        todaysVerdict: props.todaysVerdict,
        status: props.status,
        promptAnsweredToday: props.promptAnsweredToday,
        wateredToday: props.wateredToday,
      }));
const measurementOverridesDue = computed(
  () => !verdictOverridesDue.value && effectiveStatus.value !== props.status,
);
const effectiveDueLabel = computed(() => {
  if (verdictOverridesDue.value) return t('repotEval.verdictNowBadge');
  // A row surfaced by a measurement must not go on reading "faltan 9 días" beside an urgent badge colour —
  // the same self-contradiction the REPOT arm above exists to remove, with WATER's own wording.
  if (measurementOverridesDue.value) return t('reading.verdictNowBadge');
  return props.dueLabel;
});

const badgeColor = computed(() =>
  effectiveStatus.value === 'overdue' ? 'red' : effectiveStatus.value === 'today' ? 'amber' : 'neutral',
);

// REPOT stops offering a bare Done/Postpone until a verdict exists — but ONLY for a caller that has
// explicitly opted in by passing `pendingVerdict` at all (even `null`). A caller that omits the prop
// entirely (`undefined`) has not migrated to the state machine yet and keeps today's behavior — this is
// what stops `PlantDetail.vue`'s own, not-yet-migrated REPOT card from silently losing its Done/Postpone
// buttons the moment this component's default changes (a real regression a code review caught: the old
// unconditional `pendingVerdict: null` default made EVERY consumer, migrated or not, show "time to
// evaluate" with no way to complete or postpone a repot from the plant-detail page).
// V13 fix: a pending 'RE-EVALUATE' verdict whose `reevaluateOn` has NOT arrived yet must not offer the
// evaluate affordance — the server 409s that exact attempt ("The re-evaluation date has not arrived
// yet."). "Arrived" is answered on the OWNER's local calendar day via `dueState` (the same helper
// `dueLabel`/`dueLabelLong` use elsewhere), never a UTC-derived comparison. Missing `reevaluateOn` (should
// not happen for a real RE-EVALUATE row) is treated as arrived — blocking the owner on absent data is the
// worse failure than occasionally re-offering the affordance a beat early.
const reevaluateArrived = computed(() => {
  if (!props.pendingReevaluateOn) return true;
  const kind = dueState(props.pendingReevaluateOn).kind;
  return kind === 'overdue' || kind === 'today';
});

const showEvaluate = computed(() => {
  // The survey shape is task-agnostic (spec §5.1): WATER offers it exactly when the caller says there is a
  // way to check (`canSurvey`) — no `pendingVerdict` state machine exists for WATER yet (a later task builds
  // it), so "no verdict is pending" is trivially true here. `canSurvey` defaults to `false`, so an un-opted
  // WATER caller (no instrument selected) renders byte-identical to before this prop existed — see its doc.
  if (props.task === 'WATER') return props.canSurvey === true;
  if (props.task !== 'REPOT' || props.pendingVerdict === undefined) return false;
  if (props.pendingVerdict === null) return true;
  if (props.pendingVerdict === 'REPOT') return false;
  return reevaluateArrived.value; // 'RE-EVALUATE': only once its date has arrived
});

// The card's replacement affordance while a 'RE-EVALUATE' verdict is pending and not yet due: instead of a
// disabled button with no explanation, the owner sees what happened and when to look again.
const reevaluatePending = computed(
  () => props.task === 'REPOT' && props.pendingVerdict === 'RE-EVALUATE' && !reevaluateArrived.value,
);
const reevaluateNoticeDate = computed(() =>
  props.pendingReevaluateOn ? d(ymdToLocalDate(props.pendingReevaluateOn), 'short') : '',
);

// The states in which the survey shape is WITHHOLDING Done/Postpone because the question hasn't been
// answered yet: the survey is on offer (REPOT's questionnaire, or WATER's check when `canSurvey` is true),
// or a REPOT RE-EVALUATE date has not arrived yet. Named once so the three computeds below cannot disagree
// about which states those are.
const verdictWithholdsDone = computed(() => showEvaluate.value || reevaluatePending.value);

// The Done SLOT — whether this row's completion affordance is on screen at all. It opens whenever the
// survey shape is not withholding it — i.e. REPOT with a decided verdict, a WATER row with no way to survey
// (`canSurvey: false`, the default), and every task the shape doesn't touch at all — PLUS the surface that
// has explicitly opted into a standalone Done.
//
// ⚠️ THE SLOT AND THE BUTTON ARE TWO DIFFERENT THINGS SINCE QA ROUND 5 (F1), AND SPLITTING THEM IS THE FIX.
// The back-date input lives in this slot too, and it is the ONE control that can turn a refused Done into an
// accepted one (see `doneWouldBeDiscarded` below) — so hiding the whole slot to hide the button would take
// the owner's only way out with it.
const doneSlotOpen = computed(() => !verdictWithholdsDone.value || props.allowStandaloneDone);

// ⚠️ WOULD THIS Hecho BE THROWN AWAY (QA round 5, F1)? The RULE lives in `utils/waterSurvey.ts` — this is
// the THIRD renderer to need it (Today's card, the reading modal's verdict step, and now this row), which
// is exactly why it is a shared predicate and not a fourth local condition. See its own doc for the
// measured defect and for why `wateredToday` alone is the WRONG test.
//
// It reads `doneDate` — the row's own date box — so it is LIVE: typing an earlier day into that box brings
// Hecho straight back, which is the legitimate back-dating flow QA verified in this same round and the half
// a careless fix silently removes.
const doneWouldBeDiscarded = computed(() =>
  waterDoneWouldBeDiscarded({
    task: props.task,
    wateredToday: props.wateredToday,
    occurredOn: doneDate.value,
    today: todayYmd(),
  }));

const showDone = computed(() => doneSlotOpen.value && !doneWouldBeDiscarded.value);

// ⚠️ A WATER SURVEY WITHHOLDS **HECHO** AND NOT **POSPONER**, AND THE ASYMMETRY IS THE WHOLE RULE (QA round
// 4, DEF-3; owner-ruled 2026-08-11). Until this change, an owner who had selected an instrument could not
// defer a watering at all: the row offered "¿Necesitas regar?" and nothing else, and the only escape was to
// switch his probe OFF in Settings — which is not a thing anyone should have to discover.
//
// **"No tengo tiempo ahorita" is a legitimate answer that needs no measurement.** The soil's state is
// irrelevant to it: the owner is reporting HIS OWN AVAILABILITY, not the pot's condition. Withholding
// Posponer forced a measurement in order to answer a question measurement cannot answer.
//
// **Hecho is the opposite case and stays withheld.** Marking a watering done without measuring is exactly
// what the survey exists to replace, and the row is at that moment offering to tell the owner whether he
// should water at all. Letting him record a watering while that question is open defeats the feature.
//
// ⚠️ SCOPED TO WATER, DELIBERATELY. REPOT's own withholding states are untouched: a REPOT Posponer means
// "yes, it needs it, but I can't right now" — a CONCLUSION, and there is no such thing as postponing a
// repot nobody has established is needed. The answer to that is still the questionnaire (see
// `allowStandaloneDone`'s own doc, which draws the same line for Done).
//
// The second clause is unchanged: a task that is not due yet has nothing to postpone.
const verdictWithholdsPostpone = computed(() => verdictWithholdsDone.value && props.task !== 'WATER');

// Postpone is NEVER unlocked by `allowStandaloneDone` — see the prop's own doc. That is unchanged; the only
// thing that moved is WHICH withholding states apply to it (above).
const showPostpone = computed(
  () => !verdictWithholdsPostpone.value && effectiveStatus.value !== 'upcoming',
);

// The survey button's own copy is task-specific even though the shape is not: REPOT's key ("Time to
// evaluate") describes reading visual signs, and reusing it for WATER would reassert the instruction voice
// this whole change exists to remove — the approved wording for WATER is a QUESTION ("Do you need to
// water?"), because the question IS the reframe. Branched here, not baked into a shared key, so a future
// edit to REPOT's wording can never silently rewrite WATER's prompt.
const evaluateLabel = computed(() =>
  props.task === 'WATER' ? t('reading.surveyQuestion') : t('repotEval.cardAction'),
);

const onDone = () => emit('done', { task: props.task, occurredOn: doneDate.value || undefined });
const onPostpone = () => emit('postpone', { task: props.task });
const onLogProgress = () => emit('logProgress', { task: props.task });
const onInfo = () => emit('info', { task: props.task });
const onEvaluate = () => emit('evaluate', { task: props.task });
</script>

<template>
  <div class="mp-taskrow" v-bind="$attrs">
    <div class="mp-taskrow__meta">
      <AppIcon :name="TASK_ICONS[task]" :size="18" class="mp-taskrow__icon" />
      <span class="mp-taskrow__label">{{ taskLabel(task) }}</span>
      <Badge :color="badgeColor" size="xs">{{ effectiveDueLabel }}</Badge>
      <button
        v-if="showInfo"
        type="button"
        class="mp-taskrow__info"
        :aria-label="t('taskInfo.aria')"
        @click="onInfo"
      >
        <AppIcon name="information-circle" :size="16" />
      </button>
    </div>
    <p v-if="explanation" class="mp-taskrow__explanation">{{ explanation }}</p>
    <div class="mp-taskrow__actions">
      <template v-if="task === 'PROGRESS'">
        <Button size="xs" color="primary" icon="camera" @click="onLogProgress">{{ taskLabel(task) }}</Button>
      </template>
      <template v-else>
        <!-- The verdict-driven affordance, when the state machine is withholding Done: the questionnaire,
             or the "we'll ask again on <date>" note. `allowStandaloneDone` does not replace either of
             these — it renders Done BESIDE them, so the plant page offers both actions at once. -->
        <Button v-if="showEvaluate" size="xs" color="primary" icon="magnifying-glass" @click="onEvaluate">
          {{ evaluateLabel }}
        </Button>
        <span v-else-if="reevaluatePending" class="mp-taskrow__pending-note">
          {{ t('repotEval.pendingReevaluateNote', { date: reevaluateNoticeDate }) }}
        </span>
        <template v-if="doneSlotOpen">
          <!-- A4 (spec §2.4): a PAST-EVENT date, so the browser refuses a future day with no round trip.
               `pages/moving.vue`'s moveOn deliberately carries NO max — it is future-by-design. -->
          <!-- Spec §2.3: on REPOT this input SEEDS the completion form's own date field and then stops
               being editable, so exactly one editable date surface exists for one submission. Two live
               inputs for one date is a disagreement, not a redundancy. -->
          <input
            v-if="withDoneDate"
            v-model="doneDate"
            type="date"
            :max="todayYmd()"
            :readonly="task === 'REPOT'"
            class="mp-taskrow__date"
            :class="{ 'mp-taskrow__date--readonly': task === 'REPOT' }"
            :aria-label="t('progress.doneDateAria')"
          />
          <!-- A standalone Done is the SECONDARY action beside "Time to evaluate" — the questionnaire is
               still what the card is asking for. It becomes primary again once nothing is withholding it,
               which is every case that existed before. -->
          <Button
            v-if="showDone"
            size="xs"
            :color="verdictWithholdsDone ? 'neutral' : 'primary'"
            :variant="verdictWithholdsDone ? 'soft' : 'solid'"
            icon="check"
            @click="onDone"
          >
            {{ t('common.done') }}
          </Button>
          <!-- ⚠️ WITHHELD AND REPLACED BY THE FACT, NEVER RENDERED DEAD OR SILENTLY DROPPED (QA round 5,
               F1). The app must not offer — and must certainly not interrogate the owner about — a Done the
               server will discard, but it must not go quiet either: a button that simply vanishes reads as
               a bug. So the row states what is true about the plant, and, wherever the date box exists, the
               one action that still works. The date box above stays rendered and live: an earlier day
               brings Hecho back on the very next keystroke.
               Two independent sentences rather than one composed key, deliberately — the second is a
               statement about a control that only exists when `withDoneDate` is passed, and printing "set
               an earlier date" on a row with no date field would be advice the owner cannot follow. -->
          <span v-else class="mp-taskrow__discarded-note">
            {{ t('tasks.wateredTodayNote') }}<template v-if="withDoneDate">
              {{ t('tasks.wateredTodayBackdate') }}</template>
          </span>
        </template>
        <!-- ⚠️ POSPONER SITS OUTSIDE THE `showDone` BLOCK (QA round 4, DEF-3). It used to be nested inside
             it, which silently tied "may I postpone?" to "may I mark it done?" — and for a WATER row with
             the survey on offer those two answers are now different. See `verdictWithholdsPostpone` for the
             owner's ruling and why the asymmetry is the point. -->
        <Button v-if="showPostpone" size="xs" color="neutral" variant="ghost" icon="clock" @click="onPostpone">
          {{ t('common.postpone') }}
        </Button>
        <!-- The measure affordance (spec §4.8): an affordance on the WATER task, never a separate task or
             mode. `suggestMeasuring !== undefined` is the opt-in gate — a caller that omits the prop
             renders exactly as before. `true` means the app's own confidence is low and is ASKING for a
             reading, so the button is emphasised; `false` still offers it, unemphasised. -->
        <Button
          v-if="task === 'WATER' && suggestMeasuring !== undefined"
          size="xs"
          :color="suggestMeasuring ? 'primary' : 'neutral'"
          :variant="suggestMeasuring ? 'solid' : 'ghost'"
          @click="emit('measure')"
        >
          {{ t('reading.measureAction') }}
        </Button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mp-taskrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  flex-wrap: wrap;
}

.mp-taskrow__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.mp-taskrow__icon {
  color: var(--text-muted);
  flex: none;
}

.mp-taskrow__label {
  font-family: var(--font-sans);
  font-weight: var(--weight-semibold);
  font-size: var(--text-sm);
  color: var(--text-strong);
}

.mp-taskrow__explanation {
  flex-basis: 100%;
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-taskrow__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.mp-taskrow__pending-note {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* QA round 5, F1 — the sentence that replaces a Done the server would discard. Same treatment as the
   pending-reevaluate note directly above: muted, small, and part of the action row rather than an alert,
   because it states a fact about the plant and not a failure. */
.mp-taskrow__discarded-note {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-taskrow__date {
  height: 28px;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-strong);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 0 var(--space-2);
  outline: none;
}

.mp-taskrow__date:focus {
  border-color: var(--border-brand);
  box-shadow: var(--shadow-focus);
}

/* REPOT's back-date is display-only (Task 26): it seeds the completion form and stops being editable
   here, so it reads as inert rather than as an active input the owner might still type into. */
.mp-taskrow__date--readonly {
  color: var(--text-muted);
  background: var(--surface-sunken);
  cursor: default;
}

.mp-taskrow__date--readonly:focus {
  border-color: var(--border-default);
  box-shadow: none;
}

.mp-taskrow__info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.mp-taskrow__info:hover {
  color: var(--text-muted);
  background: var(--surface-sunken);
}

.mp-taskrow__info:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
</style>
