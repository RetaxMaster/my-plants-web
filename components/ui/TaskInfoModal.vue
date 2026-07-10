<script setup lang="ts">
import Modal from './Modal.vue';
import type { TaskCode } from '~/utils/tasks';

const props = defineProps<{
  task: TaskCode;
  // WATER-only species dryness slug from the care payload (e.g. 'mostly-dry'); null/absent for every
  // other task or when the field is missing → the species section is hidden.
  soilDryness?: string | null;
  // REPOT-only species checklist from the care payload. API/species catalog data, rendered verbatim.
  repotSigns?: string[] | null;
}>();

const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();

const title = computed(() => t(`tasks.labels.${props.task}`));
const whatText = computed(() => t(`taskInfo.tasks.${props.task}.what`));
const whyText = computed(() => t(`taskInfo.tasks.${props.task}.why`));
const howText = computed(() => t(`taskInfo.tasks.${props.task}.how`));
const drynessText = computed(() =>
  props.task === 'WATER' && props.soilDryness ? t(`taskInfo.dryness.${props.soilDryness}`) : null,
);
// The REPOT section always teaches: when the species record carries no signs we still tell the owner
// what to look for, because the date is an inspection reminder rather than a verdict.
const isRepot = computed(() => props.task === 'REPOT');
const repotSignsList = computed(() => (isRepot.value ? (props.repotSigns ?? []) : []));
</script>

<template>
  <Modal v-model="open" :title="title">
    <div class="mp-taskinfo">
      <section class="mp-taskinfo__section">
        <h3 class="mp-taskinfo__heading">{{ t('taskInfo.whatTitle') }}</h3>
        <p class="mp-taskinfo__text">{{ whatText }}</p>
      </section>
      <section class="mp-taskinfo__section">
        <h3 class="mp-taskinfo__heading">{{ t('taskInfo.whyTitle') }}</h3>
        <p class="mp-taskinfo__text">{{ whyText }}</p>
      </section>
      <section class="mp-taskinfo__section">
        <h3 class="mp-taskinfo__heading">{{ t('taskInfo.howTitle') }}</h3>
        <p class="mp-taskinfo__text">{{ howText }}</p>
      </section>
      <section v-if="drynessText" class="mp-taskinfo__section mp-taskinfo__section--species">
        <h3 class="mp-taskinfo__heading">{{ t('taskInfo.speciesTitle') }}</h3>
        <p class="mp-taskinfo__text">{{ drynessText }}</p>
      </section>
      <section v-if="isRepot" class="mp-taskinfo__section mp-taskinfo__section--species">
        <h3 class="mp-taskinfo__heading">{{ t('taskInfo.repot.crowdingTitle') }}</h3>
        <p class="mp-taskinfo__text">{{ t('taskInfo.repot.crowdingBody') }}</p>
        <h3 class="mp-taskinfo__heading mp-taskinfo__heading--stacked">{{ t('taskInfo.repot.signsTitle') }}</h3>
        <ul v-if="repotSignsList.length" class="mp-taskinfo__list">
          <li v-for="s in repotSignsList" :key="s" class="mp-taskinfo__text">{{ s }}</li>
        </ul>
        <p v-else class="mp-taskinfo__text">{{ t('taskInfo.repot.signsEmpty') }}</p>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.mp-taskinfo {
  display: grid;
  gap: var(--space-4);
}

.mp-taskinfo__heading {
  margin: 0 0 var(--space-1);
  font: var(--weight-semibold) var(--text-xs) / 1 var(--font-sans);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.mp-taskinfo__text {
  margin: 0;
  font: var(--text-sm) / 1.5 var(--font-sans);
  color: var(--text-body);
}

.mp-taskinfo__section--species {
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

.mp-taskinfo__heading--stacked {
  margin-top: var(--space-4);
}

.mp-taskinfo__list {
  margin: 0;
  padding-left: var(--space-4);
  display: grid;
  gap: var(--space-1);
  list-style: disc;
}
</style>
