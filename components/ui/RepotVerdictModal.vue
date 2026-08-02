<script setup lang="ts">
// Shows the verdict returned by a REPOT evaluation submit (the RepotEvaluationModal.vue flow, spec F.7 /
// repoteval:25). A 'REPOT' verdict is what unlocks the classic Done | Postpone on the Today card (Task
// 27's state machine); a 'RE-EVALUATE' verdict tells the owner nothing needs doing yet and names the date
// we'll ask again. Display-only — it never posts anything, so it carries no submitting/idempotency state.
import type { RepotEvaluationResult } from '~/types/api';
import { ymdToLocalDate } from '~/utils/localDate';
import Modal from './Modal.vue';
import Button from './Button.vue';

const props = defineProps<{ result: RepotEvaluationResult | null }>();
const open = defineModel<boolean>('open', { default: false });

const { t, d } = useI18n();

const isRepot = computed(() => props.result?.verdict === 'REPOT');
const title = computed(() =>
  isRepot.value ? t('repotEval.verdictRepotTitle') : t('repotEval.verdictReevaluateTitle'),
);
const body = computed(() => {
  if (!props.result) return '';
  if (isRepot.value) return t('repotEval.verdictRepotBody');
  const date = props.result.reevaluateOn ? d(ymdToLocalDate(props.result.reevaluateOn), 'short') : '';
  return t('repotEval.verdictReevaluateBody', { date });
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
