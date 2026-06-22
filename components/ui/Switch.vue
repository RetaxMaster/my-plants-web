<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const model = defineModel<boolean>({ default: false });

function toggle() {
  if (props.disabled) return;
  model.value = !model.value;
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    :disabled="disabled"
    :class="['mp-switch', { 'mp-switch--on': model }]"
    v-bind="$attrs"
    @click="toggle"
  >
    <span class="mp-switch__knob" />
  </button>
</template>

<style scoped>
.mp-switch {
  position: relative;
  width: 44px;
  height: 24px;
  flex: none;
  border-radius: var(--radius-pill);
  border: none;
  padding: 0;
  background: var(--stone-300);
  cursor: pointer;
  transition: background var(--dur-normal) var(--ease-out);
}

.mp-switch--on {
  background: var(--brand-primary);
}

.mp-switch:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.mp-switch:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.mp-switch__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-xs);
  transition: left var(--dur-normal) var(--ease-out);
}

.mp-switch--on .mp-switch__knob {
  left: 22px;
}
</style>
