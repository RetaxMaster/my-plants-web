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
        <div>
          <NuxtLink :to="`/blog/${s.slug}`" class="font-medium hover:underline">{{ s.commonName || s.scientificName }}</NuxtLink>
          <span v-if="s.scientificName && s.scientificName !== (s.commonName || s.scientificName)" class="text-xs text-gray-500 italic"> ({{ s.scientificName }})</span>
        </div>
      </UCard>
    </div>
  </div>
</template>
