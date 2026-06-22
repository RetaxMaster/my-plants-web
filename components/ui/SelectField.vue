<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

interface Option {
  label: string;
  value: string;
}

const props = withDefaults(
  defineProps<{
    options?: Option[];
    placeholder?: string;
    disabled?: boolean;
  }>(),
  {
    options: () => [],
    disabled: false,
  },
);

const model = defineModel<string>();

const hasValue = computed(() => model.value !== undefined && model.value !== '');
</script>

<template>
  <div class="mp-select">
    <select
      v-model="model"
      :disabled="disabled"
      :class="['mp-select__field', { 'mp-select__field--placeholder': !hasValue }]"
      v-bind="$attrs"
    >
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option v-for="opt in props.options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <AppIcon name="chevron-down" :size="16" class="mp-select__chevron" />
  </div>
</template>

<style scoped>
.mp-select {
  position: relative;
  width: 100%;
}

.mp-select__field {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 40px;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-strong);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 0 var(--space-8) 0 var(--space-3);
  outline: none;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.mp-select__field--placeholder {
  color: var(--text-faint);
}

.mp-select__field:focus {
  border-color: var(--border-brand);
  box-shadow: var(--shadow-focus);
}

.mp-select__field:disabled {
  background: var(--stone-100);
  cursor: not-allowed;
}

.mp-select__chevron {
  position: absolute;
  right: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--text-muted);
}
</style>
