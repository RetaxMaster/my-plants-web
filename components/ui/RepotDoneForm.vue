<script setup lang="ts">
// Marks a REPOT task done. Pre-fills the three fields the care engine actually needs to stop computing
// against the old pot (potSizeCm, soilMix, charged) with whatever the plant's current profile already
// knows, so confirming a repot that changed nothing is a single tap. Only EMITS the payload — the caller
// (the Today-page card / plant-detail flow, not this component) owns the API call and the stable
// idempotency key, same division of responsibility as RepotEvaluationModal.vue's `submit` emit.
import type { RepotDonePayload } from '~/types/api';
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
// Same vocabulary as PlantProfileModal.vue's soil-mix select — built from the shared package's slug list,
// never a local literal array, so a mix Spec 1 adds to that vocabulary never goes stale here.
const { soilMixOptions } = useProfileMeta();

// '' is the empty state (Input.vue's v-model is `string | number`, never `null` — same convention as
// PlantProfileModal.vue's ageMonths field).
const potSizeCm = ref<number | string>('');
const soilMix = ref<string>('');
// Tri-state in the UI, boolean on the wire: "reused / inert" maps to `charged: false`, which tells the
// engine no carryover should be assumed and it may feed sooner. That is the FEED-SOONER direction, not
// the app's doubt-default (which assumes charge remains and withholds feeding) — this ref defaults to
// 'fresh' above, not to this branch.
const substrate = ref<'fresh' | 'reused'>('fresh');

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
      soilMix.value = props.frozenSnapshot.soilMix;
      substrate.value = props.frozenSnapshot.charged ? 'fresh' : 'reused';
    }
    return;
  }
  potSizeCm.value = props.currentPotSizeCm ?? '';
  soilMix.value = props.currentSoilMix ?? soilMixOptions.value[0]?.value ?? '';
  substrate.value = 'fresh';
});

const canConfirm = computed(
  () => !props.submitting && typeof potSizeCm.value === 'number' && potSizeCm.value > 0 && soilMix.value.length > 0,
);

function onConfirm() {
  if (!canConfirm.value) return;
  emit('confirm', {
    potSizeCm: potSizeCm.value as number,
    soilMix: soilMix.value,
    charged: substrate.value === 'fresh',
  });
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

    <FormGroup :label="t('repotDone.potSize')" :hint="t('repotDone.potSizeHint')">
      <Input v-model.number="potSizeCm" type="number" min="1" step="1" :disabled="frozen" />
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

    <FormGroup :label="t('repotDone.soilMix')">
      <SelectField v-model="soilMix" :options="soilMixOptions" :disabled="frozen" />
    </FormGroup>

    <FormGroup :label="t('repotDone.substrate')">
      <SegmentedControl
        v-model="substrate"
        :disabled="frozen"
        :options="[
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
