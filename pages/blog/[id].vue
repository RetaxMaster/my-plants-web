<script setup lang="ts">
const route = useRoute();
const api = useApi();
const slug = route.params.id as string;
const { data: brief } = await useAsyncData(`blog-${slug}`, () => api.getSpeciesBrief(slug));
</script>

<template>
  <div v-if="brief">
    <NuxtLink to="/blog" class="text-sm text-gray-500 hover:underline">← All articles</NuxtLink>
    <h2 class="text-xl font-bold mt-2">
      {{ brief.commonNames[0] ?? brief.scientificName }}
      <span v-if="brief.commonNames.length" class="text-base font-normal text-gray-500 italic">({{ brief.scientificName }})</span>
    </h2>

    <p v-if="!brief.briefEs" class="text-gray-500 mt-4">No article available yet.</p>
    <article v-else class="mt-4 whitespace-pre-wrap leading-relaxed">{{ brief.briefEs }}</article>
  </div>
  <p v-else class="text-gray-500">Loading…</p>
</template>
