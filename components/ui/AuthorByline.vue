<script setup lang="ts">
// Reusable author byline: avatar + name (+ optional role/tagline slot). Tokens only, no new colors.
// GRACEFUL FALLBACK: if the avatar file is missing/broken, the <img> @error flips to an initials
// chip so a missing public/authors/*.webp never shows a broken image or breaks the build.
const props = withDefaults(
  defineProps<{ name: string; avatar?: string | null; size?: number }>(),
  { avatar: null, size: 40 },
);

const imgFailed = ref(false);
const showImg = computed(() => !!props.avatar && !imgFailed.value);
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase(),
);
</script>

<template>
  <div class="mp-byline">
    <img
      v-if="showImg"
      :src="props.avatar as string"
      :alt="props.name"
      class="mp-byline__avatar"
      :style="{ width: `${props.size}px`, height: `${props.size}px` }"
      width="40"
      height="40"
      loading="lazy"
      decoding="async"
      @error="imgFailed = true"
    />
    <div
      v-else
      class="mp-byline__avatar mp-byline__avatar--ph"
      :style="{ width: `${props.size}px`, height: `${props.size}px` }"
      aria-hidden="true"
    >{{ initials }}</div>
    <div class="mp-byline__text">
      <span class="mp-byline__name">{{ props.name }}</span>
      <span v-if="$slots.role" class="mp-byline__role"><slot name="role" /></span>
    </div>
  </div>
</template>

<style scoped>
.mp-byline { display: inline-flex; align-items: center; gap: 10px; }
.mp-byline__avatar { border-radius: 50%; object-fit: cover; flex-shrink: 0; box-shadow: var(--shadow-md); }
.mp-byline__avatar--ph {
  display: grid; place-items: center;
  background: var(--surface-sunken); color: var(--text-muted);
  font: 700 13px var(--font-sans);
}
.mp-byline__text { display: grid; gap: 1px; line-height: 1.2; }
.mp-byline__name { font: 700 13px var(--font-sans); color: var(--text-strong); }
.mp-byline__role { font: 500 12px var(--font-sans); color: var(--text-muted); }
</style>
