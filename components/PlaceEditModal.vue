<script setup lang="ts">
interface EditablePlace {
  id: string;
  name: string;
  climateControlled: boolean;
}

const props = defineProps<{
  place: EditablePlace | null;
}>();

const emit = defineEmits<{ saved: [] }>();

const api = useApi();

const open = defineModel<boolean>({ default: false });

const editName = ref('');
const editClimate = ref(false);
const savingEdit = ref(false);

// Whenever the modal opens, seed the fields from the current place.
watch(open, (isOpen) => {
  if (isOpen && props.place) {
    editName.value = props.place.name;
    editClimate.value = props.place.climateControlled;
  }
});

async function saveEdit() {
  if (!props.place) return;
  savingEdit.value = true;
  try {
    await api.updatePlace(props.place.id, { name: editName.value, climateControlled: editClimate.value });
    emit('saved');
    open.value = false;
  } finally { savingEdit.value = false; }
}
</script>

<template>
  <UiModal v-model="open" :title="$t('placeEdit.title')">
    <div class="mp-edit-form">
      <UiFormGroup :label="$t('placeEdit.name')">
        <UiInput v-model="editName" />
      </UiFormGroup>
      <UiFormGroup :label="$t('placeEdit.climateControlled')">
        <div class="mp-edit-form__switch">
          <UiSwitch v-model="editClimate" />
          <span class="mp-edit-form__switch-text">{{ editClimate ? $t('common.yes') : $t('common.no') }}</span>
        </div>
      </UiFormGroup>
    </div>
    <template #footer>
      <UiButton color="neutral" variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UiButton>
      <UiButton color="primary" :loading="savingEdit" @click="saveEdit">{{ $t('common.save') }}</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.mp-edit-form {
  display: grid;
  gap: var(--space-3);
}

.mp-edit-form__switch {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mp-edit-form__switch-text {
  font: 14px var(--font-sans);
  color: var(--text-muted);
}
</style>
