// @vitest-environment happy-dom
//
// NoteModal is the single create/edit/delete surface for a plant's free-text notes (Spec 3). The review
// finding this file closes: nothing exercised the actual save-gate (Guardar disabled while blank), the
// edit-mode seed, or the wiring from the three buttons to the three useApi calls — a swapped argument
// order, a mode check that fired the wrong call, or a Guardar that stayed enabled on empty input would
// all have typechecked and shipped silently.
//
// `ref`/`computed`/`watch` are Vue's own reactivity primitives, normally auto-imported by Nuxt's build
// pipeline — outside it (plain vitest + @vue/test-utils, no auto-import shim) they don't exist as
// globals, so they're stubbed the same way PlantProfileModal.test.ts / ProgressForm.test.ts do.
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed, watch } from 'vue';
import NoteModal from './NoteModal.vue';

vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

// UiModal is stubbed to a plain passthrough exposing BOTH the default slot (the textarea) and the
// footer slot (Guardar/Eliminar) — dropping the footer slot (as the ClinicalRecordModal stub does,
// which has no footer) would silently hide every button this file needs to click.
const UiModalStub = { props: ['title'], template: '<div><slot /><slot name="footer" /></div>' };

// A minimal but REAL v-model contract: `defineModel<string>` on the textarea compiles to a
// `modelValue`/`update:modelValue` pair, so typing has to flow through an actual prop+emit round trip,
// not just "the stub exists" — a broken `v-model="body"` binding would still mount cleanly otherwise.
const UiAutosizeTextareaStub = {
  props: ['modelValue', 'placeholder', 'maxlength'],
  emits: ['update:modelValue'],
  template: '<textarea class="note-textarea" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UiButtonStub = {
  props: ['disabled', 'loading', 'color', 'variant', 'icon'],
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
};

// UiConfirmModal owns its own confirm/cancel UI in production; here it's collapsed to the one thing
// NoteModal's delete flow depends on — a visible "yes" affordance, gated on the SAME v-model contract
// (`modelValue`/`update:modelValue`) real UiConfirmModal exposes, that fires `confirm` when clicked.
const UiConfirmModalStub = {
  props: ['modelValue', 'title', 'message', 'confirmLabel', 'confirmIcon'],
  emits: ['update:modelValue', 'confirm'],
  template: '<div v-if="modelValue" class="confirm-modal"><button class="confirm-yes" @click="$emit(\'confirm\')">{{ confirmLabel }}</button></div>',
};

function mountNoteModal(props: {
  mode: 'create' | 'edit';
  note?: { noteId: string; body: string } | null;
}) {
  const createNote = vi.fn(() => Promise.resolve());
  const updateNote = vi.fn(() => Promise.resolve());
  const deleteNote = vi.fn(() => Promise.resolve());
  vi.stubGlobal('useApi', () => ({ createNote, updateNote, deleteNote }));

  const wrapper = mount(NoteModal, {
    props: {
      modelValue: false,
      plantId: 'plant-1',
      mode: props.mode,
      note: props.note ?? null,
    },
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        UiModal: UiModalStub,
        UiAutosizeTextarea: UiAutosizeTextareaStub,
        UiButton: UiButtonStub,
        UiConfirmModal: UiConfirmModalStub,
      },
    },
  });
  return { wrapper, createNote, updateNote, deleteNote };
}

// Buttons are looked up by their (mocked) i18n key text rather than position, so a reordering of the
// footer's markup can't accidentally swap which assertion hits which button.
function findButtonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const btn = wrapper.findAll('button').find((b) => b.text() === text);
  if (!btn) throw new Error(`no button with text "${text}"`);
  return btn;
}

describe('NoteModal — create mode', () => {
  it('starts with a blank body and Guardar disabled', async () => {
    const { wrapper } = mountNoteModal({ mode: 'create' });
    await wrapper.setProps({ modelValue: true });

    expect((wrapper.get('.note-textarea').element as HTMLTextAreaElement).value).toBe('');
    const guardar = findButtonByText(wrapper, 'history.noteSave');
    expect((guardar.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Guardar once the body has non-whitespace text, and disables again for a whitespace-only body', async () => {
    const { wrapper } = mountNoteModal({ mode: 'create' });
    await wrapper.setProps({ modelValue: true });

    await wrapper.get('.note-textarea').setValue('   ');
    expect((findButtonByText(wrapper, 'history.noteSave').element as HTMLButtonElement).disabled).toBe(true);

    await wrapper.get('.note-textarea').setValue('Hello world');
    expect((findButtonByText(wrapper, 'history.noteSave').element as HTMLButtonElement).disabled).toBe(false);
  });

  it('never shows an Eliminar button in create mode', async () => {
    const { wrapper } = mountNoteModal({ mode: 'create' });
    await wrapper.setProps({ modelValue: true });
    expect(wrapper.findAll('button').some((b) => b.text() === 'history.noteDelete')).toBe(false);
  });

  it('clicking Guardar calls createNote(plantId, body) and emits saved', async () => {
    const { wrapper, createNote, updateNote } = mountNoteModal({ mode: 'create' });
    await wrapper.setProps({ modelValue: true });

    await wrapper.get('.note-textarea').setValue('A brand new note');
    await findButtonByText(wrapper, 'history.noteSave').trigger('click');
    await flushPromises();

    expect(createNote).toHaveBeenCalledWith('plant-1', 'A brand new note');
    expect(updateNote).not.toHaveBeenCalled();
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });
});

describe('NoteModal — edit mode', () => {
  const note = { noteId: 'n1', body: 'Existing note text' };

  it('seeds the body from the note prop when opened', async () => {
    const { wrapper } = mountNoteModal({ mode: 'edit', note });
    await wrapper.setProps({ modelValue: true });
    expect((wrapper.get('.note-textarea').element as HTMLTextAreaElement).value).toBe('Existing note text');
  });

  it('clicking Guardar calls updateNote(plantId, noteId, the edited body) and emits saved', async () => {
    const { wrapper, updateNote, createNote } = mountNoteModal({ mode: 'edit', note });
    await wrapper.setProps({ modelValue: true });

    await wrapper.get('.note-textarea').setValue('Existing note text, edited');
    await findButtonByText(wrapper, 'history.noteSave').trigger('click');
    await flushPromises();

    expect(updateNote).toHaveBeenCalledWith('plant-1', 'n1', 'Existing note text, edited');
    expect(createNote).not.toHaveBeenCalled();
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });

  it('the delete action, after the confirm step, calls deleteNote(plantId, noteId) and emits saved', async () => {
    const { wrapper, deleteNote } = mountNoteModal({ mode: 'edit', note });
    await wrapper.setProps({ modelValue: true });

    // Eliminar alone must NOT call the API yet — it only opens the confirm step.
    await findButtonByText(wrapper, 'history.noteDelete').trigger('click');
    expect(deleteNote).not.toHaveBeenCalled();

    await wrapper.get('.confirm-yes').trigger('click');
    await flushPromises();

    expect(deleteNote).toHaveBeenCalledWith('plant-1', 'n1');
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });
});
