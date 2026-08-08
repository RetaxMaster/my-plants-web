<script setup lang="ts">
// Shows the verdict returned by a REPOT evaluation submit (the RepotEvaluationModal.vue flow, spec F.7 /
// repoteval:25). A 'REPOT' verdict is what unlocks the classic Done | Postpone on the Today card (Task
// 27's state machine); a 'RE-EVALUATE' verdict tells the owner nothing needs doing yet and names the date
// we'll ask again. Display-only — it never posts anything, so it carries no submitting/idempotency state.
import type { RepotEvaluationResult, RepotEvaluationSubmit, RepotSign } from '~/types/api';
import { ymdToLocalDate } from '~/utils/localDate';
import { corroboratingSign } from '~/utils/repotEvaluation';
import Modal from './Modal.vue';
import Button from './Button.vue';

const props = defineProps<{
  result: RepotEvaluationResult | null;
  /**
   * What the owner ANSWERED, from the completion record's frozen request body. Optional, and an absent /
   * null value falls back to the "no signs" wording — the wording that was shown unconditionally before,
   * so a caller that has not been updated is no worse off than it was.
   */
  answer?: RepotEvaluationSubmit['answer'] | null;
  /**
   * The catalogue the questionnaire was answered against, and the ids the owner ticked — both already held
   * by the caller (the fetched signs, and the completion record's frozen request body). Used for ONE thing:
   * naming a corroborating sign to go and look for. Optional; absent means no suggestion, never a wrong one.
   */
  signs?: RepotSign[] | null;
  checkedSignIds?: string[] | null;
}>();
const open = defineModel<boolean>('open', { default: false });

const { t, d } = useI18n();

const isRepot = computed(() => props.result?.verdict === 'REPOT');
// QA round-3. "I couldn't check it" used to be answered with the "no signs" sentence — "Nothing you saw
// says it needs repotting yet" — told to an owner who explicitly said they had NOT looked. The verdict
// itself is right (both answers re-ask, and `could-not-check` contributes no likelihood factor at all, so
// it re-asks on the short logistics floor rather than on a recomputed schedule); only the sentence was
// wrong, and it was wrong in the one direction that matters: it credits the owner with an observation they
// told us they did not make.
const isCouldNotCheck = computed(() => !isRepot.value && props.answer === 'could-not-check');
// QA round-4 finding 1, the same class of defect as the round-3 one above and the last instance of it. The
// ONE remaining RE-EVALUATE sentence — "Nothing you saw says it needs repotting yet" — was also being told
// to an owner who had just TICKED signs. It is true of a "no signs" answer and false of this one: the owner
// did see something, and reporting it back as "nothing you saw" reads as the app having ignored the answer.
//
// ⚠️ WHY THE ENGINE IS NOT THE BUG HERE, stated so nobody "fixes" it. Ticked signs that fall short of the
// needed threshold DO reach the engine and DO differentiate: `scoreRepotSigns` returns an elevated
// `noiseMult` (1.5) for an inconclusive answer, which damps the adjustment step quadratically, so an
// inconclusive answer lengthens the repot interval LESS than a clean "no signs" one — the correct
// direction. What flattens the DISPLAYED answer is `computeRepotVerdict`'s cap: N is derived from the
// recomputed due date and clamped to `REEVALUATE_MAX_DAYS` (90), so on a plant whose repot is ~a year out
// every answer lands on the same date. That cap is correct behaviour and stays. Measured: multiplier
// 1.01613 after "no signs" vs 1.00714 after one `strong` sign.
//
// Which is also why the sentence must NOT claim a direction ("this brings the repot forward"): it does not.
// It says only what is unconditionally true — the observation was recorded, it counts, and on its own it is
// not conclusive.
const isCheckedSigns = computed(() => !isRepot.value && props.answer === 'signs');
// No separate TITLE for the checked-signs case, deliberately: "Not yet — we'll ask again" is equally true
// of both non-could-not-check answers, and duplicating one string into two identical ones is the fork this
// project forbids. Only the BODY differs, because only the body made a claim about what the owner saw.
const title = computed(() => {
  if (isRepot.value) return t('repotEval.verdictRepotTitle');
  return isCouldNotCheck.value
    ? t('repotEval.verdictCouldNotCheckTitle')
    : t('repotEval.verdictReevaluateTitle');
});
const body = computed(() => {
  if (!props.result) return '';
  if (isRepot.value) return t('repotEval.verdictRepotBody');
  const date = props.result.reevaluateOn ? d(ymdToLocalDate(props.result.reevaluateOn), 'short') : '';
  if (isCouldNotCheck.value) return t('repotEval.verdictCouldNotCheckBody', { date });
  if (isCheckedSigns.value) return t('repotEval.verdictSignsReevaluateBody', { date });
  return t('repotEval.verdictReevaluateBody', { date });
});

