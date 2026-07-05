<script setup lang="ts">
// Reusable author byline: avatar + name (+ optional handle + a meta/role slot). Tokens only, no new
// colors. GRACEFUL FALLBACK: if the avatar file is missing/broken, the <img> @error flips to an
// initials chip so a missing public/authors/*.webp never shows a broken image or breaks the build.
const props = withDefaults(
  defineProps<{ name: string; handle?: string | null; avatar?: string | null; size?: number }>(),
  { handle: null, avatar: null, size: 44 },
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
      width="44"
      height="44"
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
      <span class="mp-byline__name">
        {{ props.name }}<span v-if="props.handle" class="mp-byline__handle">{{ props.handle }}</span>
      </span>
      <span v-if="$slots.meta" class="mp-byline__meta"><slot name="meta" /></span>
      <span v-else-if="$slots.role" class="mp-byline__role"><slot name="role" /></span>
    </div>
  </div>
</template>

<style scoped>
.mp-byline { display: inline-flex; align-items: center; gap: 12px; }
.mp-byline__avatar { border-radius: var(--radius-pill); object-fit: cover; flex-shrink: 0; box-shadow: var(--shadow-md); border: 1px solid var(--border-subtle); }
.mp-byline__avatar--ph {
  display: grid; place-items: center;
  background: var(--surface-sunken); color: var(--text-muted);
  font: var(--weight-bold) 14px var(--font-sans); border: 1px solid var(--border-subtle);
}
.mp-byline__text { display: grid; gap: 3px; line-height: 1.25; min-width: 0; }
.mp-byline__name { font: var(--weight-semibold) 14px var(--font-sans); color: var(--text-strong); }
.mp-byline__handle { font: var(--weight-regular) 12px var(--font-mono); color: var(--brand-primary); margin-left: 6px; }
.mp-byline__meta { font: 11px var(--font-mono); letter-spacing: 0.03em; color: var(--text-faint); }
.mp-byline__role { font: var(--weight-medium) 12px var(--font-sans); color: var(--text-muted); }
</style>
