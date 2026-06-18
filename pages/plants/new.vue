<script setup lang="ts">
import type { CreatePlant } from '../../types/api.js';

const api = useApi();
const router = useRouter();
const { data: species } = await useAsyncData('species', () => api.listSpecies());
const { data: places } = await useAsyncData('places', () => api.listPlaces());

const form = reactive<CreatePlant>({
  speciesSlug: '',
  placeId: '',
  nickname: '',
  acquiredOn: new Date().toISOString().slice(0, 10),
});
const error = ref('');

const speciesOptions = computed(() => (species.value ?? []).map((s) => ({ label: s.scientificName, value: s.slug })));
const placeOptions = computed(() => (places.value ?? []).map((p) => ({ label: p.name, value: p.id })));

async function submit() {
  error.value = '';
  try {
    const plant = await api.createPlant({ ...form, nickname: form.nickname || undefined });
    await api.recompute();
    await router.push(`/plants/${plant.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-3">Add a plant</h2>
    <UForm :state="form" class="grid gap-3 max-w-md" @submit="submit">
      <UFormGroup label="Species" required>
        <USelect v-model="form.speciesSlug" :options="speciesOptions" placeholder="Pick a species" />
      </UFormGroup>
      <UFormGroup label="Place" required>
        <USelect v-model="form.placeId" :options="placeOptions" placeholder="Pick a place" />
      </UFormGroup>
      <UFormGroup label="Nickname">
        <UInput v-model="form.nickname" placeholder="e.g. Monty" />
      </UFormGroup>
      <UFormGroup label="Acquired on" required>
        <UInput v-model="form.acquiredOn" type="date" />
      </UFormGroup>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
      <UButton type="submit" :disabled="!form.speciesSlug || !form.placeId">Add plant</UButton>
    </UForm>
  </div>
</template>
