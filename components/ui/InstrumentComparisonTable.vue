<script setup lang="ts">
// Decision support for the /settings picker (spec §4.6) — deliberately NOT shown in the measuring modal,
// where the owner is holding a probe over a pot. Reusable: it renders whatever rows it is handed, so a new
// instrument row appears here with no component change.
import type { InstrumentRow } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';

defineProps<{ rows: readonly InstrumentRow[] }>();
const { t } = useI18n();
</script>

<template>
  <!-- Wide content scrolls inside its OWN container; the page body never scrolls horizontally. -->
  <div class="mp-instrtable">
    <table class="mp-instrtable__table">
      <thead>
        <tr>
          <th scope="col">{{ t('settings.instruments.table.instrument') }}</th>
          <th scope="col">{{ t('settings.instruments.table.unit') }}</th>
          <th scope="col">{{ t('settings.instruments.table.comparable') }}</th>
          <th scope="col">{{ t('settings.instruments.table.calibration') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <th scope="row">{{ t(`settings.instruments.name.${row.id}`) }}</th>
          <td>{{ t(`settings.instruments.unit.${row.id}`) }}</td>
          <td>{{ row.comparableAcrossPots ? t('common.yes') : t('common.no') }}</td>
          <td>{{ row.requiresCalibration ? t('common.yes') : t('common.no') }}</td>
        </tr>
      </tbody>
    </table>
    <p class="mp-instrtable__note">{{ t('settings.instruments.table.note') }}</p>
  </div>
</template>

<style scoped>
.mp-instrtable { overflow-x: auto; }
.mp-instrtable__table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.mp-instrtable__table th,
.mp-instrtable__table td {
  padding: var(--space-2) var(--space-3);
  text-align: left;
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
}
.mp-instrtable__table thead th { color: var(--text-muted); font-weight: 500; }
.mp-instrtable__note { margin-top: var(--space-3); color: var(--text-muted); font-size: var(--text-xs); }
</style>
