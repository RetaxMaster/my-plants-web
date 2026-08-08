<script setup lang="ts">
// Marks a REPOT task done. Pre-fills potSizeCm and soilMix — the two fields the care engine needs to stop
// computing against the old pot — with whatever the plant's current profile already knows, so confirming a
// repot that changed neither of those two is close to a single tap. FIX D: the THIRD field, the
// fresh-substrate answer, is deliberately NOT pre-filled with a guess any more — it defaults to "I don't
// know" (see the `substrate` ref below), because a pre-pressed answer in EITHER direction was wrong: a
// guessed "fresh" on an empty profile silently wrote a 45-day fertilizing hold the owner never asserted, and
// a pre-pressed "fresh" was wrong-direction even on a complete profile (repotting into REUSED soil is
// common). Only EMITS the payload — the caller (the Today-page card / plant-detail flow, not this component)
// owns the API call and the stable idempotency key, same division of responsibility as
// RepotEvaluationModal.vue's `submit` emit.
import type { RepotDonePayload } from '~/types/api';
// FIX C4/D4 — the single source for the pot-size ceiling, never a local literal: `types/api.ts` already
// imports plant-profile constants from this same module (the project's "no new forks" rule), so this
// follows the same convention rather than hardcoding `500` here.
import { POT_SIZE_CM_MAX } from '@retaxmaster/my-plants-species-schema/plant-profile-constants';
import Modal from './Modal.vue';
import Button from './Button.vue';
import Alert from './Alert.vue';
import FormGroup from './FormGroup.vue';
import Input from './Input.vue';
import SelectField from './SelectField.vue';
import SegmentedControl from './SegmentedControl.vue';

const props = defineProps<{
  /** The plant's CURRENT values — the form opens pre-filled with them. */
  currentPotSizeCm: number | null;
  currentSoilMix: string | null;
  submitting?: boolean;
  error?: string | null;
  /** Same contract as RepotEvaluationModal.vue's `frozen` (code review finding Y2 — this form had the exact
   * idempotency defect already fixed there): true from the moment a confirm is first attempted until it
   * succeeds or the owner explicitly starts over. While frozen the inputs are disabled, so a retry (the
   * same confirm button) resends the EXACT same body — pot size, soil mix and the fresh-substrate toggle
   * never change under an outstanding key. Without this, a failed/lost-response retry after the owner
   * edited a field would resend the SAME idempotency key with a DIFFERENT body, which the server's global
   * idempotency interceptor answers 422 forever. */
  frozen?: boolean;
  /** W3: the OUTSTANDING attempt's own stored envelope — the WHOLE `{ occurredOn, payload }` body from
   * `useRepotAttempt.ts`, present iff `frozen` is true. Once the store that tracks attempts moved
   * to module scope (W1), a plant's frozen attempt can survive a detour through a DIFFERENT plant's card —
   * e.g. plant A fails and freezes, the owner opens plant B's form instead (leaving this component's local
   * `potSizeCm`/`soilMix`/`substrate` refs holding B's values), then returns to A. Without this prop the
   * `watch(open, ...)` below has no way to tell the fields apart from B's leftover values — it can only
   * "not reset them", which silently displays B's pot size and soil mix under A's frozen (and about-to-be
   * retried) form. Hydrating FROM this snapshot instead of merely refusing to reset means the displayed
   * values and the request a retry actually sends are read from the exact SAME source, so they can never
   * disagree — never a second "remember the draft per plant" mechanism; the envelope already IS the draft.
   *
   * It carries the WHOLE body, not just the `payload` half it used to. `occurredOn` — the day the repot
   * will be recorded on, and the day `substrate_refreshed_on` will be set to — lives one level up in that
   * envelope and was surfaced NOWHERE, while the card's own back-date input behind this modal stays
   * editable: so the card could read date X while the retry would send date Y, on a feature whose entire
   * point is recording the repot on the day it actually happened. Taking the whole envelope keeps the ONE
   * source W3 argues for instead of adding a second prop beside it. */
  frozenSnapshot?: { occurredOn: string; payload: Omit<RepotDonePayload, 'evaluationId' | 'refreshedOn'> } | null;
}>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ confirm: [payload: Omit<RepotDonePayload, 'evaluationId'>]; 'start-over': [] }>();

