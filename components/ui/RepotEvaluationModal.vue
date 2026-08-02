<script setup lang="ts">
import type { RepotSign, RepotEvaluationSubmit } from '~/types/api';
import Modal from './Modal.vue';
import Button from './Button.vue';
import Alert from './Alert.vue';

const props = defineProps<{ signs: RepotSign[]; loading?: boolean; submitting?: boolean; error?: string | null }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ submit: [body: RepotEvaluationSubmit] }>();

const { t } = useI18n();

const checked = ref<string[]>([]);
const exclusive = ref<'none' | 'no-signs' | 'could-not-check'>('none');
const expandedHelp = ref<string | null>(null);

// Exclusivity is enforced HERE for the owner's sake and AGAIN on the server: "no signs" arriving together
// with a checked sign is a 400, never a silently-resolved contradiction.
watch(exclusive, (v) => {
  if (v !== 'none') checked.value = [];
});
watch(checked, (v) => {
  if (v.length > 0) exclusive.value = 'none';
});
watch(open, (isOpen) => {
  if (isOpen) {
    checked.value = [];
    exclusive.value = 'none';
    expandedHelp.value = null;
  }
});

const canSubmit = computed(() => !props.submitting && (checked.value.length > 0 || exclusive.value !== 'none'));

function onSubmit() {
  if (!canSubmit.value) return;
  if (exclusive.value === 'no-signs') return emit('submit', { answer: 'no-signs' });
  if (exclusive.value === 'could-not-check') return emit('submit', { answer: 'could-not-check' });
  emit('submit', { answer: 'signs', signIds: [...checked.value] });
}
</script>

<template>
  <Modal v-model="open" :title="t('repotEval.title')" size="lg">
    <!-- Rendered INSIDE the modal body (Modal.vue teleports to <body> with a fixed, viewport-covering
         backdrop), so this stays visible above it — a page-level banner sitting in the ordinary document
         flow renders BEHIND the teleported backdrop while this modal is open. See RepotDoneForm.vue and
         pages/index.vue's repotError comment for the same reasoning. -->
    <Alert v-if="error" color="red" :description="error" class="mp-repoteval__error" />

    <p class="mp-repoteval__intro">{{ t('repotEval.intro') }}</p>

    <h3 class="mp-repoteval__heading">{{ t('repotEval.signsHeading') }}</h3>
    <ul class="mp-repoteval__list">
      <li v-for="sign in signs" :key="sign.id" class="mp-repoteval__item">
        <label class="mp-repoteval__check">
          <input v-model="checked" type="checkbox" :value="sign.id" :disabled="exclusive !== 'none'" />
          <!-- Catalogue text is DATA, resolved server-side in the request locale. Never an i18n key. -->
          <span>{{ sign.label }}</span>
        </label>
        <button
          v-if="sign.help"
          type="button"
          class="mp-repoteval__helptoggle"
          :aria-expanded="expandedHelp === sign.id"
          @click="expandedHelp = expandedHelp === sign.id ? null : sign.id"
        >
          {{ t('repotEval.helpToggle') }}
        </button>
        <p v-if="sign.help && expandedHelp === sign.id" class="mp-repoteval__help">{{ sign.help }}</p>
      </li>
    </ul>

    <div class="mp-repoteval__exclusive">
      <label class="mp-repoteval__check">
        <input v-model="exclusive" type="radio" value="no-signs" />
        <span>{{ t('repotEval.noSigns') }}</span>
      </label>
      <label class="mp-repoteval__check">
        <input v-model="exclusive" type="radio" value="could-not-check" />
        <span>{{ t('repotEval.couldNotCheck') }}</span>
      </label>
    </div>

    <template #footer>
      <Button color="primary" icon="check" :disabled="!canSubmit" @click="onSubmit">
        {{ t('repotEval.submit') }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
/* Design-system tokens only — no magic values. Class conventions follow ReasonPicker.vue. */
.mp-repoteval__error {
  margin: 0 0 var(--space-4);
}

.mp-repoteval__intro {
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.mp-repoteval__heading {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
}

.mp-repoteval__list {
  margin: 0 0 var(--space-4);
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.mp-repoteval__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.mp-repoteval__check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-body);
  cursor: pointer;
}

.mp-repoteval__helptoggle {
  align-self: flex-start;
  margin-left: var(--space-6);
  padding: 0;
  border: none;
  background: transparent;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-link);
  cursor: pointer;
}

.mp-repoteval__help {
  margin: 0 0 0 var(--space-6);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-repoteval__exclusive {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}
</style>
