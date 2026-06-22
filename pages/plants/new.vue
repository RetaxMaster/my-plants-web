<script setup lang="ts">
import type { CreatePlant } from '../../types/api.js';
import { todayYmd } from '../../utils/localDate.js';

const api = useApi();
const router = useRouter();
const { data: species } = await useAsyncData('species', () => api.listSpecies());
const { data: places } = await useAsyncData('places', () => api.listPlaces());

const form = reactive<CreatePlant>({
  speciesSlug: '',
  placeId: '',
  nickname: '',
  acquiredOn: todayYmd(),
});
const error = ref('');

const speciesOptions = computed(() =>
  (species.value ?? []).map((s) => ({
    label:
      s.commonName && s.commonName !== s.scientificName
        ? `${s.commonName} (${s.scientificName})`
        : s.scientificName,
    value: s.slug,
  })),
);
const placeOptions = computed(() => (places.value ?? []).map((p) => ({ label: p.name, value: p.id })));

const valid = computed(() => !!form.speciesSlug && !!form.placeId);

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
    <UiScreenHeader
      back="Plants"
      title="Add a plant"
      subtitle="Tell us the species and where it lives."
      @back="navigateTo('/plants')"
    />
    <form class="mp-form" @submit.prevent="submit">
      <UiFormGroup label="Species" required>
        <UiSelectField v-model="form.speciesSlug" :options="speciesOptions" placeholder="Pick a species" />
      </UiFormGroup>
      <UiFormGroup label="Place" required>
        <UiSelectField v-model="form.placeId" :options="placeOptions" placeholder="Pick a place" />
      </UiFormGroup>
      <UiFormGroup label="Nickname" hint="Optional — what you call this plant.">
        <UiInput v-model="form.nickname" icon="sparkles" placeholder="e.g. Monty" />
      </UiFormGroup>
      <UiFormGroup label="Acquired on" required>
        <UiInput v-model="form.acquiredOn" type="date" />
      </UiFormGroup>
      <UiFormGroup v-if="error" :error="error" />
      <UiButton type="submit" block :disabled="!valid">Add plant</UiButton>
    </form>
  </div>
</template>
