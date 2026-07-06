<script setup lang="ts">
import type { CreatePlace, HumidityCharacter, LightType } from '../../types/api.js';

const { t } = useI18n();
const api = useApi();
const isDesktop = useIsDesktop();

useHead(() => ({ title: t('meta.places.title') }));
useSeoMeta({ description: () => t('meta.places.description') });

const { data: places, refresh } = await useAsyncData('places', () => api.listPlaces());
const { data: cities } = await useAsyncData('cities', () => api.listCities());

// Option labels come from the SAME places.light_*/humidity_* keys the cards use, so the
// form wording and the card wording share one key set (no fork). Values stay as the enum.
const lightOptions = computed<{ label: string; value: LightType }[]>(() => [
  { label: t('places.light_DIRECT'), value: 'DIRECT' },
  { label: t('places.light_BRIGHT_INDIRECT'), value: 'BRIGHT_INDIRECT' },
  { label: t('places.light_MEDIUM'), value: 'MEDIUM' },
  { label: t('places.light_LOW'), value: 'LOW' },
]);
// The create form needs to represent "not specified" for humidity, which the API stores
// as null. The CreatePlace DTO type cannot hold the '' sentinel, so the form uses a local
// type with humidityCharacter widened to include '', and submit() maps '' -> omitted.
type PlaceForm = Omit<CreatePlace, 'humidityCharacter'> & { humidityCharacter: HumidityCharacter | '' };

const humidityOptions = computed<{ label: string; value: HumidityCharacter | '' }[]>(() => [
  { label: t('places.humidity_NONE'), value: '' },
  { label: t('places.humidity_DRY'), value: 'DRY' },
  { label: t('places.humidity_NORMAL'), value: 'NORMAL' },
  { label: t('places.humidity_HUMID'), value: 'HUMID' },
]);

const form = reactive<PlaceForm>({
  cityId: '', name: '', indoor: true, lightType: 'BRIGHT_INDIRECT',
  climateControlled: false, humidityCharacter: '', indoorTempMinC: null, indoorTempMaxC: null,
});
const cityOptions = computed(() => (cities.value ?? []).map((c) => ({ label: c.name, value: c.id })));

