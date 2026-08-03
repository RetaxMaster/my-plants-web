<script setup lang="ts">
import type { RepotSign, RepotEvaluationSubmit } from '~/types/api';
import Modal from './Modal.vue';
import Button from './Button.vue';
import Alert from './Alert.vue';

const props = defineProps<{
  signs: RepotSign[];
  loading?: boolean;
  submitting?: boolean;
  error?: string | null;
  /** True from the moment a submit is first attempted until it succeeds or the owner explicitly starts
   * over (code review finding W17) — an idempotency key is outstanding for the whole span, in flight AND
   * after a failure, so the answers must not change under it: a same-key retry with a DIFFERENT body is a
   * permanent 422 from the server's global idempotency interceptor, with no way out but a page reload.
   * While frozen the inputs are disabled, so the retry (the same submit button) recomputes and resends the
   * EXACT same body deterministically — never a fresh key minted silently on an edited answer. */
  frozen?: boolean;
}>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ submit: [body: RepotEvaluationSubmit]; 'start-over': [] }>();

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
    <Alert v-if="error" color="red" :description="error" announce class="mp-repoteval__error" />

    <p class="mp-repoteval__intro">{{ t('repotEval.intro') }}</p>

    <h3 class="mp-repoteval__heading">{{ t('repotEval.signsHeading') }}</h3>
    <ul class="mp-repoteval__list">
      <li v-for="sign in signs" :key="sign.id" class="mp-repoteval__item">
        <label class="mp-repoteval__check">
          <input v-model="checked" type="checkbox" :value="sign.id" :disabled="frozen || exclusive !== 'none'" />
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
        <input v-model="exclusive" type="radio" value="no-signs" :disabled="frozen" />
        <span>{{ t('repotEval.noSigns') }}</span>
      </label>
      <label class="mp-repoteval__check">
        <input v-model="exclusive" type="radio" value="could-not-check" :disabled="frozen" />
        <span>{{ t('repotEval.couldNotCheck') }}</span>
      </label>
    </div>

    <template #footer>
      <!-- Only offered once there is something to recover FROM: a frozen form with no error yet is simply
           an in-flight submit, where the right action is to wait, not to abandon it. -->
      <Button v-if="frozen && error" variant="soft" color="neutral" @click="emit('start-over')">
        {{ t('repotEval.startOver') }}
      </Button>
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