const { t } = useI18n();
// Same vocabulary AND the same enabled-empty-option construction as PlantProfileModal.vue's soil-mix
// select — both built from the shared package's slug list via the one composable, never a local literal
// array and never a second `withNotSet`, so a mix Spec 1 adds to that vocabulary never goes stale here.
const { soilMixOptions, withNotSet } = useProfileMeta();

// FIX QA-D2 — the mix offers an explicit, SELECTABLE "I don't know", labelled as such rather than as the
// profile form's generic "Not set", because here it answers a question that was just asked out loud. It is
// NOT a `SelectField` placeholder: a placeholder option is DISABLED, so it can say "you have not answered"
// but can never be chosen as the answer — which is what left an owner who genuinely did not know what they
// had potted into unable to complete the repot at all, the form's own main path.
const soilMixSelectOptions = computed(() => withNotSet(soilMixOptions.value, t('repotDone.soilMixUnknown')));

// '' is the empty state (Input.vue's v-model is `string | number`, never `null` — same convention as
// PlantProfileModal.vue's ageMonths field). For `soilMix`, '' is ALSO the "I don't know" ANSWER, and
// `onConfirm` sends it as an explicit `null` — see there.
const potSizeCm = ref<number | string>('');
// QA round-4 finding 2. The diameter was the ONE field on this form with no "I don't know" path, and
// "Mark as repotted" stayed disabled until it held a number. On a plant whose profile records no pot size
// (the fixture's `Gus`) the "Same as before" escape is disabled too — nothing to copy — so an owner who had
// genuinely repotted the plant could not record it at all without inventing a diameter.
//
// The fix is the same shape `soilMix` already uses: an explicit "I don't know" that sends `null`, NOT an
// omitted key. The reasoning that made the field required is precisely what makes `null` the right answer
// rather than a missing one — a repot replaces the pot, so the old diameter is a claim about a pot that no
// longer exists, and clearing it makes the crowding ratio uncomputable (`crowdingIndex` returns null,
// already a first-class state on every plant whose profile never recorded a size) instead of plausible and
// wrong. An invented diameter would have been worse than an absent one: the engine cannot tell it is a
// guess and would feed it into the ratio for the rest of the plant's life. Verified on the API side before
// shipping this, not assumed — see repot-complete.write-core.test.ts's "a null diameter is TOLERATED by
// the in-transaction recompute".
const potSizeUnknown = ref(false);
const soilMix = ref<string>('');
// FIX D1 — genuinely TRI-STATE now, in BOTH the UI and on the wire (was two-way: 'fresh' | 'reused', always
// pre-pressed to 'fresh'). 'unknown' is the default and means exactly what it says — the owner has not
// asserted a fresh/reused answer, so `onConfirm` below sends NO `charged` key at all and the server derives
// the charge state from the recorded soil mix instead of the app guessing. 'fresh' -> `charged: true` (a
// full nutrient reserve — hold off feeding until the derived window ends); 'reused' -> `charged: false` (no
// carryover assumed — the engine may feed sooner). Registration (PlantEditModal's create flow) already
// offers this same three-way choice; this form offering only two was the defect FIX D closes.
const substrate = ref<'unknown' | 'fresh' | 'reused'>('unknown');

