<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    type?: string;
    icon?: string;
    placeholder?: string;
    disabled?: boolean;
    error?: string;
  }>(),
  {
    type: 'text',
    disabled: false,
  },
);

const model = defineModel<string | number>();

const focused = ref(false);
const invalid = computed(() => !!props.error);
</script>

<template>
  <div class="mp-input">
    <AppIcon
      v-if="icon"
      :name="icon"
      :size="18"
      class="mp-input__icon"
      :class="{ 'mp-input__icon--focus': focused }"
    />
    <input
      v-model="model"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="['mp-input__field', { 'mp-input__field--has-icon': icon, 'mp-input__field--invalid': invalid }]"
      :aria-invalid="invalid || undefined"
      v-bind="$attrs"
      @focus="focused = true"
      @blur="focused = false"
    />
  </div>
</template>

<style scoped>
.mp-input {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.mp-input__icon {
  position: absolute;
  left: var(--space-3);
  pointer-events: none;
  color: var(--text-faint);
  transition: color var(--dur-fast) var(--ease-out);
}

.mp-input__icon--focus {
  color: var(--green-600);
}

.mp-input__field {
  width: 100%;
  height: 40px;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-strong);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 0 var(--space-3);
  outline: none;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.mp-input__field--has-icon {
  padding-left: calc(var(--space-3) + 18px + var(--space-2));
}

.mp-input__field::placeholder {
  color: var(--text-faint);
}

.mp-input__field:focus {
  border-color: var(--border-brand);
  box-shadow: var(--shadow-focus);
}

.mp-input__field--invalid {
  border-color: var(--red-500);
}

.mp-input__field--invalid:focus {
  border-color: var(--red-500);
}

.mp-input__field:disabled {
  background: var(--stone-100);
  cursor: not-allowed;
}
</style>
