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
  <div class="mp-citysearch">
    <UiInput v-model="query" :placeholder="props.placeholder" icon="magnifying-glass" />
    <p v-if="selectedLabel" class="mp-citysearch__note">Selected: {{ selectedLabel }}</p>
    <p v-else-if="loading" class="mp-citysearch__note mp-citysearch__note--faint">Searching…</p>
    <p
      v-else-if="query.trim().length >= 2 && results.length === 0"
      class="mp-citysearch__note mp-citysearch__note--faint"
    >
      No matches.
    </p>
    <div v-if="results.length" class="mp-search-pop">
      <button
        v-for="c in results"
        :key="`${c.latitude},${c.longitude}`"
        type="button"
        class="mp-search-opt"
        @click="choose(c)"
      >
        <UiAppIcon name="map-pin" :size="16" color="var(--text-faint)" />
        <span class="mp-search-opt__label">{{ optionLabel(c) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mp-citysearch {
  position: relative;
  display: grid;
  gap: var(--space-2);
}

.mp-citysearch__note {
  font: 12px var(--font-sans);
  color: var(--text-muted);
  margin: 0;
}

.mp-citysearch__note--faint {
  color: var(--text-faint);
}

.mp-search-opt__label {
  font: 14px var(--font-sans);
  color: var(--text-body);
  text-align: left;
}
</style>
