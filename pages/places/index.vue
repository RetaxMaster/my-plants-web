<script setup lang="ts">
import type { CreatePlace, HumidityCharacter, LightType } from '../../types/api.js';

const api = useApi();
const { data: places, refresh } = await useAsyncData('places', () => api.listPlaces());
const { data: cities } = await useAsyncData('cities', () => api.listCities());

const lightOptions: { label: string; value: LightType }[] = [
  { label: 'Direct sun', value: 'DIRECT' },
  { label: 'Bright indirect', value: 'BRIGHT_INDIRECT' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'Low', value: 'LOW' },
];
const humidityOptions: { label: string; value: HumidityCharacter }[] = [
  { label: 'Dry', value: 'DRY' },
  { label: 'Normal', value: 'NORMAL' },
  { label: 'Humid', value: 'HUMID' },
];

const form = reactive<CreatePlace>({
  cityId: '', name: '', indoor: true, lightType: 'BRIGHT_INDIRECT',
  climateControlled: false, humidityCharacter: 'NORMAL', indoorTempMinC: null, indoorTempMaxC: null,
});
const cityOptions = computed(() => (cities.value ?? []).map((c) => ({ label: c.name, value: c.id })));

// UInput's v-model is `string | number | undefined`; the DTO field is `number | null`.
// Bridge the two so an empty input reads/writes as the contract's `null` without leaking
// `null` into the component's typed model.
const indoorTempMinC = computed<number | undefined>({
  get: () => form.indoorTempMinC ?? undefined,
  set: (v) => { form.indoorTempMinC = v ?? null; },
});
const indoorTempMaxC = computed<number | undefined>({
  get: () => form.indoorTempMaxC ?? undefined,
  set: (v) => { form.indoorTempMaxC = v ?? null; },
});

async function submit() {
  // Outdoor places ignore the indoor-only fields; send only what applies.
  const payload: CreatePlace = form.indoor
    ? { ...form }
    : { cityId: form.cityId, name: form.name, indoor: false, lightType: form.lightType };
  await api.createPlace(payload);
  Object.assign(form, {
    name: '', climateControlled: false, humidityCharacter: 'NORMAL', indoorTempMinC: null, indoorTempMaxC: null,
  });
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
      <UFormGroup label="Light" required><USelect v-model="form.lightType" :options="lightOptions" /></UFormGroup>

      <template v-if="form.indoor">
        <UFormGroup label="Climate controlled"><UToggle v-model="form.climateControlled" /></UFormGroup>
        <UFormGroup label="Humidity character">
          <USelect v-model="form.humidityCharacter" :options="humidityOptions" />
        </UFormGroup>
        <UFormGroup label="Indoor temp min (°C)">
          <UInput v-model.number="indoorTempMinC" type="number" step="0.5" />
        </UFormGroup>
        <UFormGroup label="Indoor temp max (°C)">
          <UInput v-model.number="indoorTempMaxC" type="number" step="0.5" />
        </UFormGroup>
      </template>

      <UButton type="submit" :disabled="!form.cityId || !form.name">Add place</UButton>
    </UForm>
  </div>
</template>
