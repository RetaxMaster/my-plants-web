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

// Owner request, 2026-08-07. When the verdict is RE-EVALUATE and the owner DID tick signs, the copy above
// (correctly, since QA round 4) says what they saw counts but is not enough on its own. What it never said
// is what WOULD move the answer — even though the model knows: docs/care-engine.md §7.17 defines `strong`
// as "reliable, but worth confirming with one more". That reasoning being invisible is what made a flat
// "not yet" read as the app ignoring the owner.
//
// PRESENTATION ONLY: no engine input, no score, no verdict, no stored value, no request body. The modal
// posts nothing — it subtracts the ticked ids from the catalogue the questionnaire already fetched.
//
// QA round 5, finding 2 rewrote WHICH sign is named. The catalogue below now mirrors a real one: the
// universal (app-seeded) rows every species inherits, plus one of THIS species' own curated rows. The
// species row is placed AFTER the universal `strong` deliberately, so only the species preference — never
// catalogue order — can be what puts it first.
const catalogue = [
  { id: 'universal--water-runs-through', label: 'Water runs straight through', help: null, evidence: 'strong' as const },
  { id: 'nephrolepis-exaltata--crowded-clump', label: 'Several crowns pressed together', help: null, evidence: 'strong' as const },
  { id: 'universal--single-root', label: 'A single root is peeking out', help: null, evidence: 'suggestive' as const },
  { id: 'universal--pot-split', label: 'The pot is cracked or split', help: null, evidence: 'definitive' as const },
  { id: 'universal--growth-stalled', label: 'Growth has clearly slowed', help: null, evidence: 'ambiguous' as const },
];

describe('RepotVerdictModal — naming a corroborating sign to go and look for', () => {
  // REWRITTEN by QA round 5, finding 2. It used to assert the DEFINITIVE sign was named ("The pot is
  // cracked or split"), which was the defect: `definitive` decides rather than corroborates, it is always
  // unticked on this branch, and it therefore won every time — 5 of 5 measured verdicts across 4 species
  // returned that same sentence.
  it('names the strongest CORROBORATING sign — this species\' own first, and never the definitive one', () => {
    const w = mountModal({
      result: reevaluate, answer: 'signs',
      signs: catalogue, checkedSignIds: ['universal--single-root'],
    });
    expect(w.text()).toContain('repotEval.verdictCorroborateLead');
    expect(w.text()).toContain('Several crowns pressed together'); // strong, and this species' own
    expect(w.text()).not.toContain('The pot is cracked or split'); // definitive: decides, never corroborates
    // The verdict copy is not replaced — the suggestion is an addition to it, never a substitute.
    expect(w.text()).toContain('repotEval.verdictSignsReevaluateBody|2026-08-04');
  });

  it('falls back to a UNIVERSAL sign of the same rank once this species\' own is ticked', () => {
    const w = mountModal({
      result: reevaluate, answer: 'signs',
      signs: catalogue, checkedSignIds: ['nephrolepis-exaltata--crowded-clump'],
    });
    expect(w.text()).toContain('Water runs straight through');
  });

  it('never suggests a sign the owner already checked', () => {
    const w = mountModal({
      result: reevaluate, answer: 'signs',
      signs: catalogue,
      checkedSignIds: ['nephrolepis-exaltata--crowded-clump', 'universal--water-runs-through'],
    });
    expect(w.text()).toContain('A single root is peeking out'); // suggestive, the strongest left
    expect(w.text()).not.toContain('Water runs straight through');
  });

  it('says nothing when the only unticked sign left is the DEFINITIVE one — silence beats useless advice', () => {
    const w = mountModal({
      result: reevaluate, answer: 'signs', signs: catalogue,
      checkedSignIds: catalogue.filter((s) => s.evidence !== 'definitive').map((s) => s.id),
    });
    expect(w.text()).not.toContain('repotEval.verdictCorroborateLead');
    expect(w.text()).not.toContain('The pot is cracked or split');
    expect(w.text()).toContain('repotEval.verdictSignsReevaluateBody|2026-08-04');
  });

  it('says nothing when the owner has ticked EVERY sign there is — the ordinary copy alone is a complete answer', () => {
    const w = mountModal({
      result: reevaluate, answer: 'signs', signs: catalogue, checkedSignIds: catalogue.map((s) => s.id),
    });
    expect(w.text()).not.toContain('repotEval.verdictCorroborateLead');
    expect(w.text()).toContain('repotEval.verdictSignsReevaluateBody|2026-08-04');
  });

  it('still names one when only AMBIGUOUS signs remain unchecked — not a consolation prize: `strong` ' +
    '(0.60) + `ambiguous` (0.15) lands exactly on SIGN_NEEDED_THRESHOLD (0.75) per §7.17, so it is a real ' +
    'thing to go and check', () => {
    const w = mountModal({
      result: reevaluate, answer: 'signs', signs: catalogue,
      checkedSignIds: [
        'universal--water-runs-through',
        'nephrolepis-exaltata--crowded-clump',
        'universal--single-root',
      ],
    });
    expect(w.text()).toContain('Growth has clearly slowed');
  });

  it('handles a single-sign catalogue: the one sign when it is unchecked, silence when it is the one ticked', () => {
    const one = [catalogue[0]];
    expect(mountModal({ result: reevaluate, answer: 'signs', signs: one, checkedSignIds: [] }).text())
      .toContain('Water runs straight through');
    expect(mountModal({ result: reevaluate, answer: 'signs', signs: one, checkedSignIds: [one[0].id] }).text())
      .not.toContain('repotEval.verdictCorroborateLead');
  });

  // Scoped to the checked-signs branch on purpose, and each exclusion has its own reason — see the
  // component's `suggestedSign` comment. Asserted as a set so a future branch cannot quietly acquire it.
  it('appears on NO other branch — not on a REPOT verdict, not on "no signs", not on "could not check"', () => {
    for (const props of [
      { result: { verdict: 'REPOT' as const, reevaluateOn: undefined }, answer: 'signs' as const },
      { result: reevaluate, answer: 'no-signs' as const },
      { result: reevaluate, answer: 'could-not-check' as const },
      { result: reevaluate }, // no answer supplied at all — the un-updated-caller fallback
    ]) {
      const w = mountModal({ ...props, signs: catalogue, checkedSignIds: [] });
      expect(w.text(), JSON.stringify(props)).not.toContain('repotEval.verdictCorroborateLead');
    }
  });

  it('is silent, never broken, for a caller that passes no catalogue at all', () => {
    const w = mountModal({ result: reevaluate, answer: 'signs' });
    expect(w.text()).toContain('repotEval.verdictSignsReevaluateBody|2026-08-04');
    expect(w.text()).not.toContain('repotEval.verdictCorroborateLead');
  });
});
