// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed } from 'vue';
import MeasureInfoModal from './MeasureInfoModal.vue';

// `computed` is normally a Nuxt auto-import; plain vitest + @vue/test-utils (no auto-import shim) doesn't
// provide that global, so a bare `computed()` call inside the component's setup() throws "computed is not
// defined" — stub the real implementation as a global, same technique ProgressForm.test.ts uses.
vi.stubGlobal('computed', computed);

// Only these measure.* keys "exist" → drives the specific-vs-generic fallback deterministically.
const KNOWN = new Set(['measure.trailing.title', 'measure.trailing.body', 'measure.generic.title', 'measure.generic.body']);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, te: (k: string) => KNOWN.has(k) }));

function mountModal(props: Record<string, unknown>) {
  return mount(MeasureInfoModal, {
    props,
    global: {
      mocks: { $t: (k: string) => k },
      // Modal passthrough: expose its `title` prop + slotted body so the assertions can read both.
      stubs: { Modal: { props: ['title', 'open'], template: '<div><span>{{ title }}</span><slot /></div>' } },
    },
  });
}

describe('MeasureInfoModal', () => {
  it('renders the species-specific guide when growthHabit has an entry', () => {
    const w = mountModal({ growthHabit: 'trailing', open: true });
    expect(w.text()).toContain('measure.trailing.title');
    expect(w.text()).toContain('measure.trailing.body');
    expect(w.text()).not.toContain('measure.generic');
  });

  it('falls back to the generic guide when growthHabit is null', () => {
    const w = mountModal({ growthHabit: null, open: true });
    expect(w.text()).toContain('measure.generic.title');
    expect(w.text()).toContain('measure.generic.body');
  });

  it('falls back to generic when growthHabit has no i18n entry (defensive — never a raw key or English)', () => {
    const w = mountModal({ growthHabit: 'zzz' as never, open: true });
    expect(w.text()).toContain('measure.generic.title');
    expect(w.text()).not.toContain('measure.zzz');
  });
});
