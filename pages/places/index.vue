<script setup lang="ts">
import type { CreatePlace, LightType } from '../../types/api.js';

const api = useApi();
const { data: places, refresh } = await useAsyncData('places', () => api.listPlaces());
const { data: cities } = await useAsyncData('cities', () => api.listCities());

const lightOptions: { label: string; value: LightType }[] = [
  { label: 'Direct sun', value: 'DIRECT' },
  { label: 'Bright indirect', value: 'BRIGHT_INDIRECT' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'Low', value: 'LOW' },
];

const form = reactive<CreatePlace>({ cityId: '', name: '', indoor: true, lightType: 'BRIGHT_INDIRECT' });
const cityOptions = computed(() => (cities.value ?? []).map((c) => ({ label: c.name, value: c.id })));

async function submit() {
  await api.createPlace({ ...form });
  Object.assign(form, { name: '' });
  await refresh();
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-3">Places</h2>
    <div class="grid gap-2 mb-6">
      <UCard v-for="p in places" :key="p.id">
        <span class="font-medium">{{ p.name }}</span>
        <span class="text-xs text-gray-500"> · {{ p.indoor ? 'Indoor' : 'Outdoor' }} · {{ p.lightType }}</span>
      </UCard>
    </div>
    <UForm :state="form" class="grid gap-3 max-w-md" @submit="submit">
      <UFormGroup label="City" required>
        <USelect v-model="form.cityId" :options="cityOptions" placeholder="Pick a city" />
      </UFormGroup>
      <UFormGroup label="Name" required><UInput v-model="form.name" placeholder="e.g. Living room window" /></UFormGroup>
      <UFormGroup label="Indoor"><UToggle v-model="form.indoor" /></UFormGroup>
      <UFormGroup label="Light"><USelect v-model="form.lightType" :options="lightOptions" /></UFormGroup>
      <UButton type="submit" :disabled="!form.cityId || !form.name">Add place</UButton>
    </UForm>
  </div>
</template>
