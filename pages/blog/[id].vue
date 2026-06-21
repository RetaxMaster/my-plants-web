<script setup lang="ts">
import { marked } from 'marked';

const route = useRoute();
const api = useApi();
const slug = route.params.id as string;
const { data: brief } = await useAsyncData(`blog-${slug}`, () => api.getSpeciesBrief(slug));

// The brief is our own curated Markdown (authored by the editorial-writer, persisted only via the
// knowledge-engine's db:insert — trusted content, never user-supplied), so rendering it to HTML for
// a polished, readable article is safe here.
const articleHtml = computed(() =>
  brief.value?.briefEs ? (marked.parse(brief.value.briefEs, { async: false }) as string) : '',
);
</script>

<template>
  <div v-if="brief">
    <NuxtLink to="/blog" class="text-sm text-gray-500 hover:underline">← All articles</NuxtLink>
    <h2 class="text-xl font-bold mt-2">
      {{ brief.commonNames[0] ?? brief.scientificName }}
      <span v-if="brief.commonNames.length" class="text-base font-normal text-gray-500 italic">({{ brief.scientificName }})</span>
    </h2>

    <p v-if="!brief.briefEs" class="text-gray-500 mt-4">No article available yet.</p>
    <article v-else class="blog-prose mt-4 leading-relaxed" v-html="articleHtml" />
  </div>
  <p v-else class="text-gray-500">Loading…</p>
</template>

<style scoped>
/* Tailwind's preflight strips default heading/list styling, so the rendered Markdown needs explicit
   typography. :deep() is required because the v-html content is not scoped to this component. */
.blog-prose :deep(h1) { font-size: 1.5rem; font-weight: 700; margin: 1.25rem 0 0.5rem; }
.blog-prose :deep(h2) { font-size: 1.25rem; font-weight: 700; margin: 1.25rem 0 0.5rem; }
.blog-prose :deep(h3) { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.4rem; }
.blog-prose :deep(p) { margin: 0.6rem 0; }
.blog-prose :deep(ul) { list-style: disc; padding-left: 1.5rem; margin: 0.6rem 0; }
.blog-prose :deep(ol) { list-style: decimal; padding-left: 1.5rem; margin: 0.6rem 0; }
.blog-prose :deep(li) { margin: 0.25rem 0; }
.blog-prose :deep(strong) { font-weight: 700; }
.blog-prose :deep(em) { font-style: italic; }
.blog-prose :deep(a) { color: #16a34a; text-decoration: underline; }
</style>
