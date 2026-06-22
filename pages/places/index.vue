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
// The create form needs to represent "not specified" for humidity, which the API stores
// as null. The CreatePlace DTO type cannot hold the '' sentinel, so the form uses a local
// type with humidityCharacter widened to include '', and submit() maps '' -> omitted.
type PlaceForm = Omit<CreatePlace, 'humidityCharacter'> & { humidityCharacter: HumidityCharacter | '' };

const humidityOptions: { label: string; value: HumidityCharacter | '' }[] = [
  { label: 'Not specified', value: '' },
  { label: 'Dry', value: 'DRY' },
  { label: 'Normal', value: 'NORMAL' },
  { label: 'Humid', value: 'HUMID' },
];

const form = reactive<PlaceForm>({
  cityId: '', name: '', indoor: true, lightType: 'BRIGHT_INDIRECT',
  climateControlled: false, humidityCharacter: '', indoorTempMinC: null, indoorTempMaxC: null,
});
const cityOptions = computed(() => (cities.value ?? []).map((c) => ({ label: c.name, value: c.id })));

const editing = ref(false);
const editId = ref('');
const editName = ref('');
const editClimate = ref(false);
const savingEdit = ref(false);

function openEdit(p: { id: string; name: string; climateControlled: boolean }) {
  editId.value = p.id;
  editName.value = p.name;
  editClimate.value = p.climateControlled;
  editing.value = true;
}

async function saveEdit() {
  savingEdit.value = true;
  try {
    await api.updatePlace(editId.value, { name: editName.value, climateControlled: editClimate.value });
    editing.value = false;
    await refresh();
  } finally { savingEdit.value = false; }
}

// UInput's v-model is `string | number | undefined`; the DTO field is `number | null`.
// Bridge the two so an empty input reads/writes as the contract's `null` without leaking
// `null` into the component's typed model. `v-model.number` yields the empty string ''
// (not undefined) when the user clears a typed value, so coerce anything that is not a
// finite number to `null` — otherwise '' would reach the `number | null` DTO and 400.
const toNullableNumber = (v: number | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const indoorTempMinC = computed<number | undefined>({
  get: () => form.indoorTempMinC ?? undefined,
  set: (v) => { form.indoorTempMinC = toNullableNumber(v); },
});
const indoorTempMaxC = computed<number | undefined>({
  get: () => form.indoorTempMaxC ?? undefined,
  set: (v) => { form.indoorTempMaxC = toNullableNumber(v); },
});

async function submit() {
  // Outdoor places ignore the indoor-only fields; send only what applies. For indoor
  // places, an unspecified humidity ('') is dropped so the API stores null.
  const payload: CreatePlace = form.indoor
    ? {
        cityId: form.cityId, name: form.name, indoor: true, lightType: form.lightType,
        climateControlled: form.climateControlled,
        ...(form.humidityCharacter ? { humidityCharacter: form.humidityCharacter } : {}),
        indoorTempMinC: form.indoorTempMinC, indoorTempMaxC: form.indoorTempMaxC,
      }
    : { cityId: form.cityId, name: form.name, indoor: false, lightType: form.lightType };
  await api.createPlace(payload);
  Object.assign(form, {
    name: '', climateControlled: false, humidityCharacter: '', indoorTempMinC: null, indoorTempMaxC: null,
  });
  await refresh();
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-3">Places</h2>
    <div class="grid gap-2 mb-6">
      <UCard v-for="p in places" :key="p.id">
        <div class="flex items-center justify-between gap-2">
          <div>
            <span class="font-medium">{{ p.name }}</span>
            <span class="text-xs text-gray-500"> · {{ p.indoor ? 'Indoor' : 'Outdoor' }} · {{ p.lightType }}</span>
          </div>
          <UButton size="xs" color="gray" variant="soft" icon="i-heroicons-pencil-square" @click="openEdit(p)">Edit</UButton>
        </div>
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
        <UAlert
          v-if="!form.humidityCharacter || form.indoorTempMinC === null || form.indoorTempMaxC === null"
          color="amber"
          variant="subtle"
          title="Optional, but recommended"
          description="Add this room's humidity and temperature range for more accurate care. Without them we estimate from your local outdoor weather."
        />
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

    <UModal v-model="editing">
      <UCard>
        <template #header><h3 class="font-semibold">Edit place</h3></template>
        <div class="grid gap-3">
          <UFormGroup label="Name"><UInput v-model="editName" /></UFormGroup>
          <UFormGroup label="Climate controlled"><UToggle v-model="editClimate" /></UFormGroup>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="gray" variant="ghost" @click="editing = false">Cancel</UButton>
            <UButton color="green" :loading="savingEdit" @click="saveEdit">Save</UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>
