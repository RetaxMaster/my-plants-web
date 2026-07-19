// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, inject } from 'vue';
import AgentSkipPermissions from './AgentSkipPermissions.vue';
import RealSwitch from './ui/Switch.vue';

vi.stubGlobal('computed', computed);
vi.stubGlobal('inject', inject); // the real UiSwitch injects a FormGroup field id
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

const AlertStub = {
  props: ['color', 'title', 'description'],
  template: '<div class="alert" :data-color="color">{{ title }} {{ description }}</div>',
};

function mountSwitch(props: Record<string, unknown> = {}) {
  return mount(AgentSkipPermissions, {
    props: { modelValue: false, i18nNamespace: 'diagnose', ...props },
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        UiAlert: AlertStub,
        UiSwitch: {
          props: ['modelValue', 'disabled'],
          emits: ['update:modelValue'],
          template: '<button class="sw" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />',
        },
      },
    },
  });
}

// Mounts against the REAL UiSwitch. The stub above cannot exhibit the behaviour these tests exist to
// pin — it is a pure function of its prop, whereas the real component uses `defineModel`, which flips
// its own local value OPTIMISTICALLY without waiting for the parent. Testing only against the stub would
// prove the invariant holds in a world where the primitive already guarantees it.
function mountReal(props: Record<string, unknown> = {}) {
  return mount(AgentSkipPermissions, {
    props: { modelValue: false, i18nNamespace: 'diagnose', ...props },
    global: { mocks: { $t: (k: string) => k }, stubs: { UiAlert: AlertStub }, components: { UiSwitch: RealSwitch } },
  });
}

describe('AgentSkipPermissions', () => {
  it('is off by default and shows no active warning', () => {
    const w = mountSwitch();
    expect(w.find('.alert').exists()).toBe(false);
    expect(w.text()).toContain('diagnose.skipPermissions.label');
  });

  // §6.4: "The mode is always visible while active — a silent auto-approve mode is a trap."
  it('renders a persistent warning while active', () => {
    const w = mountSwitch({ modelValue: true });
    const alert = w.find('.alert');
    expect(alert.exists()).toBe(true);
    expect(alert.attributes('data-color')).toBe('red');
    expect(alert.text()).toContain('diagnose.skipPermissions.activeTitle');
    expect(alert.text()).toContain('diagnose.skipPermissions.activeBody');
  });

  // The warning is not dismissible and does not depend on any local state: it is a pure function of the
  // SERVER's value, so nothing the owner does can hide it while the gate is genuinely off.
  it('keeps the warning visible regardless of busy/error state', () => {
    for (const extra of [{ busy: true }, { errorMessage: 'x' }, { disabled: true }]) {
      expect(mountSwitch({ modelValue: true, ...extra }).find('.alert').exists()).toBe(true);
    }
  });

  it('emits the requested value instead of self-toggling (the server is authoritative)', async () => {
    const w = mountSwitch();
    await w.find('.sw').trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([[true]]);
    // It did NOT flip its own rendering — the parent re-renders it once the API confirms.
    expect(w.find('.alert').exists()).toBe(false);
  });

  it('locks the switch while a change is in flight or the session does not exist yet', () => {
    expect(mountSwitch({ busy: true }).find('.sw').attributes('disabled')).toBeDefined();
    expect(mountSwitch({ disabled: true }).find('.sw').attributes('disabled')).toBeDefined();
  });

  it('emits nothing while locked', async () => {
    const w = mountSwitch({ busy: true });
    await w.find('.sw').trigger('click');
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });

  it('renders a failure message when the toggle could not be saved', () => {
    const w = mountSwitch({ errorMessage: 'diagnose.skipPermissions.error' });
    expect(w.text()).toContain('diagnose.skipPermissions.error');
    expect(w.find('[role="alert"]').exists()).toBe(true);
  });
});

// These are the tests that actually defend the invariant, because they run against the primitive whose
// optimistic behaviour is the threat.
describe('AgentSkipPermissions — the real UiSwitch never outranks the server', () => {
  it('shows the server value, not the click, when the request FAILED', async () => {
    // The dangerous direction: auto-approve is ON server-side and the owner tries to turn it OFF.
    const w = mountReal({ modelValue: true });
    expect(w.find('[role="switch"]').attributes('aria-checked')).toBe('true');

    await w.find('[role="switch"]').trigger('click'); // the real switch flips ITSELF to off here
    expect(w.emitted('update:modelValue')).toEqual([[false]]);

    // The parent's PATCH failed: the server value is unchanged and an error arrives.
    await w.setProps({ busy: false, errorMessage: 'diagnose.skipPermissions.error' });

    // Without a re-sync the knob would read OFF while the doctor is still auto-applying every change —
    // the owner would believe they are supervising when they are not.
    expect(w.find('[role="switch"]').attributes('aria-checked')).toBe('true');
    expect(w.find('.alert').exists()).toBe(true);
  });

  it('follows the server when the request SUCCEEDED', async () => {
    const w = mountReal({ modelValue: false });
    await w.find('[role="switch"]').trigger('click');
    await w.setProps({ modelValue: true }); // the API confirmed
    expect(w.find('[role="switch"]').attributes('aria-checked')).toBe('true');
    expect(w.find('.alert').exists()).toBe(true);
  });

  it('does not let a stale optimistic flip survive a later error on an unrelated field', async () => {
    const w = mountReal({ modelValue: false });
    await w.find('[role="switch"]').trigger('click'); // optimistically ON
    await w.setProps({ errorMessage: 'diagnose.skipPermissions.error' }); // PATCH failed, server still off
    expect(w.find('[role="switch"]').attributes('aria-checked')).toBe('false');
    expect(w.find('.alert').exists()).toBe(false); // and no "approvals are off" claim
  });
});
