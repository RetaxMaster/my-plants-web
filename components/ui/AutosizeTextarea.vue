<script setup lang="ts">
// A borderless textarea that grows to fit its content (used for the editor's title + excerpt, and
// reusable elsewhere). SSR-safe: it only measures scrollHeight after mount / on change, never during
// SSR (there is no layout on the server). Passthrough $attrs so callers can set inline font styles.
defineOptions({ inheritAttrs: false });

defineProps<{ placeholder?: string }>();
const model = defineModel<string>({ default: '' });

const el = ref<HTMLTextAreaElement | null>(null);

function resize() {
  const node = el.value;
  if (!node) return;
  node.style.height = 'auto';
  node.style.height = `${node.scrollHeight}px`;
}

onMounted(resize);
watch(model, () => nextTick(resize));

function onInput(event: Event) {
  model.value = (event.target as HTMLTextAreaElement).value;
}
</script>

<template>
  <textarea
    ref="el"
    class="mp-autota"
    rows="1"
    :value="model"
    :placeholder="placeholder"
    spellcheck="false"
    v-bind="$attrs"
    @input="onInput"
  />
</template>

<style scoped>
.mp-autota {
  width: 100%;
  box-sizing: border-box;
  display: block;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  padding: 0;
  color: var(--text-strong);
  font: inherit;
}
.mp-autota::placeholder {
  color: var(--text-faint);
}
</style>
