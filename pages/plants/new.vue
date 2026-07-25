<script setup lang="ts">
import type { CreatePlant, SpeciesSummary } from '../../types/api.js';
import type { CompressedUpload } from '../../composables/useImageCompression.js';
import { todayYmd } from '../../utils/localDate.js';
import { pickLocalized } from '../../utils/localizedField.js';

const { t, locale } = useI18n();
const api = useApi();
const router = useRouter();

useHead(() => ({ title: t('meta.plantsNew.title') }));
useSeoMeta({ description: () => t('meta.plantsNew.description') });

const { data: species } = await useAsyncData('species', () => api.listSpecies());
const { data: places } = await useAsyncData('places', () => api.listPlaces());

const form = reactive<CreatePlant>({
  speciesSlug: '',
  placeId: '',
  nickname: '',
  acquiredOn: todayYmd(),
});
// Deferred cover selection: held here and uploaded AFTER the plant is created (no plantId exists yet).
// ACTIVE-create only — an import uses the batch picker below instead.
const photoFiles = ref<File[]>([]);
const error = ref('');
const submitting = ref(false);

// --- Import-on-create: two mutually-exclusive sliders (plan Task 29 step 1). Both off = a normal ACTIVE
// create. On, the created plant is FROZEN at that lifecycle state from birth (species still required,
// place becomes optional — a MEMORIAL/GIFTED plant carries no place per the ACTIVE ⇒ place invariant).
const importState = ref<'ACTIVE' | 'MEMORIAL' | 'GIFTED'>('ACTIVE');
function toggleMemorial(on: boolean) { importState.value = on ? 'MEMORIAL' : 'ACTIVE'; }
function toggleGift(on: boolean) { importState.value = on ? 'GIFTED' : 'ACTIVE'; }
// Writable computeds so the two Switches can just `v-model` onto them while keeping the exclusivity rule
// (turning one on turns the other off) centralized in toggleMemorial/toggleGift, exactly as the plan lays out.
const memorialOn = computed({ get: () => importState.value === 'MEMORIAL', set: toggleMemorial });
const giftOn = computed({ get: () => importState.value === 'GIFTED', set: toggleGift });
const isImport = computed(() => importState.value !== 'ACTIVE');
const valid = computed(() => !!form.speciesSlug && (isImport.value || !!form.placeId));

// --- Import photo batch (up to 50), reusing the SAME `UiImageDropzone` (compress mode) Spec 2 established
// for progress photos — no forked picker. `importResults` is 1:1 aligned with `importPhotos` by the
// component's own contract, already compressed + carrying the per-photo HD/savings state.
const importPhotos = ref<File[]>([]);
const importResults = ref<CompressedUpload[]>([]);
const IMPORT_MAX = 50;

// A stable uuid per selected file, assigned the moment it enters `importPhotos` (at selection time, per
// the plan) and never reassigned afterward. Because the Map is keyed by File identity and the array isn't
// cleared on a failed submit, a later retry sees the SAME File objects and therefore the SAME keys — which
// is exactly what makes the server's per-clientKey idempotency line up across a retry.
const clientKeyMap = new Map<File, string>();
watch(
  importPhotos,
  (files) => {
    for (const f of files) if (!clientKeyMap.has(f)) clientKeyMap.set(f, crypto.randomUUID());
  },
  { immediate: true },
);

const speciesLabel = (s: SpeciesSummary) => {
  const common = pickLocalized(locale.value, s.commonNameEs, s.commonNameEn);
  return common && common !== s.scientificName ? `${common} (${s.scientificName})` : s.scientificName;
};

const speciesOptions = computed(() =>
  (species.value ?? []).map((s) => ({
    label: speciesLabel(s),
    value: s.slug,
  })),
);
const placeOptions = computed(() => (places.value ?? []).map((p) => ({ label: p.name, value: p.id })));

// --- Retry durability (plan Task 29, critical): hold the created plant's id so a retried submit after a
// failed chunk NEVER calls createPlant a second time (which would duplicate the plant). `uploadedClientKeys`
// tracks which photos are already durably on the server so a retry resends only the outstanding ones — and
// even if one were resent anyway, the server's per-clientKey idempotency makes it a no-op, never a duplicate.
const createdPlantId = ref<string | null>(null);
const uploadedClientKeys = new Set<string>();

