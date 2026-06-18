<script setup lang="ts">
import type { CreateCity } from '../../types/api.js';

const api = useApi();
const { data: cities, refresh } = await useAsyncData('cities', () => api.listCities());

const form = reactive<CreateCity>({ name: '', latitude: 0, longitude: 0, timezone: 'America/Mexico_City', isPrimary: false });

async function submit() {
  await api.createCity({ ...form });
  Object.assign(form, { name: '' });
  await refresh();
}
async function makePrimary(id: string) {
  await api.makePrimaryCity(id);
  await refresh();
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-3">Cities</h2>
    <div class="grid gap-2 mb-6">
      <UCard v-for="c in cities" :key="c.id">
        <div class="flex items-center justify-between">
          <span class="font-medium">{{ c.name }} <UBadge v-if="c.isPrimary" color="green" size="xs">Primary</UBadge></span>
          <UButton v-if="!c.isPrimary" size="xs" variant="ghost" @click="makePrimary(c.id)">Make primary</UButton>
        </div>
        <span class="text-xs text-gray-500">{{ c.timezone }}</span>
      </UCard>
    </div>
    <UForm :state="form" class="grid gap-3 max-w-md" @submit="submit">
      <UFormGroup label="Name" required><UInput v-model="form.name" /></UFormGroup>
      <UFormGroup label="Latitude" required><UInput v-model.number="form.latitude" type="number" step="0.0001" /></UFormGroup>
      <UFormGroup label="Longitude" required><UInput v-model.number="form.longitude" type="number" step="0.0001" /></UFormGroup>
      <UFormGroup label="Timezone" required><UInput v-model="form.timezone" /></UFormGroup>
      <UFormGroup label="Primary"><UToggle v-model="form.isPrimary" /></UFormGroup>
      <UButton type="submit" :disabled="!form.name">Add city</UButton>
    </UForm>
  </div>
</template>
