// @vitest-environment happy-dom
//
// Same house pattern as SegmentedControl.test.ts: outside Nuxt's build pipeline, the auto-imports FormGroup.vue
// relies on (`computed`, `provide`, `useId`) don't exist, so they are stubbed onto globalThis with Vue's own
// implementations — real enough that provide()/inject() resolve exactly as they do in the app.
import { describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, inject, provide, ref } from 'vue';
import { mount } from '@vue/test-utils';
import FormGroup, { FORM_GROUP_ERROR_KEY } from './FormGroup.vue';

vi.stubGlobal('computed', computed);
vi.stubGlobal('provide', provide);
vi.stubGlobal('useId', () => 'field-id');

describe('FormGroup', () => {
  it('renders the hint when there is no error', () => {
    const w = mount(FormGroup, { props: { label: 'X', hint: 'a hint' } });
    expect(w.find('.mp-form-group__hint').text()).toBe('a hint');
    expect(w.find('.mp-form-group__error').exists()).toBe(false);
  });

  it('renders the error INSTEAD of the hint when both are given — never both at once', () => {
    const w = mount(FormGroup, { props: { label: 'X', hint: 'a hint', error: 'bad value' } });
    expect(w.find('.mp-form-group__error').text()).toBe('bad value');
    expect(w.find('.mp-form-group__hint').exists()).toBe(false);
  });
});

// F7a (QA 2026-08-15) — the wire an Input-family field relies on to know it sits under a visible error.
// Verified directly against FORM_GROUP_ERROR_KEY here (rather than only through Input.vue, see Input.test.ts)
// so this file fails on its own if FormGroup ever stops providing, independent of anything Input.vue does
// with the injected value.
describe('FormGroup — provides its error via FORM_GROUP_ERROR_KEY', () => {
  const Probe = defineComponent({
    setup() {
      const injected = inject(FORM_GROUP_ERROR_KEY, undefined);
      return () => h('span', { class: 'probe' }, injected?.value ?? 'NONE');
    },
  });

  it('an injecting child sees the current error value, and sees it update reactively', async () => {
    const error = ref<string | undefined>(undefined);
    const w = mount(
      defineComponent({
        components: { FormGroup, Probe },
        setup: () => ({ error }),
        template: '<FormGroup label="X" :error="error"><Probe /></FormGroup>',
      }),
    );
    // Positive control (nothing provided yet) BEFORE the positive case below — proves the probe reads the
    // live value rather than a value frozen at mount.
    expect(w.find('.probe').text()).toBe('NONE');

    error.value = 'now invalid';
    await w.vm.$nextTick();
    expect(w.find('.probe').text()).toBe('now invalid');
  });

  it('an injecting child outside any FormGroup gets the declared default (undefined) — never throws', () => {
    const w = mount(Probe);
    expect(w.find('.probe').text()).toBe('NONE');
  });
});