watch(open, (isOpen) => {
  if (!isOpen) return;
  // While frozen, an open->true transition is a RESUME after the owner closed the form (X/Escape/backdrop)
  // without resolving the outstanding confirm — not a fresh attempt. Mirrors RepotEvaluationModal.vue's
  // identical `watch(open, ...)` guard.
  //
  // W3: a resume HYDRATES from `frozenSnapshot` — the outstanding attempt's own stored envelope — rather
  // than merely refusing to touch whatever the fields already hold. The fields' PREVIOUS values may belong
  // to a DIFFERENT plant (the owner closed this plant's frozen form, opened another plant's, then came back
  // here), so "do nothing" would display that other plant's pot size/soil mix under THIS plant's frozen
  // form while the retry silently sends THIS plant's original body underneath it — a display that lies
  // about what will actually be submitted. Hydrating from the snapshot keeps the two in lockstep.
  if (props.frozen) {
    if (props.frozenSnapshot) {
      // `potSizeCm` is tri-state by NULLABILITY on the wire exactly like `soilMix` below: `null` is the
      // owner's explicit "I don't know" and must round-trip back to the "I don't know" chip with an EMPTY
      // input, never to a concrete number and never to a blank field that silently re-blocks confirm.
      potSizeUnknown.value = props.frozenSnapshot.payload.potSizeCm === null;
      potSizeCm.value = props.frozenSnapshot.payload.potSizeCm ?? '';
      // `soilMix` is tri-state by NULLABILITY on the wire (`SoilMix | null`, see types/api.ts): `null` is
      // the owner's explicit "I don't know" and must round-trip back to the EMPTY option, never to some
      // concrete mix. Same class of defect as FIX D3 below, which turned an omitted `charged` into a
      // positive "reused" claim the owner never made.
      soilMix.value = props.frozenSnapshot.payload.soilMix ?? '';
      // FIX D3 — `charged` is tri-state by PRESENCE on the wire (see types/api.ts's own comment): `undefined`
      // means "I don't know" and must round-trip back to 'unknown', never silently become 'reused'. The
      // PREVIOUS version of this line (`... ? 'fresh' : 'reused'`) turned an omitted `charged` into 'reused'
      // — the OPPOSITE of what the owner actually said (nothing) — because `undefined` is falsy in a ternary
      // exactly like `false` is.
      substrate.value = props.frozenSnapshot.payload.charged === undefined
        ? 'unknown'
        : (props.frozenSnapshot.payload.charged ? 'fresh' : 'reused');
    }
    return;
  }
  potSizeCm.value = props.currentPotSizeCm ?? '';
  // Never pre-pressed, in either direction — same rule as the substrate toggle's `'unknown'` default: an
  // empty field is "not answered yet", which is not the same statement as "I don't know".
  potSizeUnknown.value = false;
  // FIX D4 — dropped the `soilMixOptions.value[0]?.value` fallback (used to silently pre-select the FIRST
  // catalogue entry, e.g. "Aroid mix", whenever the plant's profile had no recorded mix). An unset mix now
  // opens on the explicit "I don't know" option, so the owner never unknowingly confirms whatever slug
  // happens to sort first.
  //
  // FIX QA-D2 corrects what this comment used to claim. It said the catalogue's `other` entry already
  // covered "I don't know what I potted into" and that a second option would be two spellings of one
  // meaning. Those are two different statements and only the first is true: `other` and `null` do take the
  // SAME engine path (ledger L29 — neither carries information about nutrient charge), but they say
  // different things to the OWNER. `other` is a positive claim about our taxonomy ("it is a mix, and none
  // of your nine categories fit"); `null` is the absence of a claim ("I do not know what was in the bag").
  // An owner who cannot make the first claim was left with no way to finish the form at all.
  soilMix.value = props.currentSoilMix ?? '';
  substrate.value = 'unknown';
});

// FIX C4 — client-side validation so a realistic bad pot-size input (a decimal like `22.5`, or an
// over-the-ceiling value like `9999`) never reaches the server at all, rather than round-tripping to a 400
// the owner then has to interpret. `potSizeCm` must be a positive INTEGER at most `POT_SIZE_CM_MAX` — the
// exact constraint the API enforces (see this file's own `POT_SIZE_CM_MAX` import).
const potSizeValid = computed(
  () => typeof potSizeCm.value === 'number' && Number.isInteger(potSizeCm.value)
    && potSizeCm.value > 0 && potSizeCm.value <= POT_SIZE_CM_MAX,
);
// Shown only once the owner has typed SOMETHING — an empty field is simply "not filled in yet" (canConfirm
// already gates on that), never an inline error of its own. Suppressed entirely once "I don't know" is
// pressed: there is no value left to be invalid, and the input is disabled and cleared.
const potSizeErrorMessage = computed(() => {
  if (potSizeUnknown.value || potSizeCm.value === '' || potSizeValid.value) return undefined;
  return t('repotDone.potSizeInvalid', { max: POT_SIZE_CM_MAX });
});

