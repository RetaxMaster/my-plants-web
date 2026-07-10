<script setup lang="ts">
import Modal from './Modal.vue';
import SelectField from './SelectField.vue';
import Button from './Button.vue';

interface Option {
  label: string;
  value: string;
}

const props = defineProps<{
  title: string;
  options: Option[];
  confirmLabel?: string;
  /**
   * Optional checklist shown above the options. Used by the REPOT inspection (spec F.7) to present the
   * species' `repotting.signs` at the moment the owner is asked what they saw — the engine has never seen
   * the roots, so it schedules the *look* and shows what to look for. Absent for the WATER pickers, which
   * therefore render exactly as before. Values are API-supplied and render verbatim (the same deferred
   * English-leak policy as `care.viability.reasons`).
   */
  signs?: string[];
  signsHeading?: string;
}>();

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ confirm: [reason: string] }>();

const { t } = useI18n();
const selected = ref('');

// Pre-select the first option each time the picker opens, so confirm always has a value.
watch(open, (isOpen) => {
  if (isOpen) selected.value = props.options[0]?.value ?? '';
});

function confirm() {
  if (!selected.value) return;
  emit('confirm', selected.value);
  open.value = false;
}
</script>

<template>
  <Modal v-model="open" :title="title">
    <div v-if="signs && signs.length" class="reason-picker__signs">
      <p class="reason-picker__signs-heading">{{ signsHeading }}</p>
      <ul class="reason-picker__signs-list">
        <li v-for="s in signs" :key="s">{{ s }}</li>
      </ul>
    </div>
    <SelectField v-model="selected" :options="options" :aria-label="title" />
    <template #footer>
      <Button color="neutral" variant="ghost" size="sm" @click="open = false">
        {{ t('common.cancel') }}
      </Button>
      <Button color="primary" size="sm" @click="confirm">
        {{ confirmLabel ?? t('common.done') }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
/* Design-system tokens only — no magic values. */
.reason-picker__signs {
  margin-bottom: var(--space-4);
}

.reason-picker__signs-heading {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
}

.reason-picker__signs-list {
  margin: 0;
  padding-left: var(--space-5);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.reason-picker__signs-list li + li {
  margin-top: var(--space-1);
}
</style>