async function runImportBatch(plantId: string) {
  const files = importPhotos.value;
  const results = importResults.value;
  const outstanding = files
    .map((file, i) => ({ result: results[i], key: clientKeyMap.get(file)! }))
    .filter((item) => !uploadedClientKeys.has(item.key));
  const CHUNK = 8;
  for (let i = 0; i < outstanding.length; i += CHUNK) {
    const slice = outstanding.slice(i, i + CHUNK);
    const chunkForm = new FormData();
    for (const item of slice) {
      chunkForm.append('photos', item.result.blob, item.result.filename);
      chunkForm.append('clientKeys', item.key);
    }
    // Idempotent per clientKey: a retried chunk (e.g. one whose response was lost) is a durable no-op.
    await api.appendImportChunk(plantId, chunkForm);
    for (const item of slice) uploadedClientKeys.add(item.key);
  }
  // Close the batch for EVERY import, including a zero-photo one (`outstanding` empty on the first pass) —
  // an import left open would otherwise sit until the TTL sweep instead of being closed here and now.
  await api.finishImport(plantId);
}

async function submit() {
  error.value = '';
  submitting.value = true;
  try {
    let plantId = createdPlantId.value;
    if (!plantId) {
      const plant = await api.createPlant({
        speciesSlug: form.speciesSlug,
        placeId: form.placeId || undefined,
        nickname: form.nickname || undefined,
        acquiredOn: form.acquiredOn,
        lifecycleState: isImport.value ? (importState.value as 'MEMORIAL' | 'GIFTED') : undefined,
      });
      createdPlantId.value = plant.id;
      plantId = plant.id;
    }
    if (isImport.value) {
      await runImportBatch(plantId);
    } else {
      // Optional cover: a failure here must NOT block the flow — the plant exists and the cover can be
      // added later from the detail hero. recompute + navigate run regardless (outside this try/catch).
      const file = photoFiles.value[0];
      if (file) {
        try {
          await api.setCoverPhoto(plantId, file);
        } catch (photoErr) {
          // Non-blocking (no toast system exists): warn and move on — the plant exists and the detail
          // hero offers "Add photo". Never surface a blocking error for the optional cover.
          console.warn('Cover photo upload failed; the plant was created without it.', photoErr);
        }
      }
      await api.recompute();
    }
    const dest =
      importState.value === 'MEMORIAL' ? `/pantheon/${plantId}` :
      importState.value === 'GIFTED' ? `/gifted/${plantId}` :
      `/plants/${plantId}`;
    await router.push(dest);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <UiScreenHeader
      :back="$t('nav.plants')"
      :title="$t('plantsNew.title')"
      :subtitle="$t('plantsNew.subtitle')"
      @back="navigateTo('/plants')"
    />
    <form class="mp-form" @submit.prevent="submit">
      <UiFormGroup :label="$t('plantsNew.species')" required>
        <UiSelectField v-model="form.speciesSlug" :options="speciesOptions" :placeholder="$t('plantsNew.pickSpecies')" />
      </UiFormGroup>

      <UiFormGroup :label="$t('plantsNew.importMemorialLabel')" :hint="$t('plantsNew.importMemorialHint')">
        <UiSwitch v-model="memorialOn" :disabled="giftOn" />
      </UiFormGroup>
      <UiFormGroup :label="$t('plantsNew.importGiftLabel')" :hint="$t('plantsNew.importGiftHint')">
        <UiSwitch v-model="giftOn" :disabled="memorialOn" />
      </UiFormGroup>

      <UiFormGroup
        :label="$t('plantsNew.place')"
        :required="!isImport"
        :hint="isImport ? $t('plantsNew.placeOptionalHint') : undefined"
      >
        <UiSelectField v-model="form.placeId" :options="placeOptions" :placeholder="$t('plantsNew.pickPlace')" />
      </UiFormGroup>

      <UiFormGroup :label="$t('plantsNew.nickname')" :hint="$t('plantsNew.nicknameHint')">
        <UiInput v-model="form.nickname" icon="sparkles" :placeholder="$t('plantsNew.nicknamePlaceholder')" />
      </UiFormGroup>

      <UiFormGroup v-if="!isImport" :label="$t('plantsNew.photoLabel')" :hint="$t('plantsNew.photoHint')">
        <UiImageDropzone v-model="photoFiles" :max="1" />
      </UiFormGroup>
      <UiFormGroup v-else :label="$t('plantsNew.importPhotosLabel')" :hint="$t('plantsNew.importPhotosHint')">
        <UiImageDropzone v-model="importPhotos" v-model:results="importResults" :max="IMPORT_MAX" compress />
      </UiFormGroup>

      <UiFormGroup :label="$t('plantsNew.acquiredOn')" required>
        <UiInput v-model="form.acquiredOn" type="date" />
      </UiFormGroup>
      <UiFormGroup v-if="error" :error="error" />
      <UiButton type="submit" block :disabled="!valid || submitting" :loading="submitting">{{ $t('plants.add') }}</UiButton>
    </form>
  </div>
</template>
