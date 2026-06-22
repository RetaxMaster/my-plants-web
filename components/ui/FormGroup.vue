<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    error?: string;
    required?: boolean;
  }>(),
  {
    required: false,
  },
);
</script>

<template>
  <div class="mp-form-group" v-bind="$attrs">
    <label v-if="label" class="mp-form-group__label">
      {{ label }}
      <span v-if="required" class="mp-form-group__required">*</span>
    </label>
    <slot />
    <span v-if="hint && !error" class="mp-form-group__hint">{{ hint }}</span>
    <span v-if="error" class="mp-form-group__error">{{ error }}</span>
  </div>
</template>

<style scoped>
.mp-form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mp-form-group__label {
  display: flex;
  gap: 3px;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
}

.mp-form-group__required {
  color: var(--red-500);
}

.mp-form-group__hint {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-form-group__error {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--care-poor);
}
</style>
