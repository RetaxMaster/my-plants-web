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
/* DEF-7 (QA round 4, LOW, mobile 390x844): the table is 672px wide inside this 312px overflow-x:auto
   container. It already scrolled correctly, but nothing signalled that it scrolled — so the two
   right-hand columns, including the one telling the owner a kitchen scale needs per-pot setup, were
   fully clipped with no shadow/fade/scrollbar hint and read as ABSENT rather than as scrolled
   off-screen. This is an AFFORDANCE fix only: no column width, table content or layout changed below.

   The fix is the classic pure-CSS "scroll shadow" trick (two stacked background layers, no JS, no
   scroll listener): a `local`-attached "cover" layer travels WITH the scrolled content and is
   positioned flush with the table's true right edge, while a `scroll`-attached "shadow" layer stays
   pinned to the container's own right edge. At rest (scrollLeft 0) the cover sits off past the visible
   window, so the shadow shows through — the hint. As the owner scrolls right, the cover slides into
   view and lands exactly on top of the shadow once the container reaches its true end, so the hint
   fades itself out instead of lingering after the hidden columns have already been seen. Both colors
   come from existing tokens (--surface-card / --border-subtle) so it repaints correctly in dark mode
   with no new hex/rgba values, and nothing here is animated (static backgrounds repositioned by native
   scrolling only), so it does not touch the "never animate a blurred/mix-blend-mode'd element" rule. */
.mp-instrtable {
  overflow-x: auto;
  background-image:
    linear-gradient(to left, var(--surface-card), var(--surface-card) 45%, transparent),
    linear-gradient(to left, var(--border-subtle), transparent);
  background-position: top right, top right;
  background-size: var(--space-8) 100%, var(--space-8) 100%;
  background-repeat: no-repeat, no-repeat;
  background-attachment: local, scroll;
}
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
