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
   * EXACT same body deterministically — never a fresh key minted silently on an edited answer. Also true
   * across a close (X, Escape, backdrop) and re-open for the same plant (code review finding V12) — the
   * parent keeps the key outstanding on a resume, so this stays frozen and the `watch(open, ...)` below
   * must not wipe the answers that key was minted for. */
  frozen?: boolean;
  /** W3: the OUTSTANDING attempt's own stored submit body, present iff `frozen` is true. Once the attempt
   * store moved to module scope (W1), a plant's frozen attempt can survive a detour through a DIFFERENT
   * plant's card — e.g. plant A fails and freezes, the owner opens plant B's evaluation instead (leaving
   * this component's local `checked`/`exclusive` refs holding B's answers), then returns to A. Without this
   * prop the `watch(open, ...)` below has no way to tell the answers apart from B's leftover ones — it can
   * only "not reset them", which silently displays B's checked signs under A's frozen (and about-to-be
   * retried) form. Hydrating FROM this stored body instead means the displayed answers and the request a
   * retry actually sends are read from the exact SAME source — never a second "remember the draft per
   * plant" mechanism; the stored body already IS the draft. */
  frozenAnswers?: RepotEvaluationSubmit | null;
}>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ submit: [body: RepotEvaluationSubmit]; 'start-over': []; 'reload-signs': [] }>();

const { t, locale } = useI18n();

const checked = ref<string[]>([]);
const exclusive = ref<'none' | 'no-signs' | 'could-not-check'>('none');
const expandedHelp = ref<string | null>(null);

// FIX E — makes the two exclusive answers DESELECTABLE (they used to stick once clicked, with no escape but
// closing the whole modal). Toggles OFF back to 'none' when the SAME value is clicked again.
//
// This is bound via `:checked` + `@click.prevent`, NEVER a plain `@click` handler left running ALONGSIDE
// `v-model` on the radio — that shape cannot work, and the reason is the browser's own event order, not a
// bug in this component: for a radio input, the browser sets the element's checkedness during the
// "activation behavior" that runs as part of dispatching the click, and only AFTER that does it fire the
// `change` event — which is what `v-model` actually listens on to write the new value into `exclusive`. A
// `@click` handler added alongside `v-model` runs BEFORE that native `change` fires, so anything it writes
// into `exclusive` (e.g. clearing it back to 'none') is immediately overwritten the instant `v-model`'s own
// `change` handler runs right after. Binding `:checked` (not `v-model`) and calling `event.preventDefault()`
// inside the click handler cancels the native activation behavior ENTIRELY before it ever sets checkedness
// or queues a `change` — so `exclusive` (this ref) is left as the ONE source of truth the DOM's `:checked`
// binding reflects back, with no native state for a re-render to fight.
function toggleExclusive(v: 'no-signs' | 'could-not-check') {
  exclusive.value = exclusive.value === v ? 'none' : v;
}

// Exclusivity is enforced HERE for the owner's sake and AGAIN on the server: "no signs" arriving together
// with a checked sign is a 400, never a silently-resolved contradiction.
watch(exclusive, (v) => {
  if (v !== 'none') checked.value = [];
});
watch(checked, (v) => {
  if (v.length > 0) exclusive.value = 'none';
});
watch(open, (isOpen) => {
  if (!isOpen) return;
  // While frozen, an open→true transition is a RESUME after the owner closed the modal (X, Escape, or the
  // backdrop) without resolving the outstanding submission (code review finding V12) — not a fresh
  // attempt.
  //
  // W3: a resume HYDRATES from `frozenAnswers` — the outstanding attempt's own stored submit body — rather
  // than merely refusing to touch whatever `checked`/`exclusive` already hold. Those refs' PREVIOUS values
  // may belong to a DIFFERENT plant (the owner closed this plant's frozen modal, opened another plant's,
  // then came back here), so "do nothing" would display that other plant's checked signs under THIS
  // plant's frozen modal while the retry silently resends THIS plant's original body underneath it — a
  // display that lies about what will actually be submitted. Hydrating from the stored body keeps the two
  // in lockstep. A non-frozen reopen (first attempt for a plant, or after "start over") still resets, as
  // before.
  if (props.frozen) {
    if (props.frozenAnswers) {
      const answers = props.frozenAnswers;
      if (answers.answer === 'signs') {
        exclusive.value = 'none';
        checked.value = [...answers.signIds];
      } else {
        checked.value = [];
        exclusive.value = answers.answer;
      }
      expandedHelp.value = null;
    }
    return;
  }
  checked.value = [];
  exclusive.value = 'none';
  expandedHelp.value = null;
});

// The sign catalogue is DATA resolved server-side in the request locale, so a language switch while this
// modal is open leaves the labels in the previous locale. The parent owns the fetch (it owns the plant id,
// the race guards and the error banner), so ask it to reload rather than fetching here.
watch(locale, () => { if (open.value) emit('reload-signs'); });

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
        <input
          type="radio"
          name="repoteval-exclusive"
          value="no-signs"
          :checked="exclusive === 'no-signs'"
          :disabled="frozen"
          @click.prevent="toggleExclusive('no-signs')"
        />
        <span>{{ t('repotEval.noSigns') }}</span>
      </label>
      <label class="mp-repoteval__check">
        <input
          type="radio"
          name="repoteval-exclusive"
          value="could-not-check"
          :checked="exclusive === 'could-not-check'"
          :disabled="frozen"
          @click.prevent="toggleExclusive('could-not-check')"
        />
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
