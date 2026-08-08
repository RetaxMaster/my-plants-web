<script setup lang="ts">
// Owner-scoped settings. The app had no home for these before measured soil; this is the first one.
import Card from '../components/ui/Card.vue';
import ScreenHeader from '../components/ui/ScreenHeader.vue';
import SectionTitle from '../components/ui/SectionTitle.vue';
import Switch from '../components/ui/Switch.vue';
import Alert from '../components/ui/Alert.vue';
import Button from '../components/ui/Button.vue';
import InstrumentComparisonTable from '../components/ui/InstrumentComparisonTable.vue';
import type { InstrumentId } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';

const { t } = useI18n();
const api = useApi();

useHead(() => ({ title: t('meta.settings.title') }));
useSeoMeta({ description: () => t('meta.settings.description') });

// FIX (fix wave 1, item 6) — `error` used to be dropped on the floor: a failed `getOwnerInstruments()`
// rendered the header, the lead copy, zero instrument rows and a headers-only comparison table,
// indistinguishable from a genuinely empty catalogue. The catalogue is never legitimately empty
// (`available` is the full shared-contract table), so an empty render always means something failed —
// surface it with a retry, same component/shape as `PlantDetail.vue`'s `evaluationLoadFailed` banner.
const { data, error: loadError, refresh } = await useAsyncData('owner-instruments', () => api.getOwnerInstruments());
function retryLoad() {
  void refresh();
}
const saving = ref(false);
const error = ref<string | null>(null);

const selected = computed<Set<InstrumentId>>(() => new Set(data.value?.selected ?? []));

async function toggle(id: InstrumentId, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(id); else next.delete(id);
  saving.value = true;
  error.value = null;
  try {
    await api.setOwnerInstruments([...next]);
    await refresh();
  } catch {
    error.value = t('settings.instruments.saveFailed');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <ScreenHeader :title="t('settings.title')" :subtitle="t('settings.subtitle')" />

    <!-- Grid wrapper, same convention as pages/more.vue's .mp-more: stacked top-level Cards need an
         explicit gap, Card itself carries no outer margin. -->
    <div class="mp-settings">
      <Card>
        <SectionTitle>{{ t('settings.instruments.title') }}</SectionTitle>
        <p class="mp-settings__lead">{{ t('settings.instruments.lead') }}</p>

        <Alert
          v-if="loadError"
          color="red"
          :description="t('settings.instruments.loadError')"
          announce
        >
          <Button size="sm" variant="soft" color="neutral" @click="retryLoad">
            {{ t('settings.instruments.retry') }}
          </Button>
        </Alert>

        <Alert v-if="error" color="red" :description="error" announce />

        <div v-for="row in data?.available ?? []" :key="row.id" class="mp-settings__row">
          <div class="mp-settings__text">
            <div class="mp-settings__label">{{ t(`settings.instruments.name.${row.id}`) }}</div>
            <div class="mp-settings__sub">{{ t(`settings.instruments.help.${row.id}`) }}</div>
          </div>
          <Switch
            :model-value="selected.has(row.id)"
            :disabled="saving"
            :aria-label="t(`settings.instruments.name.${row.id}`)"
            @update:model-value="(v: boolean) => toggle(row.id, v)"
          />
        </div>
      </Card>

      <Card>
        <SectionTitle>{{ t('settings.instruments.compareTitle') }}</SectionTitle>
        <InstrumentComparisonTable :rows="data?.available ?? []" />
      </Card>
    </div>
  </div>
</template>

<style scoped>
.mp-settings { display: grid; gap: var(--space-4); }
.mp-settings__lead { color: var(--text-muted); margin: 0 0 var(--space-4); }
.mp-settings__row {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-3) 0; border-top: 1px solid var(--border-subtle);
}
.mp-settings__text { flex: 1; min-width: 0; }
.mp-settings__label { font-weight: var(--weight-bold); color: var(--text-strong); }
.mp-settings__sub { color: var(--text-muted); font-size: var(--text-sm); }
</style>
