// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ConfirmModal from './ConfirmModal.vue';

// `useI18n` is a Nuxt auto-import the component calls for the default cancel label; stub it (return the key).
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

function mountConfirm() {
  return mount(ConfirmModal, {
    props: {
      modelValue: true,
      title: 'progress.deleteTitle',
      message: 'progress.deleteConfirm',
      confirmLabel: 'progress.delete',
      confirmIcon: 'trash',
    },
    global: {
      // Passthrough UiModal: render its title + default + footer slots so the confirm/cancel buttons exist.
      stubs: {
        UiModal: { props: ['modelValue', 'title'], template: '<div class="modal"><h2>{{ title }}</h2><slot /><div class="footer"><slot name="footer" /></div></div>' },
        // Real-ish UiButton: a native <button>; the parent's @click falls through to it (no explicit $emit,
        // which would double-fire alongside the native fallthrough).
        UiButton: { template: '<button class="btn" type="button"><slot /></button>' },
        UiAppIcon: true,
      },
    },
  });
}

// Footer buttons in order: [0] = Cancel, [1] = Confirm.
function cancelBtn(w: ReturnType<typeof mountConfirm>) { return w.findAll('.btn')[0]; }
function confirmBtn(w: ReturnType<typeof mountConfirm>) { return w.findAll('.btn')[1]; }

describe('UiConfirmModal', () => {
  it('renders the localized title + message and the confirm label (via UiModal, not window.confirm)', () => {
    const w = mountConfirm();
    expect(w.text()).toContain('progress.deleteTitle');
    expect(w.text()).toContain('progress.deleteConfirm');
    expect(w.text()).toContain('progress.delete');
    expect(w.text()).toContain('common.cancel'); // default cancel label
  });

  it('Cancel dismisses WITHOUT confirming (v-model false, no @confirm)', async () => {
    const w = mountConfirm();
    await cancelBtn(w).trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false]);
    expect(w.emitted('confirm')).toBeUndefined(); // cancel must never commit
  });

  it('Confirm emits @confirm and closes (v-model false)', async () => {
    const w = mountConfirm();
    await confirmBtn(w).trigger('click');
    expect(w.emitted('confirm')).toHaveLength(1);
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });
});
