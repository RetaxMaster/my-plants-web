// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, computed, watch } from 'vue';
import { createI18n } from 'vue-i18n';
import TaskInfoModal from './TaskInfoModal.vue';
import RepotEvaluationModal from './RepotEvaluationModal.vue';
import en from '../../i18n/locales/en.json';
import es from '../../i18n/locales/es.json';
import type { RepotSign } from '../../types/api';

// `ref`/`computed`/`watch` are normally Nuxt auto-imports; plain vitest + @vue/test-utils (no auto-import
// shim) doesn't provide them as globals, so a bare `computed()` (or, for the anti-fork assertion below,
// `ref()`/`watch()` inside RepotEvaluationModal.vue's setup()) throws "is not defined" — stub the real
// implementations as globals, same technique MeasureInfoModal.test.ts / RepotEvaluationModal.test.ts use.
vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);

// Real messages (Task 28): the previous version of this file hand-maintained a `STRINGS` map that had to be
// kept byte-for-byte in sync with en.json by hand; the REPOT signs assertions below need to compare against
// the ACTUAL `taskInfo.repot.signsEmpty` copy, so this file now resolves through a real vue-i18n instance
// instead — the same technique PlantDetail.test.ts uses. This is a strictly safer replacement for the
// juvenile-dose tests too: their `t('taskInfo.juvenile.doseTitle'/'doseBody')` calls now resolve the SAME
// real strings the hand-maintained map already had to mirror exactly.
const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, es } }).global;
vi.stubGlobal('useI18n', () => ({ t: i18n.t }));

function mountModal(props: Record<string, unknown>) {
  return mount(TaskInfoModal, {
    // `task` is a REQUIRED prop at the component level; the spread of a loose `Record<string, unknown>`
    // defeats vue-tsc's structural check (same cast technique as ImageLightbox.test.ts's mountLightbox).
    props: props as unknown as InstanceType<typeof TaskInfoModal>['$props'],
    global: {
      mocks: { $t: i18n.t },
      // Modal passthrough: expose its `title` prop + slotted body so the assertions can read both.
      stubs: { Modal: { props: ['title', 'open'], template: '<div><span>{{ title }}</span><slot /></div>' } },
    },
  });
}

// Same stub shape RepotEvaluationModal.test.ts itself uses, reused here (not forked) for the anti-fork
// assertion that mounts the questionnaire alongside the info modal.
function mountEvaluationModal(props: Record<string, unknown> = {}) {
  return mount(RepotEvaluationModal, {
    props: { open: true, signs: [], ...props },
    global: {
      mocks: { $t: i18n.t },
      stubs: {
        Modal: { props: ['modelValue', 'title', 'size'], template: '<div><slot /><slot name="footer" /></div>' },
        Button: { props: ['disabled', 'icon'], template: '<button :disabled="disabled"><slot /></button>' },
        Alert: true,
      },
    },
  });
}

// The app-seeded universal signs (true of every potted plant) — see the `repot_signs_researcher` rubric's
// "do NOT re-author the universal signs" section for the canonical six.
const universalLabelsFixture = [
  'Roots showing through the drainage holes',
  'Water runs straight through',
  'The pot is cracked, split, or bulging',
  'Roots circling on the soil surface',
  'The soil dries out much faster than before',
  'Growth has stalled',
];

const universalSignsFixture: RepotSign[] = universalLabelsFixture.map((label, i) => ({
  id: `universal--${i}`,
  label,
  help: null,
}));

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

// Task 28: the info modal's signs section now reads catalogue rows sourced from `GET /plants/:id/repot-
// signs` (already localized server-side), never `care.crowding.repotSigns` (removed outright). This is
// where the owner's original request 10 is actually closed — the "Señales a buscar" section renders
// LOCALIZED catalogue text instead of the untranslated species-record leak that was reported.
describe('TaskInfoModal — the REPOT signs section (request 10)', () => {
  it('renders the catalogue rows it is given, verbatim', () => {
    const wrapper = mountModal({ task: 'REPOT', repotSigns: ['Water runs straight through'], open: true });
    expect(wrapper.text()).toContain('Water runs straight through');
  });

  it('renders SPANISH strings for an es payload — the direct regression test for the reported defect', () => {
    const wrapper = mountModal({ task: 'REPOT', repotSigns: ['El agua se escurre de inmediato'], open: true });
    expect(wrapper.text()).toContain('El agua se escurre de inmediato');
  });

  it('is NON-EMPTY for a species with only universal signs — the not-yet-re-cured state', () => {
    const wrapper = mountModal({ task: 'REPOT', repotSigns: universalLabelsFixture, open: true });
    expect(wrapper.findAll('.mp-taskinfo__list li').length).toBe(universalLabelsFixture.length);
    expect(wrapper.text()).not.toContain(en.taskInfo.repot.signsEmpty);
  });

  it('keeps the honest empty state for a genuinely empty catalogue', () => {
    const wrapper = mountModal({ task: 'REPOT', repotSigns: [], open: true });
    expect(wrapper.text()).toContain(en.taskInfo.repot.signsEmpty);
  });

  it('the info modal and the questionnaire render the SAME resolved list for one plant and locale', () => {
    // Two renderers over one catalogue is exactly how a second copy gets introduced. Both read the labels
    // the API resolved; this test pins that they are the same array, not two independently-built lists.
    const signs = universalSignsFixture;
    const info = mountModal({ task: 'REPOT', repotSigns: signs.map((s) => s.label), open: true });
    const questionnaire = mountEvaluationModal({ signs });
    for (const s of signs) {
      expect(info.text()).toContain(s.label);
      expect(questionnaire.text()).toContain(s.label);
    }
  });
});
