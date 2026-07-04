<script setup lang="ts">
// Fixed reading-progress bar. Measures the TARGET article element's top/height vs. the viewport so
// the fill reflects progress through the ARTICLE, not the whole document. transform: scaleX() only,
// one promoted layer, rAF-throttled — no layout/paint animation (perf invariant). SSR renders at 0%.
const props = defineProps<{ target?: string }>();

const progress = ref(0); // 0..1
let raf = 0;

function measure() {
  raf = 0;
  const el = props.target ? document.querySelector<HTMLElement>(props.target) : document.documentElement;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const viewport = window.innerHeight;
  // Total distance the article can scroll past the viewport bottom.
  const scrollable = rect.height - viewport;
  if (scrollable <= 0) {
    // Article shorter than the viewport: it is fully read as soon as its top reaches the top.
    progress.value = rect.top <= 0 ? 1 : 0;
    return;
  }
  const scrolled = -rect.top; // how far the article top is above the viewport top
  progress.value = Math.min(1, Math.max(0, scrolled / scrollable));
}

function onScroll() {
  if (raf) return;
  raf = requestAnimationFrame(measure);
}

onMounted(() => {
  if (typeof window === 'undefined') return;
  measure();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
});

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return;
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onScroll);
  if (raf) cancelAnimationFrame(raf);
});
</script>

<template>
  <div class="mp-progress" aria-hidden="true">
    <div class="mp-progress__fill" :style="{ transform: `scaleX(${progress})` }" />
  </div>
</template>

<style scoped>
.mp-progress {
  position: fixed; top: 0; left: 0; right: 0; height: 3px;
  z-index: 40; /* above the sticky topbar (z-index 30), below menus (50) */
  background: transparent; pointer-events: none;
}
.mp-progress__fill {
  height: 100%; width: 100%; transform-origin: 0 50%; transform: scaleX(0);
  background: var(--brand-primary); will-change: transform;
}
/* The bar reflects position, not decoration — it still fills with reduced motion, just without any
   smoothing transition (there is none here; transform updates per rAF frame). */
</style>
