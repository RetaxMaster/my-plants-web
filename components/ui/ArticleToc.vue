<script setup lang="ts">
import type { TocEntry } from '../../utils/renderArticle.js';

const props = defineProps<{ items: TocEntry[]; title: string }>();

// The heading currently "in view". Server render leaves it '' (inert list); the observer fills it in
// on the client. Anchors work with or without JS (they are real <a href="#id">).
const activeId = ref('');

let observer: IntersectionObserver | null = null;
// ids currently intersecting the top band; active = the topmost of them (smallest boundingTop).
const visible = new Map<string, number>();

function recompute() {
  if (visible.size === 0) return; // keep the last active when nothing is in the band (between sections)
  let bestId = '';
  let bestTop = Infinity;
  for (const [id, top] of visible) {
    if (top < bestTop) { bestTop = top; bestId = id; }
  }
  activeId.value = bestId;
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return;
  const targets = props.items
    .map((i) => document.getElementById(i.id))
    .filter((el): el is HTMLElement => !!el);
  if (!targets.length) return;

  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = e.target.id;
        if (e.isIntersecting) visible.set(id, e.boundingClientRect.top);
        else visible.delete(id);
      }
      recompute();
    },
    // A band under the sticky topbar: a heading counts as "active" once it crosses ~88px from the top
    // and until it leaves the top 35% of the viewport. Tune in the perf/a11y review (Phase 3).
    { rootMargin: '-88px 0px -65% 0px', threshold: 0 },
  );
  // Seed the first entry active so the index never renders with nothing highlighted on load.
  activeId.value = props.items[0]?.id ?? '';
  targets.forEach((t) => observer!.observe(t));
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  visible.clear();
});
</script>

<template>
  <nav v-if="props.items.length" class="mp-toc" :aria-label="props.title">
    <div class="mp-toc__title">{{ props.title }}</div>
    <ol class="mp-toc__list">
      <li
        v-for="item in props.items"
        :key="item.id"
        class="mp-toc__item"
        :class="{ 'mp-toc__item--sub': item.level === 3, 'mp-toc__item--active': activeId === item.id }"
      >
        <a
          :href="`#${item.id}`"
          class="mp-toc__link"
          :aria-current="activeId === item.id ? 'location' : undefined"
        >{{ item.text }}</a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.mp-toc { font: var(--font-sans); }
.mp-toc__title { font: 700 12px var(--font-sans); letter-spacing: 0.02em; text-transform: uppercase; color: var(--text-faint); margin-bottom: 10px; }
.mp-toc__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.mp-toc__item--sub { margin-left: 14px; }
.mp-toc__link {
  display: block; padding: 5px 10px; border-left: 2px solid transparent;
  font: 500 13px/1.4 var(--font-sans); color: var(--text-muted); text-decoration: none;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.mp-toc__link:hover { color: var(--text-strong); }
.mp-toc__item--active > .mp-toc__link {
  color: var(--text-brand); border-left-color: var(--brand-primary); background: var(--accent-green-surface);
}
/* Anchor jumps land below the sticky topbar, not under it. */
:global(.mp-article-body h2),
:global(.mp-article-body h3) { scroll-margin-top: 96px; }
@media (prefers-reduced-motion: no-preference) {
  :global(html) { scroll-behavior: smooth; }
}
</style>
