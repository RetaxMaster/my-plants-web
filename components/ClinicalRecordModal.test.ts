// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed, watch } from 'vue';
import { renderMarkdown } from '../utils/renderMarkdown.js';
import ClinicalRecordModal from './ClinicalRecordModal.vue';
import UiProse from './ui/Prose.vue';

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
// UiModal is stubbed (Teleport-to-body + focus-trap plumbing is irrelevant here and complicates
// `wrapper.html()`), but UiProse is the REAL component — it is the actual `v-html` sink this modal
// renders through in production, and the whole point of the tests below is to prove the SANITIZED
// pipeline is what reaches it, not to assert it in the abstract via a passthrough stub.
async function mountModal(getClinicalRecord: (plantId: string, recordId: string) => Promise<any>) {
  const spy = vi.fn(getClinicalRecord);
  vi.stubGlobal('useApi', () => ({ getClinicalRecord: spy }));
  const wrapper = mount(ClinicalRecordModal, {
    props: { modelValue: false, plantId: 'plant-1', recordId: 'rec-1' },
    global: {
      mocks: { $t: (k: string) => k },
      // `UiModal` is auto-registered by Nuxt in the real app; here it must be provided explicitly. It is
      // stubbed to a plain passthrough (Teleport-to-body + focus-trap plumbing is irrelevant to these
      // assertions and complicates `wrapper.html()`). `UiProse` is registered as the REAL component
      // (never stubbed) — it is the actual `v-html` sink the modal renders through in production, and an
      // unresolved/stubbed `UiProse` would make every assertion below pass for the wrong reason (nothing
      // would actually be rendered as HTML).
      components: { UiProse },
      stubs: {
        UiModal: { props: ['title'], template: '<div><slot /></div>' },
      },
    },
  });
  await wrapper.setProps({ modelValue: true });
  return { wrapper, spy };
}

async function mountWithBody(body: string) {
  const { wrapper } = await mountModal(() => Promise.resolve({
    id: 'rec-1', recordedOn: '2026-07-20', createdAt: '2026-07-20T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z',
    body, bodyChars: body.length,
  }));
  await flushPromises();
  return wrapper;
}

// The unit tests above prove `renderMarkdown` itself sanitizes. They do NOT prove this COMPONENT calls
// it — a copy-paste from the blog's `renderArticle`, or a stray `v-html="record.body"`, would typecheck
// and leave every one of those unit tests green, because they never touch the component at all. These
// tests mount the real modal (real `UiProse`, real `v-html` sink) and assert on the ACTUAL rendered DOM,
// so a substitution of the render path is caught here even though the underlying sanitizer is identical.
describe('ClinicalRecordModal mounted rendering — the actual pipeline, not just the util', () => {
  it('renders a script tag inert in the mounted output', async () => {
    const wrapper = await mountWithBody('# Note\n\n<script>alert(1)</script>');
    expect(wrapper.html()).not.toContain('<script');
  });

  it('strips a javascript: link in the mounted output', async () => {
    const wrapper = await mountWithBody('[click](javascript:alert(1))');
    expect(wrapper.html()).not.toContain('javascript:');
  });

  it('strips an onerror handler in the mounted output', async () => {
    const wrapper = await mountWithBody('<img src="x" onerror="alert(1)">');
    expect(wrapper.html()).not.toContain('onerror');
  });

  it('strips a class that could hijack app chrome in the mounted output', async () => {
    const wrapper = await mountWithBody('<span class="mp-savebar">overlay</span>');
    expect(wrapper.html()).not.toContain('mp-savebar');
  });

  // Distinguishes `renderMarkdown` (this modal — no TOC, spec §6.2) from `renderArticle` (the blog's
  // TOC-emitting variant): `renderArticle` assigns a slugified `id` to every h2/h3 so the article's
  // TOC/scroll-spy can anchor to it, while `renderMarkdown`'s ALLOWED_ATTR never includes `id` at all —
  // a heading rendered through THIS modal can never carry one. An accidental `renderArticle(...).html`
  // substitution (which still sanitizes, so the XSS cases above would stay green) starts emitting
  // `id="..."` on the h2 below; this is the one observable difference that catches it.
  it('never emits a heading id — the renderArticle TOC behavior does not belong here', async () => {
    const wrapper = await mountWithBody('## Section title');
    const h2 = wrapper.find('h2');
    expect(h2.exists()).toBe(true);
    expect(h2.attributes('id')).toBeUndefined();
  });
});

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
// a wiring bug that drops/mismatches it would render the wrong record or nothing. Also asserts the CALL
// COUNT (not just the args): a duplicated watch registration would still call the fetch with the right
// arguments, just twice — `toHaveBeenCalledWith` alone can't see that, `toHaveBeenCalledTimes` can.
describe('ClinicalRecordModal request wiring', () => {
  it('fetches exactly once, using the plantId + recordId props it was given', async () => {
    const { spy } = await mountModal(() => Promise.resolve({
      id: 'rec-1', recordedOn: '2026-07-20', createdAt: '2026-07-20T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z',
      body: 'hi', bodyChars: 2,
    }));
    await flushPromises();
    expect(spy).toHaveBeenCalledWith('plant-1', 'rec-1');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// Reopen the SAME modal instance (spec: the parent never remounts it, it just flips `recordOpen` /
// `activeRecordId` — see pages/plants/[id]/index.vue's openRecord). A failed load must not leave a stale
// `loadError` that permanently masks a later record that DOES load successfully.
describe('ClinicalRecordModal reopened with a different record', () => {
  it('does not let a stale loadError survive into a reopen that succeeds', async () => {
    const spy = vi.fn((_: string, recordId: string) => (
      recordId === 'rec-1'
        ? Promise.reject(Object.assign(new Error('boom'), { statusCode: 500 }))
        : Promise.resolve({
          id: recordId, recordedOn: '2026-07-20', createdAt: '2026-07-20T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z',
          body: '# Recovered', bodyChars: 11,
        })
    ));
    vi.stubGlobal('useApi', () => ({ getClinicalRecord: spy }));
    const wrapper = mount(ClinicalRecordModal, {
      props: { modelValue: false, plantId: 'plant-1', recordId: 'rec-1' },
      global: {
        mocks: { $t: (k: string) => k },
        components: { UiProse },
        stubs: { UiModal: { props: ['title'], template: '<div><slot /></div>' } },
      },
    });

    // Open on rec-1: fails.
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    expect(wrapper.text()).toContain('clinicalRecord.loadError');

    // Close, then reopen on a DIFFERENT record that succeeds.
    await wrapper.setProps({ modelValue: false });
    await wrapper.setProps({ recordId: 'rec-2', modelValue: true });
    await flushPromises();

    expect(wrapper.text()).not.toContain('clinicalRecord.loadError');
    expect(wrapper.html()).toContain('Recovered');
  });
});
