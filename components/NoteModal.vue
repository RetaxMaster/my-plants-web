<script setup lang="ts">
// A single-textarea modal for a plant's free-text notes (Spec 3 — NO lifecycle state, every plant is
// active). Reuses UiModal (design-system-first, same pattern as PlaceEditModal/ProgressEntryModal) and,
// for the destructive delete, the shared UiConfirmModal (DS-first, never a native window.confirm — same
// pattern as the progress-entry edit page). `open` follows every other modal on this page: a `defineModel`
// v-model, not a bespoke close emit — so the caller toggles it exactly like PlaceEditModal/ClinicalRecordModal.
import { NOTE_MAX_LEN } from '@retaxmaster/my-plants-species-schema';

const props = defineProps<{
  plantId: string;
  mode: 'create' | 'edit';
  note?: { noteId: string; body: string } | null;
}>();

const emit = defineEmits<{ saved: [] }>();

const open = defineModel<boolean>({ default: false });

const api = useApi();
const { t } = useI18n();

const body = ref('');
const saving = ref(false);
const confirmOpen = ref(false);

// Seed (create: blank; edit: the clicked note's body) every time the modal opens, so a stale value from
// a previous open never leaks into the next one.
watch(open, (isOpen) => {
  if (isOpen) {
    body.value = props.mode === 'edit' ? (props.note?.body ?? '') : '';
  }
});

const title = computed(() =>
  props.mode === 'edit' ? t('history.noteModalEditTitle') : t('history.noteModalCreateTitle'),
);

const canSave = computed(() => body.value.trim().length > 0);

async function save() {
  if (!canSave.value || saving.value) return;
  saving.value = true;
  try {
    if (props.mode === 'edit' && props.note) {
      await api.updateNote(props.plantId, props.note.noteId, body.value);
    } else {
      await api.createNote(props.plantId, body.value);
    }
    emit('saved');
    open.value = false;
  } finally {
    saving.value = false;
  }
}

function onDelete() {
  confirmOpen.value = true;
}

async function confirmDelete() {
  if (!props.note) return;
  saving.value = true;
  try {
    await api.deleteNote(props.plantId, props.note.noteId);
    emit('saved');
    open.value = false;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <UiModal v-model="open" :title="title">
      <div class="mp-note-form">
        <UiAutosizeTextarea
          v-model="body"
          :maxlength="NOTE_MAX_LEN"
          :placeholder="$t('history.notePlaceholder')"
          class="mp-note-form__textarea"
        />
        <div class="mp-note-form__counter">{{ body.length }} / {{ NOTE_MAX_LEN }}</div>
      </div>
      <template #footer>
        <UiButton
          v-if="mode === 'edit'"
          color="neutral"
          variant="ghost"
          icon="trash"
          :disabled="saving"
          @click="onDelete"
        >
          {{ $t('history.noteDelete') }}
        </UiButton>
        <UiButton color="primary" :disabled="!canSave" :loading="saving" @click="save">
          {{ $t('history.noteSave') }}
        </UiButton>
      </template>
    </UiModal>

    <!-- Delete confirmation via the design-system confirm modal (DS-first — replaces window.confirm). -->
    <UiConfirmModal
      v-model="confirmOpen"
      :title="$t('history.noteDeleteTitle')"
      :message="$t('history.noteDeleteConfirm')"
      :confirm-label="$t('history.noteDelete')"
      confirm-icon="trash"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.mp-note-form {
  display: grid;
  gap: var(--space-2);
}

.mp-note-form__textarea {
  min-height: 96px;
  font-size: var(--text-sm);
}

.mp-note-form__counter {
  text-align: right;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-faint);
}
</style>
