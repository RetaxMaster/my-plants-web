<script setup lang="ts">
import Modal from './Modal.vue';
import type { GrowthHabit } from '@retaxmaster/my-plants-species-schema/plant-profile-constants';

const props = defineProps<{
  // The species' growth-habit key from the plant read (spec §2.4), or null for an un-curated species →
  // the generic guide. This is the SPECIES habit only; the per-plant-profile habit is deliberately NOT
  // consulted here (spec §2.2, Carlos's choice).
  growthHabit?: GrowthHabit | null;
}>();

const open = defineModel<boolean>('open', { default: false });
const { t, te } = useI18n();

// A null habit — or a habit with no i18n entry (defensive) — falls back to the generic guide, never English.
const section = computed(() => {
  const habit = props.growthHabit;
  return habit && te(`measure.${habit}.title`) ? habit : 'generic';
});
const title = computed(() => t(`measure.${section.value}.title`));
const body = computed(() => t(`measure.${section.value}.body`));
</script>

<template>
  <Modal v-model="open" :title="title">
    <p class="mp-measureinfo__text">{{ body }}</p>
  </Modal>
</template>

<style scoped>
.mp-measureinfo__text {
  margin: 0;
  font: var(--text-sm) / 1.5 var(--font-sans);
  color: var(--text-body);
}
</style>
