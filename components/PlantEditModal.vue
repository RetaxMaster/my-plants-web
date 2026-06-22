<script setup lang="ts">
import type { Place, Plant, Viability } from '../types/api.js';

const props = defineProps<{
  plant: Plant;
  places: Place[];
}>();

const emit = defineEmits<{ saved: [] }>();

const api = useApi();

const open = defineModel<boolean>({ default: false });

const editNickname = ref('');
const editPlaceId = ref('');
const preview = ref<Viability | null>(null);
const savingEdit = ref(false);

const placeOptions = computed(() =>
  (props.places ?? [])
    .filter((p) => p.ownerId === props.plant.ownerId)
    .map((p) => ({ label: `${p.name} (${p.indoor ? 'Indoor' : 'Outdoor'})`, value: p.id })),
);

// Whenever the modal opens, seed the fields from the current plant.
watch(open, (isOpen) => {
  if (isOpen) {
    editNickname.value = props.plant.nickname ?? '';
    editPlaceId.value = props.plant.placeId;
    preview.value = null;
  }
});

watch(editPlaceId, async (pid) => {
  if (!pid || pid === props.plant.placeId) { preview.value = null; return; }
  const result = await api.previewPlantViability(props.plant.id, pid);
  // Ignore an out-of-order response: only apply it if this is still the selected place.
  if (editPlaceId.value === pid) preview.value = result;
});

async function saveEdit() {
  savingEdit.value = true;
  try {
    await api.updatePlant(props.plant.id, { nickname: editNickname.value, placeId: editPlaceId.value });
    emit('saved');
    open.value = false;
  } finally { savingEdit.value = false; }
}
</script>

<template>
  <UiModal v-model="open" title="Edit plant">
    <div class="mp-edit-form">
      <UiFormGroup label="Nickname">
        <UiInput v-model="editNickname" />
      </UiFormGroup>
      <UiFormGroup label="Place">
        <UiSelectField v-model="editPlaceId" :options="placeOptions" />
      </UiFormGroup>
      <div v-if="preview">
        <p class="mp-edit-form__preview-label">Projected viability in the new place:</p>
        <UiViabilityBadge :level="preview.level" :reasons="preview.reasons" />
      </div>
    </div>
    <template #footer>
      <UiButton color="neutral" variant="ghost" @click="open = false">Cancel</UiButton>
      <UiButton color="primary" :loading="savingEdit" @click="saveEdit">Save</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.mp-edit-form {
  display: grid;
  gap: var(--space-3);
}

.mp-edit-form__preview-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin: 0 0 var(--space-1);
}
</style>
