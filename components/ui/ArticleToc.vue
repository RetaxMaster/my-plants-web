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
    // A band under the sticky topbar: a heading counts as "active" once it crosses ~96px from the top
    // and until it leaves the top 35% of the viewport.
    { rootMargin: '-96px 0px -65% 0px', threshold: 0 },
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
        >
          <span class="mp-toc__num">{{ item.num }}</span>
          <span class="mp-toc__text">{{ item.text }}</span>
        </a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.mp-toc { font-family: var(--font-sans); }
.mp-toc__title {
  font: var(--weight-medium) 10.5px var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-faint); margin-bottom: 14px;
}
.mp-toc__list { list-style: none; margin: 0; padding: 0; }
/* The continuous vertical rail: every link carries a left border, and the items are flush (no gap),
   so their borders form ONE unbroken line down the whole index; the active item lights its segment. */
.mp-toc__link {
  display: flex; align-items: baseline; gap: 10px;
  padding: 7px 0 7px 14px;
  border-left: 2px solid var(--border-subtle);
  color: var(--text-muted); text-decoration: none;
  transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.mp-toc__item--sub .mp-toc__link { padding-left: 30px; }
.mp-toc__link:hover { color: var(--text-strong); }
.mp-toc__item--active > .mp-toc__link {
  color: var(--text-brand); border-left-color: var(--brand-primary);
}
.mp-toc__num {
  font: 9.5px var(--font-mono); color: var(--text-faint); flex-shrink: 0; letter-spacing: 0.02em;
}
.mp-toc__item--active > .mp-toc__link .mp-toc__num { color: var(--text-brand); }
.mp-toc__text { font: var(--weight-medium) 12.5px/1.45 var(--font-sans); }

/* Anchor jumps land below the sticky topbar, not under it. */
:global(.mp-article h2),
:global(.mp-article h3) { scroll-margin-top: 96px; }
@media (prefers-reduced-motion: no-preference) {
  :global(html) { scroll-behavior: smooth; }
}
</style>
