<script setup lang="ts">
// A reusable confirmation dialog composed from UiModal (design-system-first — NO hand-rolled overlay). The
// parent binds `v-model` for the open state and listens `@confirm` for the committed action. Cancel, Escape,
// and a backdrop click all DISMISS with no `@confirm` — so a real, reversible confirm step, never a silent
// commit. Copy (title / message / labels) is passed in by the parent so every string stays an i18n key at
// the call site. The destructive intent is carried by the icon (the design-system Button has no red color).
withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    confirmIcon?: string;
  }>(),
  {},
);

const open = defineModel<boolean>({ default: false });
const emit = defineEmits<{ confirm: [] }>();
const { t } = useI18n();

function onConfirm() {
  open.value = false;
  emit('confirm');
}
</script>

<template>
  <UiModal v-model="open" :title="title">
    <p class="mp-confirm__message">{{ message }}</p>
    <template #footer>
      <UiButton type="button" color="neutral" variant="ghost" @click="open = false">
        {{ cancelLabel ?? t('common.cancel') }}
      </UiButton>
      <UiButton type="button" color="neutral" variant="solid" :icon="confirmIcon" @click="onConfirm">
        {{ confirmLabel }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.mp-confirm__message {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-strong);
}
</style>
