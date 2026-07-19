<script setup lang="ts">
const props = defineProps<{
  // The SERVER's current value. This component never owns the state: it reports the owner's request and
  // re-renders when the API confirms, so a rejected PATCH can never leave the UI claiming the gate is off
  // while it is on.
  modelValue: boolean;
  i18nNamespace: string;
  // True while the PATCH is in flight.
  busy?: boolean;
  // True before a session exists (a brand-new chat has no session row to hold the setting yet).
  disabled?: boolean;
  errorMessage?: string | null;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const { t } = useI18n();
const tns = (key: string) => t(`${props.i18nNamespace}.${key}`);

/**
 * ⚠️ The switch below MUST keep receiving BOTH `:model-value` and `@update:model-value`. That pair is what
 * makes the server authoritative here, and it is not obvious from reading the template.
 *
 * `UiSwitch` is built on `defineModel`. Vue only lets such a component manage its own value in "local
 * mode" — flipping itself optimistically without waiting for confirmation — when the parent is NOT
 * controlling it. When the parent binds the prop AND listens for the update, as here, the control is fully
 * controlled: the click only ever becomes a REQUEST, and the rendered position stays whatever the server
 * last confirmed. Measured against the real component, not inferred: mounted the way this file uses it, a
 * click on a switch whose PATCH fails leaves it reporting the server's value; mounted WITHOUT the
 * listener, the same click leaves it reporting `aria-checked="true"` against a `false` prop.
 *
 * The direction that matters is a failed DISABLE: auto-approve stays ON server-side while the knob reads
 * OFF, and the owner believes they are supervising the doctor while every change is still applied unseen.
 * Dropping the listener (or "simplifying" to a self-managing switch) silently reintroduces exactly that,
 * which is why `AgentSkipPermissions.test.ts` pins the behaviour against the REAL `UiSwitch` rather than a
 * stub — a stub is a pure function of its prop and cannot exhibit the failure at all.
 */
function request(value: boolean) {
  if (props.busy || props.disabled) return;
  emit('update:modelValue', value);
}
</script>

<template>
  <div class="mp-skip">
    <div class="mp-skip__row">
      <UiSwitch
        :model-value="modelValue"
        :disabled="busy || disabled"
        :aria-label="tns('skipPermissions.label')"
        @update:model-value="request"
      />
      <div class="mp-skip__text">
        <span class="mp-skip__label">{{ tns('skipPermissions.label') }}</span>
        <span class="mp-skip__hint">{{ tns('skipPermissions.hint') }}</span>
      </div>
    </div>

    <!-- ALWAYS VISIBLE while active (§6.4). Not a toast, not a one-time notice: it stays on screen for
         as long as the gate is off, because a silent auto-approve mode is a trap. It is a pure function
         of the SERVER's value and has no dismiss affordance, so nothing the owner does can hide it while
         the doctor is genuinely applying changes unsupervised. -->
    <UiAlert
      v-if="modelValue"
      color="red"
      icon="exclamation-triangle"
      :title="tns('skipPermissions.activeTitle')"
      :description="tns('skipPermissions.activeBody')"
    />

    <p v-if="errorMessage" class="mp-skip__error" role="alert">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.mp-skip {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.mp-skip__row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-width: 0;
}

.mp-skip__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.mp-skip__label {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
}

.mp-skip__hint {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-skip__error {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--care-poor-text);
}
</style>
