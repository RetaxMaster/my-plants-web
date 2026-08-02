// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed } from 'vue';
import TaskInfoModal from './TaskInfoModal.vue';

// `computed` is normally a Nuxt auto-import; plain vitest + @vue/test-utils (no auto-import shim) doesn't
// provide that global, so a bare `computed()` call inside the component's setup() throws "computed is not
// defined" — stub the real implementation as a global, same technique MeasureInfoModal.test.ts uses.
vi.stubGlobal('computed', computed);

// A minimal real-string map for the keys this suite cares about (the juvenile dose warning); every other
// key falls back to itself so an assertion against '1/4 to 1/2' can only be satisfied by the warning body.
const STRINGS: Record<string, string> = {
  'taskInfo.juvenile.doseTitle': 'This plant is still young',
  'taskInfo.juvenile.doseBody':
    'Label doses are formulated for mature plants. While this plant is young, feed at 1/4 to 1/2 the strength on the bottle — full strength burns delicate roots. Keep the same schedule; only the dose changes.',
};
vi.stubGlobal('useI18n', () => ({ t: (k: string) => STRINGS[k] ?? k }));

function mountModal(props: Record<string, unknown>) {
  return mount(TaskInfoModal, {
    // `task` is a REQUIRED prop at the component level; the spread of a loose `Record<string, unknown>`
    // defeats vue-tsc's structural check (same cast technique as ImageLightbox.test.ts's mountLightbox).
    props: props as unknown as InstanceType<typeof TaskInfoModal>['$props'],
    global: {
      mocks: { $t: (k: string) => k },
      // Modal passthrough: expose its `title` prop + slotted body so the assertions can read both.
      stubs: { Modal: { props: ['title', 'open'], template: '<div><span>{{ title }}</span><slot /></div>' } },
    },
  });
}

describe('TaskInfoModal — the juvenile dose warning (Spec 2 §7.3)', () => {
  it('shows the dose warning on FERTILIZE for a juvenile plant', () => {
    const w = mountModal({ task: 'FERTILIZE', isJuvenile: true, open: true });
    expect(w.text()).toContain('1/4 to 1/2');
  });

  it('does NOT show it for a non-juvenile plant', () => {
    const w = mountModal({ task: 'FERTILIZE', isJuvenile: false, open: true });
    expect(w.text()).not.toContain('1/4 to 1/2');
  });

  it('does NOT show it on any other task, even for a juvenile', () => {
    for (const task of ['WATER', 'REPOT', 'ROTATE', 'CLEAN_LEAVES']) {
      const w = mountModal({ task, isJuvenile: true, open: true });
      expect(w.text()).not.toContain('1/4 to 1/2');
    }
  });

  it('treats an ABSENT isJuvenile as "unknown", never as true', () => {
    const w = mountModal({ task: 'FERTILIZE', open: true });
    expect(w.text()).not.toContain('1/4 to 1/2');
  });
});