// Pressing "I don't know" CLEARS whatever was typed, so the answer and the field can never disagree — the
// same lockstep rule the frozen-snapshot hydration follows. Pressing it again returns to an empty,
// unanswered field rather than restoring the old number: a number the owner has just disowned is not a
// value to bring back.
function togglePotSizeUnknown() {
  potSizeUnknown.value = !potSizeUnknown.value;
  potSizeCm.value = '';
}

// FIX QA-D2 — `soilMix` is NO LONGER part of this gate. "I don't know" is a legitimate answer to it (the
// engine has a first-class no-evidence path for a null mix — `CHARGE_UNKNOWN_MIX_DAYS`, a named constant
// distinct from the declared-charge one precisely so the two derivations can never collapse), so requiring
// a concrete mix made the feature's main path un-completable for an owner who genuinely did not know.
//
// QA round-4 finding 2 — and `potSizeCm` now answers to the SAME rule, for the same reason. It stays
// required in the sense that the form still refuses a BAD number; what it no longer does is refuse an
// honest "I don't know". A repot the owner really performed must always be recordable.
const canConfirm = computed(
  () => !props.submitting && (potSizeUnknown.value || potSizeValid.value),
);

function onConfirm() {
  if (!canConfirm.value) return;
  const payload: Omit<RepotDonePayload, 'evaluationId'> = {
    // Explicit `null`, never an omitted key — identical reasoning to `soilMix` just below: a repot replaces
    // the pot, so an omitted key would leave the plant's OLD diameter standing as a claim about a pot it is
    // no longer in, and the crowding ratio would keep being computed from it.
    potSizeCm: potSizeUnknown.value ? null : (potSizeCm.value as number),
    // Explicit `null`, never an omitted key: a repot REPLACES the medium, so leaving the previously
    // recorded mix in place would keep asserting something that is no longer true about this pot. The
    // owner not knowing what the new medium is does not make the OLD answer correct again.
    soilMix: soilMix.value === '' ? null : soilMix.value,
  };
  // FIX D1 — `charged` is included ONLY when the owner gave an actual fresh/reused answer. Building the
  // object WITHOUT the key at all (rather than setting it to `charged: undefined`) is deliberate: either
  // spelling reaches the server identically, because `JSON.stringify` drops a property whose value is
  // `undefined` the exact same way it drops an absent key — but an object literal that never assigns the key
  // is what keeps this honest to read, rather than relying on a stringify detail nobody re-checks later.
  if (substrate.value !== 'unknown') {
    payload.charged = substrate.value === 'fresh';
  }
  emit('confirm', payload);
}
</script>

