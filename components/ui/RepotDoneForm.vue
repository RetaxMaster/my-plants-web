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
}>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ confirm: [payload: Omit<RepotDonePayload, 'evaluationId'>] }>();

const { t } = useI18n();
// Same vocabulary as PlantProfileModal.vue's soil-mix select — built from the shared package's slug list,
// never a local literal array, so a mix Spec 1 adds to that vocabulary never goes stale here.
const { soilMixOptions } = useProfileMeta();

// '' is the empty state (Input.vue's v-model is `string | number`, never `null` — same convention as
// PlantProfileModal.vue's ageMonths field).
const potSizeCm = ref<number | string>('');
const soilMix = ref<string>('');
// Tri-state in the UI, boolean on the wire: "reused / inert" maps to `charged: false`, the conservative
// default (under-feeding is recoverable; salt burn from an already-charged mix is not).
const substrate = ref<'fresh' | 'reused'>('fresh');

watch(open, (isOpen) => {
  if (!isOpen) return;
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
      <Input v-model.number="potSizeCm" type="number" min="1" step="1" />
    </FormGroup>
    <Button
      size="xs"
      variant="ghost"
      color="neutral"
      class="mp-repotdone__sameasbefore"
      :disabled="currentPotSizeCm === null"
      @click="potSizeCm = currentPotSizeCm ?? ''"
    >
      {{ t('repotDone.sameAsBefore') }}
    </Button>

    <FormGroup :label="t('repotDone.soilMix')">
      <SelectField v-model="soilMix" :options="soilMixOptions" />
    </FormGroup>

    <FormGroup :label="t('repotDone.substrate')">
      <SegmentedControl
        v-model="substrate"
        :options="[
          { key: 'fresh', label: t('repotDone.substrateFresh') },
          { key: 'reused', label: t('repotDone.substrateReused') },
        ]"
      />
    </FormGroup>

    <template #footer>
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
