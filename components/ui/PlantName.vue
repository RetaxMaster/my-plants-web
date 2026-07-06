<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    title: string;
    scientific?: string;
    commonName?: string | null;
    size?: number;
    titleTag?: 'h1' | 'span';
    class?: unknown;
  }>(),
  {
    size: 15,
    titleTag: 'span',
  },
);

// Stacked layout (title above, "common (scientific)" below) is used by the blog; it turns on when a
// commonName is provided. Otherwise the original inline "title (scientific)" is rendered unchanged.
const stacked = computed(() => props.commonName != null && props.commonName !== '');
const showScientific = computed(() => !!props.scientific && props.scientific !== props.title);
const showIdentity = computed(() => stacked.value || showScientific.value);
const subSize = computed(() => Math.round(props.size * 0.72));
</script>

<template>
  <!-- Stacked (blog): title row + a smaller, secondary "common (scientific)" identity row. -->
  <span v-if="stacked" :class="['mp-plant-name mp-plant-name--stacked', props.class]" v-bind="$attrs">
    <component :is="titleTag" class="mp-plant-name__title mp-plant-name__title--block" :style="{ font: `700 ${size}px var(--font-sans)` }">{{ title }}</component>
    <span v-if="showIdentity" class="mp-plant-name__identity" :style="{ fontSize: `${subSize}px` }">
      <span class="mp-plant-name__common">{{ commonName }}</span>
      <span v-if="showScientific" class="mp-plant-name__sci">({{ scientific }})</span>
    </span>
  </span>

  <!-- Inline (default, unchanged): "title (scientific)" on one baseline. -->
  <span v-else :class="['mp-plant-name', props.class]" v-bind="$attrs">
    <span class="mp-plant-name__title" :style="{ font: `700 ${size}px var(--font-sans)` }">{{ title }}</span>
    <span
      v-if="showScientific"
      class="mp-plant-name__sci"
      :style="{ font: `italic ${size - 2}px var(--font-sans)` }"
    >({{ scientific }})</span>
  </span>
</template>

<style scoped>
.mp-plant-name {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.mp-plant-name--stacked { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }

.mp-plant-name__title { color: var(--text-strong); }
.mp-plant-name__title--block { margin: 0; }

.mp-plant-name__sci { color: var(--text-muted); }
/* Stacked identity row: same family as the title but smaller + secondary color; scientific italicised. */
.mp-plant-name__identity {
  display: inline-flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
  font-family: var(--font-sans); font-weight: var(--weight-medium); color: var(--text-muted);
}
.mp-plant-name__identity .mp-plant-name__sci { font-style: italic; color: var(--text-muted); }
</style>