// ── What would settle it (owner request, 2026-08-07) ──────────────────────────────────────────────────
// The copy above tells an owner who DID tick signs that what they saw counts but is not enough on its own.
// What it never said is what WOULD move the answer — even though the model knows: docs/care-engine.md
// §7.17 defines `strong` as "reliable, but worth confirming with one more" and `definitive` as "this alone
// means root-bound". That reasoning being invisible is what made a flat "not yet" read as the app ignoring
// the owner.
//
// So: name a sign from THIS plant's own catalogue that the owner did not tick and that would genuinely
// CORROBORATE what they saw (`corroboratingSign`, utils/repotEvaluation.ts — deterministic, full ties
// broken by catalogue order).
//
// ⚠️ "Corroborate" is the whole rule, and it is narrower than "strongest" (QA round 5, finding 2). The
// first version asked for the strongest unticked sign, which is a CONSTANT on this branch: `definitive`
// is the top class, one sign holds it, every species inherits it, and ticking it alone would have ended
// the questionnaire — so it was always unticked and always won. Every owner, on every species, was told
// to go and check whether their pot had split. `definitive` is now excluded (it decides, it does not
// corroborate) and, at equal rank, this species' own sign beats a universal one.
//
// ⚠️ PRESENTATION ONLY, and it must stay that way. It changes no engine input, no score, no verdict, no
// stored value and no request body; it reads two things the caller already had. Nothing is posted.
//
// Scoped to the CHECKED-SIGNS branch on purpose:
//   - a REPOT verdict has nothing left to corroborate — the answer is already "yes";
//   - "no signs at all" is the strongest negative the flow produces (§7.17), and answering it with "go and
//     look for this one" would argue with an owner who just told us they looked and saw nothing;
//   - "I couldn't check it" has not looked yet, so the thing to do is the whole questionnaire, not one sign.
// The edge cases fall out of the helper rather than being special-cased: every sign ticked, or a
// single-sign catalogue, both yield `null` and the ordinary copy stands alone — a complete answer.
const suggestedSign = computed(() =>
  isCheckedSigns.value ? corroboratingSign(props.signs, props.checkedSignIds) : null,
);
</script>

<template>
  <Modal v-model="open" :title="title">
    <p class="mp-repotverdict__body">{{ body }}</p>
    <!-- The lead-in is i18n (it is the app talking); the sign itself is DATA, already resolved to the
         request locale by the API, so it renders verbatim and on its own line — the catalogue labels are
         full sentences and would read wrong spliced into the middle of one. The wording asks the owner to
         go and CHECK something; it never predicts what they will find, and never implies the repot is
         coming, because the whole point of this branch is that the evidence is not conclusive. -->
    <p v-if="suggestedSign" class="mp-repotverdict__suggest">
      <span class="mp-repotverdict__suggest-lead">{{ t('repotEval.verdictCorroborateLead') }}</span>
      <span class="mp-repotverdict__suggest-sign">{{ suggestedSign.label }}</span>
    </p>
    <template #footer>
      <Button color="neutral" variant="ghost" @click="open = false">{{ t('common.close') }}</Button>
    </template>
  </Modal>
</template>

<style scoped>
/* Design-system tokens only — no magic values. Class conventions follow RepotEvaluationModal.vue. */
.mp-repotverdict__body {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-body);
}

.mp-repotverdict__suggest {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-4) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

.mp-repotverdict__suggest-lead {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-repotverdict__suggest-sign {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-strong);
}
</style>
