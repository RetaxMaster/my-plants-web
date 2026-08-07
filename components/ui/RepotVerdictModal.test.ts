// @vitest-environment happy-dom
//
// QA round 3 found this component telling the owner something untrue. "I couldn't check it" and "No signs
// yet" both come back from the server as the SAME `RE-EVALUATE` verdict — correctly, since neither says
// the plant needs repotting — and this modal rendered the SAME sentence for both: "Nothing you saw says it
// needs repotting yet." Said to an owner who has just explicitly stated they did NOT look, that credits
// them with an observation they told us they never made.
//
// The verdict payload deliberately carries no echo of the question, so the distinction is supplied by the
// client from the completion record's own frozen request body (`useRepotAttempt.ts`'s `RepotCompletion`).
// That keeps it a display concern: no API contract changed to fix a sentence.
import { describe, it, expect, vi } from 'vitest';
import { computed } from 'vue';
import { mount } from '@vue/test-utils';
import RepotVerdictModal from './RepotVerdictModal.vue';

vi.stubGlobal('computed', computed);
vi.stubGlobal('useI18n', () => ({
  // Passthrough that also renders the interpolation, so a test can tell "the date reached the string" from
  // "the key was merely selected".
  t: (k: string, params?: Record<string, unknown>) => (params?.date ? `${k}|${params.date}` : k),
  d: (date: Date) => date.toISOString().slice(0, 10),
}));

const stubs = {
  Modal: {
    props: ['modelValue', 'title'],
    template: '<div data-modal-stub v-if="modelValue"><h1>{{ title }}</h1><slot /><slot name="footer" /></div>',
  },
  Button: { props: ['color', 'variant'], template: '<button><slot /></button>' },
};

function mountModal(props: Record<string, unknown>) {
  return mount(RepotVerdictModal, {
    props: { open: true, result: null, ...props },
    global: { mocks: { $t: (k: string) => k }, stubs },
  });
}

const reevaluate = { verdict: 'RE-EVALUATE' as const, reevaluateOn: '2026-08-04' };

describe('RepotVerdictModal — the RE-EVALUATE wording depends on WHICH answer produced it (QA round 3)', () => {
  it('a "could-not-check" answer gets its OWN sentence — never the "nothing you saw" one, which asserts ' +
    'an observation the owner explicitly did not make', () => {
    const w = mountModal({ result: reevaluate, answer: 'could-not-check' });
    expect(w.text()).toContain('repotEval.verdictCouldNotCheckBody|2026-08-04');
    expect(w.text()).toContain('repotEval.verdictCouldNotCheckTitle');
    expect(w.text()).not.toContain('repotEval.verdictReevaluateBody');
    expect(w.text()).not.toContain('repotEval.verdictReevaluateTitle');
  });

  it('a "no-signs" answer keeps the original wording — the owner DID look, and "nothing you saw" is true', () => {
    const w = mountModal({ result: reevaluate, answer: 'no-signs' });
    expect(w.text()).toContain('repotEval.verdictReevaluateBody|2026-08-04');
    expect(w.text()).toContain('repotEval.verdictReevaluateTitle');
    expect(w.text()).not.toContain('repotEval.verdictCouldNotCheck');
    // …and not the round-4 checked-signs sentence either: "nothing you saw" is TRUE here, and replacing it
    // with "we've noted what you saw" would be the mirror-image lie.
    expect(w.text()).not.toContain('repotEval.verdictSignsReevaluateBody');
  });

  // QA round 4 REWROTE this case. It used to assert the OPPOSITE — that a "signs" answer keeps the
  // original wording, "which is exactly what that sentence describes". It is not: the sentence opens with
  // "Nothing you saw", and this owner saw something and said so. The engine's verdict is right (ticked
  // signs below the needed threshold really are inconclusive) and the engine is NOT touched here; only the
  // sentence was wrong, and it was wrong in the direction that makes the app look like it discarded the
  // answer the owner just gave it.
  it('a "signs" answer that still came back RE-EVALUATE gets its OWN sentence — never the "nothing you ' +
    'saw" one, which denies an observation the owner explicitly made', () => {
    const w = mountModal({ result: reevaluate, answer: 'signs' });
    expect(w.text()).toContain('repotEval.verdictSignsReevaluateBody|2026-08-04');
    // The exact regression: the "nothing you saw" sentence must not survive on this branch. Asserted as a
    // NEGATIVE on the old key because that is the string QA actually read on screen.
    expect(w.text()).not.toContain('repotEval.verdictReevaluateBody');
    expect(w.text()).not.toContain('repotEval.verdictCouldNotCheckBody');
    // The TITLE is deliberately shared with the "no signs" branch — "Not yet, we'll ask again" is true of
    // both — so this pins that the fix did not fork it into a second identical string.
    expect(w.text()).toContain('repotEval.verdictReevaluateTitle');
  });

  it('falls back to the original wording when no answer is supplied at all — an un-updated caller is no ' +
    'worse off than before the fix', () => {
    const w = mountModal({ result: reevaluate });
    expect(w.text()).toContain('repotEval.verdictReevaluateBody|2026-08-04');
    expect(w.text()).not.toContain('repotEval.verdictSignsReevaluateBody');
  });

  it('never applies the could-not-check wording to a REPOT verdict — that branch has one sentence, and a ' +
    'could-not-check answer cannot produce it anyway', () => {
    const w = mountModal({ result: { verdict: 'REPOT', reevaluateOn: undefined }, answer: 'could-not-check' });
    expect(w.text()).toContain('repotEval.verdictRepotBody');
    expect(w.text()).toContain('repotEval.verdictRepotTitle');
    expect(w.text()).not.toContain('repotEval.verdictCouldNotCheck');
  });
});
