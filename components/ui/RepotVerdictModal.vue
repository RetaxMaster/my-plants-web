<script setup lang="ts">
// Shows the verdict returned by a REPOT evaluation submit (the RepotEvaluationModal.vue flow, spec F.7 /
// repoteval:25). A 'REPOT' verdict is what unlocks the classic Done | Postpone on the Today card (Task
// 27's state machine); a 'RE-EVALUATE' verdict tells the owner nothing needs doing yet and names the date
// we'll ask again. Display-only — it never posts anything, so it carries no submitting/idempotency state.
import type { RepotEvaluationResult, RepotEvaluationSubmit } from '~/types/api';
import { ymdToLocalDate } from '~/utils/localDate';
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
  return isCouldNotCheck.value
    ? t('repotEval.verdictCouldNotCheckBody', { date })
    : t('repotEval.verdictReevaluateBody', { date });
});
</script>

<template>
  <Modal v-model="open" :title="title">
    <p class="mp-repotverdict__body">{{ body }}</p>
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
</style>