// UInput's v-model is `string | number`; the DTO field is `number | null`.
// Bridge the two so an empty input reads/writes as the contract's `null` without leaking
// `null` into the component's typed model. `v-model.number` yields the empty string ''
// (not undefined) when the user clears a typed value, so coerce anything that is not a
// finite number to `null` — otherwise '' would reach the `number | null` DTO and 400.
const toNullableNumber = (v: number | string): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const indoorTempMinC = computed<number | string>({
  get: () => form.indoorTempMinC ?? '',
  set: (v) => { form.indoorTempMinC = toNullableNumber(v); },
});
const indoorTempMaxC = computed<number | string>({
  get: () => form.indoorTempMaxC ?? '',
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

const editing = ref(false);
const editPlace = ref<{ id: string; name: string; climateControlled: boolean } | null>(null);

function openEdit(p: { id: string; name: string; climateControlled: boolean }) {
  editPlace.value = { id: p.id, name: p.name, climateControlled: p.climateControlled };
  editing.value = true;
}

async function onEdited() {
  await refresh();
}

const valid = computed(() => !!form.cityId && !!form.name);
const indoorIncomplete = computed(
  () => !form.humidityCharacter || form.indoorTempMinC === null || form.indoorTempMaxC === null,
);
</script>

<template>
  <div>
    <UiScreenHeader :title="$t('places.title')" :subtitle="$t('places.subtitle')" />

    <div :class="isDesktop ? 'mp-places mp-places--desktop' : 'mp-places'">
      <div>
        <UiCard v-if="!places?.length" padded>
          <UiEmptyState>{{ $t('places.empty') }}</UiEmptyState>
        </UiCard>
        <UiCardGrid v-else :desktop="isDesktop" :min="260" :gap="12">
          <UiCard v-for="p in places" :key="p.id" padded>
            <div class="mp-place-row">
              <UiIconTile :icon="p.indoor ? 'home' : 'sun'" :tone="p.indoor ? 'green' : 'cafe'" :size="40" />
              <div class="mp-place-row__info">
                <div class="mp-place-row__name">{{ p.name }}</div>
                <div class="mp-place-row__meta">{{ p.indoor ? $t('places.indoor') : $t('places.outdoor') }} · {{ $t('places.light_' + p.lightType) }}</div>
              </div>
              <UiBadge v-if="p.humidityCharacter" color="neutral" size="xs">{{ $t('places.humidity_' + p.humidityCharacter) }}</UiBadge>
              <UiButton size="xs" variant="ghost" color="neutral" icon="pencil-square" @click="openEdit(p)">{{ $t('common.edit') }}</UiButton>
            </div>
          </UiCard>
        </UiCardGrid>
      </div>

      <div>
        <UiSectionTitle>{{ $t('places.addTitle') }}</UiSectionTitle>
        <form class="mp-form" @submit.prevent="submit">
          <UiFormGroup :label="$t('places.city')" required>
            <UiSelectField v-model="form.cityId" :options="cityOptions" :placeholder="$t('places.pickCity')" />
          </UiFormGroup>
          <UiFormGroup :label="$t('places.name')" required>
            <UiInput v-model="form.name" :placeholder="$t('places.namePlaceholder')" />
          </UiFormGroup>
          <UiFormGroup :label="$t('places.light')" required>
            <UiSelectField v-model="form.lightType" :options="lightOptions" />
          </UiFormGroup>
          <UiFormGroup :label="$t('places.indoorLabel')">
            <div class="mp-place-switch">
              <UiSwitch v-model="form.indoor" />
              <span class="mp-place-switch__text">{{ form.indoor ? $t('places.indoor') : $t('places.outdoor') }}</span>
            </div>
          </UiFormGroup>

          <template v-if="form.indoor">
            <UiAlert
              v-if="indoorIncomplete"
              color="amber"
              :title="$t('places.optionalTitle')"
              :description="$t('places.optionalDesc')"
            />
            <UiFormGroup :label="$t('places.climateControlled')">
              <div class="mp-place-switch">
                <UiSwitch v-model="form.climateControlled" />
                <span class="mp-place-switch__text">{{ form.climateControlled ? $t('common.yes') : $t('common.no') }}</span>
              </div>
            </UiFormGroup>
            <UiFormGroup :label="$t('places.humidityCharacter')">
              <UiSelectField v-model="form.humidityCharacter" :options="humidityOptions" />
            </UiFormGroup>
            <div class="mp-place-temps">
              <UiFormGroup :label="$t('places.tempMin')">
                <UiInput v-model.number="indoorTempMinC" type="number" step="0.5" />
              </UiFormGroup>
              <UiFormGroup :label="$t('places.tempMax')">
                <UiInput v-model.number="indoorTempMaxC" type="number" step="0.5" />
              </UiFormGroup>
            </div>
          </template>

          <UiButton type="submit" block :disabled="!valid">{{ $t('places.addPlace') }}</UiButton>
        </form>
      </div>
    </div>

    <PlaceEditModal v-model="editing" :place="editPlace" @saved="onEdited" />
  </div>
</template>

<style scoped>
.mp-places {
  display: grid;
  gap: 26px;
}

.mp-places--desktop {
  grid-template-columns: 1fr 380px;
  gap: 28px;
  align-items: start;
}

.mp-place-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mp-place-row__info {
  flex: 1;
  min-width: 0;
}

.mp-place-row__name {
  font: 700 15px var(--font-sans);
  color: var(--text-strong);
}

.mp-place-row__meta {
  font: 13px var(--font-sans);
  color: var(--text-muted);
}

.mp-place-switch {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mp-place-switch__text {
  font: 14px var(--font-sans);
  color: var(--text-muted);
}

.mp-place-temps {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
</style>
