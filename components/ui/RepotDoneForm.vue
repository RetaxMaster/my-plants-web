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
  /** W3: the OUTSTANDING attempt's own stored envelope (the `payload` half of `useRepotAttempt.ts`'s frozen
   * `{ occurredOn, payload }` body), present iff `frozen` is true. Once the store that tracks attempts moved
   * to module scope (W1), a plant's frozen attempt can survive a detour through a DIFFERENT plant's card —
   * e.g. plant A fails and freezes, the owner opens plant B's form instead (leaving this component's local
   * `potSizeCm`/`soilMix`/`substrate` refs holding B's values), then returns to A. Without this prop the
   * `watch(open, ...)` below has no way to tell the fields apart from B's leftover values — it can only
   * "not reset them", which silently displays B's pot size and soil mix under A's frozen (and about-to-be
   * retried) form. Hydrating FROM this snapshot instead of merely refusing to reset means the displayed
   * values and the request a retry actually sends are read from the exact SAME source, so they can never
   * disagree — never a second "remember the draft per plant" mechanism; the envelope already IS the draft. */
  frozenSnapshot?: Omit<RepotDonePayload, 'evaluationId' | 'refreshedOn'> | null;
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
      potSizeCm.value = props.frozenSnapshot.potSizeCm;
      // `soilMix` is tri-state by NULLABILITY on the wire (`SoilMix | null`, see types/api.ts): `null` is
      // the owner's explicit "I don't know" and must round-trip back to the EMPTY option, never to some
      // concrete mix. Same class of defect as FIX D3 below, which turned an omitted `charged` into a
      // positive "reused" claim the owner never made.
      soilMix.value = props.frozenSnapshot.soilMix ?? '';
      // FIX D3 — `charged` is tri-state by PRESENCE on the wire (see types/api.ts's own comment): `undefined`
      // means "I don't know" and must round-trip back to 'unknown', never silently become 'reused'. The
      // PREVIOUS version of this line (`... ? 'fresh' : 'reused'`) turned an omitted `charged` into 'reused'
      // — the OPPOSITE of what the owner actually said (nothing) — because `undefined` is falsy in a ternary
      // exactly like `false` is.
      substrate.value = props.frozenSnapshot.charged === undefined
        ? 'unknown'
        : (props.frozenSnapshot.charged ? 'fresh' : 'reused');
    }
    return;
  }
  potSizeCm.value = props.currentPotSizeCm ?? '';
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
// already gates on that), never an inline error of its own.
const potSizeErrorMessage = computed(() => {
  if (potSizeCm.value === '' || potSizeValid.value) return undefined;
  return t('repotDone.potSizeInvalid', { max: POT_SIZE_CM_MAX });
});

// FIX QA-D2 — `soilMix` is NO LONGER part of this gate. "I don't know" is a legitimate answer to it (the
// engine has a first-class no-evidence path for a null mix — `CHARGE_UNKNOWN_MIX_DAYS`, a named constant
// distinct from the declared-charge one precisely so the two derivations can never collapse), so requiring
// a concrete mix made the feature's main path un-completable for an owner who genuinely did not know.
// `potSizeCm` stays required: without the NEW pot's diameter the crowding ratio is computed against a pot
// that no longer exists, silently and plausibly, for the rest of the plant's life.
const canConfirm = computed(
  () => !props.submitting && potSizeValid.value,
);

function onConfirm() {
  if (!canConfirm.value) return;
  const payload: Omit<RepotDonePayload, 'evaluationId'> = {
    potSizeCm: potSizeCm.value as number,
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

    <FormGroup :label="t('repotDone.potSize')" :hint="t('repotDone.potSizeHint')" :error="potSizeErrorMessage">
      <Input
        v-model.number="potSizeCm"
        type="number"
        min="1"
        :max="POT_SIZE_CM_MAX"
        step="1"
        :disabled="frozen"
        :error="potSizeErrorMessage"
      />
    </FormGroup>
    <Button
      size="xs"
      variant="soft"
      color="neutral"
      class="mp-repotdone__sameasbefore"
      :disabled="frozen || currentPotSizeCm === null"
      @click="potSizeCm = currentPotSizeCm ?? ''"
    >
      {{ t('repotDone.sameAsBefore') }}
    </Button>

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

.mp-repotdone__sameasbefore {
  margin: var(--space-1) 0 var(--space-4);
}
</style>
