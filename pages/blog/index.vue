<script setup lang="ts">
const api = useApi();
const { data: species } = await useAsyncData('blog-species-list', () => api.listSpecies());
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-3">Blog</h2>
    <p v-if="!species?.length" class="text-gray-500">No species yet.</p>
    <div class="grid gap-2">
      <UCard v-for="s in species" :key="s.slug">
        <NuxtLink :to="`/blog/${s.slug}`" class="font-medium italic hover:underline">
          {{ s.scientificName }}
        </NuxtLink>
      </UCard>
    </div>
  </div>
</template>
