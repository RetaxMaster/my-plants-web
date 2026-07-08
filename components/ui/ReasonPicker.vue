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