<template>
  <Modal v-model="open" :title="t('repotDone.title')">
    <!-- Rendered INSIDE the modal body (Modal.vue teleports to <body> with a fixed, viewport-covering
         backdrop), so this stays visible above it — a page-level banner sitting in the ordinary document
         flow renders BEHIND the teleported backdrop while this modal is open. See RepotEvaluationModal.vue
         and pages/index.vue's repotError comment for the same reasoning. -->
    <Alert v-if="error" color="red" :description="error" announce class="mp-repotdone__error" />

    <p class="mp-repotdone__intro">{{ t('repotDone.intro') }}</p>

    <!-- The date the retry will actually send. Only rendered while FROZEN, and read from the outstanding
         attempt's own envelope, because that is the only state in which the owner cannot otherwise see it:
         the card's back-date input behind this modal stays editable, so it can read one day while the
         frozen retry carries another. Unfrozen, that input IS the live value and needs no echo here. It is
         also the field that matters most on this form — `occurredOn` is what dates the repot and with it
         `substrate_refreshed_on`, the anchor of the substrate clock. -->
    <p v-if="frozen && frozenSnapshot" class="mp-repotdone__occurredon">
      {{ t('repotDone.recordingOn', { date: frozenSnapshot.occurredOn }) }}
    </p>

    <FormGroup :label="t('repotDone.potSize')" :hint="t('repotDone.potSizeHint')" :error="potSizeErrorMessage">
      <Input
        v-model.number="potSizeCm"
        type="number"
        min="1"
        :max="POT_SIZE_CM_MAX"
        step="1"
        :disabled="frozen || potSizeUnknown"
        :error="potSizeErrorMessage"
      />
    </FormGroup>
    <!-- The two escapes from typing a diameter, side by side. "Same as before" is a SHORTCUT (it fills the
         field with a real number the owner is asserting) and is unavailable when there is no prior size to
         copy; "I don't know" is an ANSWER in its own right, always available, and is a TOGGLE — hence
         `aria-pressed` and the solid/soft variant swap, so its state is announced and visible rather than
         inferred from the input having gone blank. -->
    <div class="mp-repotdone__potsizeactions">
      <Button
        size="xs"
        variant="soft"
        color="neutral"
        :disabled="frozen || potSizeUnknown || currentPotSizeCm === null"
        @click="potSizeCm = currentPotSizeCm ?? ''"
      >
        {{ t('repotDone.sameAsBefore') }}
      </Button>
      <!-- The VISIBLE label stays the bare "I don't know" that the mix and substrate answers already use —
           and that is exactly why it needs an `aria-label`: the substrate segmented control renders its own
           "I don't know" in this same dialog, so without one, two buttons here share an accessible name and
           a role+name query matches both (finding 4's defect, reintroduced). The aria-label CONTAINS the
           visible text, which is what WCAG 2.5.3 "Label in Name" requires, so voice control still activates
           it by what is written on it. Caught in a real browser, not by a test. -->
      <Button
        size="xs"
        :variant="potSizeUnknown ? 'solid' : 'soft'"
        color="neutral"
        :aria-label="t('repotDone.potSizeUnknownAria')"
        :aria-pressed="potSizeUnknown"
        :disabled="frozen"
        @click="togglePotSizeUnknown"
      >
        {{ t('repotDone.potSizeUnknown') }}
      </Button>
    </div>

    <!-- No `:placeholder` here, deliberately: `soilMixSelectOptions` already prepends an ENABLED empty
         option, and SelectField renders its own DISABLED one whenever `placeholder` is truthy — passing
         both leaves two blank options where only one is selectable (QA defect F, in the profile form). -->
    <FormGroup :label="t('repotDone.soilMix')">
      <SelectField
        v-model="soilMix"
        :options="soilMixSelectOptions"
        :disabled="frozen"
      />
    </FormGroup>

    <FormGroup :label="t('repotDone.substrate')">
      <SegmentedControl
        v-model="substrate"
        :disabled="frozen"
        :options="[
          { key: 'unknown', label: t('repotDone.substrateUnknown') },
          { key: 'fresh', label: t('repotDone.substrateFresh') },
          { key: 'reused', label: t('repotDone.substrateReused') },
        ]"
      />
    </FormGroup>

    <template #footer>
      <!-- Only offered once there is something to recover FROM (mirrors RepotEvaluationModal.vue): a
           frozen form with no error yet is simply an in-flight confirm, where the right action is to wait,
           not to abandon it. -->
      <Button v-if="frozen && error" variant="soft" color="neutral" @click="emit('start-over')">
        {{ t('repotEval.startOver') }}
      </Button>
      <Button color="primary" icon="check" :disabled="!canConfirm" :loading="submitting" @click="onConfirm">
        {{ t('repotDone.confirm') }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
/* Design-system tokens only — no magic values. Class conventions follow RepotEvaluationModal.vue. */
.mp-repotdone__error {
  margin: 0 0 var(--space-4);
}

.mp-repotdone__intro {
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* Reads as a stated FACT about the pending submission, not as muted supporting prose like the intro above
   it — so it takes the strong text token, which is also the pair Input/SelectField use for a real value. */
.mp-repotdone__occurredon {
  margin: calc(-1 * var(--space-2)) 0 var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
}

.mp-repotdone__potsizeactions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-1) 0 var(--space-4);
}
</style>
