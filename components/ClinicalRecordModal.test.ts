// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed, watch } from 'vue';
import { renderMarkdown } from '../utils/renderMarkdown.js';
import ClinicalRecordModal from './ClinicalRecordModal.vue';

// The modal's rendering contract, asserted at the seam it actually depends on. A clinical record body is
// AI-authored text possibly derived from untrusted web content, rendered in the owner's AUTHENTICATED
// session — the most privileged screen in the app. If this ever goes red, the modal has an XSS vector.
describe('ClinicalRecordModal body rendering', () => {
  it('renders a script tag inert', () => {
    const html = renderMarkdown('# Note\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('<h1>Note</h1>');
  });

  it('strips a javascript: link', () => {
    expect(renderMarkdown('[click](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('strips an onerror handler', () => {
    expect(renderMarkdown('<img src="x" onerror="alert(1)">')).not.toContain('onerror');
  });

  it('strips a class that could hijack app chrome', () => {
    expect(renderMarkdown('<span class="mp-savebar">overlay</span>')).not.toContain('mp-savebar');
  });
});

// Nuxt auto-imports (`ref`/`computed`/`watch`/`useI18n`/`useApi`) don't exist as globals outside Nuxt's
// build pipeline — same technique PlantProfileModal.test.ts / ProgressForm.test.ts use.
vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('useI18n', () => ({ t: (k: string, params?: Record<string, unknown>) => (params ? `${k}:${JSON.stringify(params)}` : k), d: (v: unknown) => String(v) }));

// `defineModel` (unnamed) compiles the shared `v-model="open"` down to the plain `modelValue` prop /
// `update:modelValue` event — mounting the component directly (bypassing the parent's `v-model` sugar)
// means driving that prop by its real name. It also starts FALSE and is flipped to true via `setProps`,
// mirroring real usage (the parent's `recordOpen` ref starts false too): the component's own
// `watch(() => [open.value, ...])` only fires on a CHANGE, exactly like the sibling `ProgressEntryModal`.
async function mountModal(getClinicalRecord: (plantId: string, recordId: string) => Promise<any>) {
  const spy = vi.fn(getClinicalRecord);
  vi.stubGlobal('useApi', () => ({ getClinicalRecord: spy }));
  const wrapper = mount(ClinicalRecordModal, {
    props: { modelValue: false, plantId: 'plant-1', recordId: 'rec-1' },
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        UiModal: { props: ['title'], template: '<div><slot /></div>' },
        UiProse: { props: ['html'], template: '<div class="prose" v-html="html" />' },
      },
    },
  });
  await wrapper.setProps({ modelValue: true });
  return { wrapper, spy };
}

// Plan §7's second row (spec 6.2 / plan Task 35): a 404 must read as "record is gone", never as an empty
// document. Mounted (not just unit-testing the fetch) so a regression that stops checking `statusCode`
// or stops rendering the `notFound` copy is caught here, not only by manual inspection.
describe('ClinicalRecordModal 404 handling', () => {
  it('shows the not-found state, not an empty document, when the fetch 404s', async () => {
    const { wrapper } = await mountModal(() => Promise.reject(Object.assign(new Error('not found'), { statusCode: 404 })));
    await flushPromises();
    expect(wrapper.text()).toContain('clinicalRecord.notFound');
    expect(wrapper.find('.prose').exists()).toBe(false);
  });

  it('shows the generic load-error state for a non-404 failure', async () => {
    const { wrapper } = await mountModal(() => Promise.reject(Object.assign(new Error('boom'), { statusCode: 500 })));
    await flushPromises();
    expect(wrapper.text()).toContain('clinicalRecord.loadError');
  });
});

// Wiring check: the recordId (and plantId) the timeline emits must be exactly what reaches the fetch —
// a wiring bug that drops/mismatches it would render the wrong record or nothing.
describe('ClinicalRecordModal request wiring', () => {
  it('fetches using the plantId + recordId props it was given', async () => {
    const { spy } = await mountModal(() => Promise.resolve({
      id: 'rec-1', recordedOn: '2026-07-20', createdAt: '2026-07-20T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z',
      body: 'hi', bodyChars: 2,
    }));
    await flushPromises();
    expect(spy).toHaveBeenCalledWith('plant-1', 'rec-1');
  });
});
