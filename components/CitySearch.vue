<script setup lang="ts">
import type { CitySearchResult } from '../types/api.js';
import { friendlyCityLabel } from '../utils/cityLabel.js';

const props = withDefaults(defineProps<{ placeholder?: string }>(), {
  placeholder: 'Search a city…',
});
const emit = defineEmits<{ (e: 'select', value: CitySearchResult): void }>();

const api = useApi();
const query = ref('');
const results = ref<CitySearchResult[]>([]);
const loading = ref(false);
const selectedLabel = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

function optionLabel(c: CitySearchResult): string {
  return friendlyCityLabel(c);
}

async function runSearch(q: string) {
  if (q.trim().length < 2) {
    results.value = [];
    return;
  }
  loading.value = true;
  try {
    results.value = await api.searchCities(q);
  } finally {
    loading.value = false;
  }
}

watch(query, (q) => {
  selectedLabel.value = null;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => runSearch(q), 300);
});

function choose(c: CitySearchResult) {
  selectedLabel.value = optionLabel(c);
  results.value = [];
  query.value = '';
  emit('select', c);
}
</script>

<template>
  <div class="grid gap-2">
    <UInput v-model="query" :placeholder="props.placeholder" icon="i-heroicons-magnifying-glass" />
    <p v-if="selectedLabel" class="text-xs text-gray-500">Selected: {{ selectedLabel }}</p>
    <p v-else-if="loading" class="text-xs text-gray-400">Searching…</p>
    <p v-else-if="query.trim().length >= 2 && results.length === 0" class="text-xs text-gray-400">
      No matches.
    </p>
    <div v-if="results.length" class="grid gap-1">
      <UButton
        v-for="c in results"
        :key="`${c.latitude},${c.longitude}`"
        variant="ghost"
        class="justify-start"
        @click="choose(c)"
      >
        {{ optionLabel(c) }}
      </UButton>
    </div>
  </div>
</template>
