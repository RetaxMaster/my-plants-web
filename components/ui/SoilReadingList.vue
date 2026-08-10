<script setup lang="ts">
// THE READINGS THE OWNER HAS ACTUALLY TAKEN (QA UX-1, 2026-08-10).
//
// Until this existed, a saved reading vanished: no confirmation, no list, nothing anywhere on the page. QA
// had to query the API to prove the row had been written at all. For a feature whose entire pitch is
// "measure and verify", having nowhere to see your own measurements is a product hole rather than a polish
// item — and it is also what makes the SAVE believable, since the reappearing list is the confirmation.
//
// NO API CHANGE: `GET /plants/:id/soil-readings` already returns this history (newest first, capped at
// READING_PAGE = 60), and PlantDetail.vue already fetches it to feed the measuring modal. This component
// only renders what is already in hand.
import type { PlantSoilReadings } from '~/types/api';
// Explicit import, never a `new Date(ymd)` here: a bare `YYYY-MM-DD` is parsed as UTC midnight and then
// rendered through the local clock, so west of Greenwich every date in this list would read one day early.
// `utils/localDate.ts`'s header documents that exact trap; this is the helper that avoids it.
import { ymdToLocalDate } from '~/utils/localDate';

const props = defineProps<{ data: PlantSoilReadings }>();

const { t, d } = useI18n();

const rows = computed(() => props.data.readings);

/**
 * The instrument row a reading was taken with — looked up in the OWNER'S CURRENT SELECTION, which can no
 * longer contain it: deselecting an instrument in /settings does not retract the readings already taken
 * with it (the API is explicit that the selection is an ORDERING, never a filter). So this returns
 * `undefined` for a historical reading whose instrument the owner has since dropped, and every consumer
 * below degrades honestly rather than assuming the row is there.
 */
function instrumentFor(id: string) {
  return props.data.instruments.find((row) => row.id === id);
}

function instrumentName(id: string): string {
  return t(`settings.instruments.name.${id}`);
}

/**
 * The reading IN THE OWNER'S OWN TERMS.
 *
 * An ordinal instrument must render its NAMED STATE — "damp soil sticks to it" — and never the raw `1|2|3`
 * it happens to be stored as. Showing the number would undo the entire reason the ordinal capture exists:
 * the owner never chose a number, and handing one back invites them to reason about a scale we deliberately
 * refused to publish.
 *
 * A numeric instrument shows its value with its unit. An instrument no longer in the selection has no row
 * to tell us which it was, so it falls back to the bare stored value — the honest floor, since inventing a
 * label for an unknown scale would be worse than showing the number as recorded.
 */
function readingLabel(instrumentId: string, rawValue: number): string {
  const row = instrumentFor(instrumentId);
  if (row?.captureKind === 'ordinal') return t(`reading.levels.${instrumentId}.${rawValue}`);
  const unit = row ? t(`settings.instruments.unit.${instrumentId}`) : '';
  return unit ? `${rawValue} ${unit}` : String(rawValue);
}

/** Only a verdict that SAYS something is badged. `NONE` is the ordinary case — a reading recorded on its
 *  own, or the one a WATER_NOW survey writes — and badging every row "none" would be noise that buries the
 *  two rows that do carry a decision. */
function verdictLabel(verdict: string): string | null {
  return verdict === 'NONE' ? null : t(`reading.verdictBadge.${verdict}`);
}
</script>

<template>
  <div class="mp-readinglist">
    <p v-if="rows.length === 0" class="mp-readinglist__empty">{{ t('reading.historyEmpty') }}</p>
    <ol v-else class="mp-readinglist__list">
      <li v-for="row in rows" :key="row.id" class="mp-readinglist__row">
        <span class="mp-readinglist__date">{{ d(ymdToLocalDate(row.measuredOn), 'short') }}</span>
        <span class="mp-readinglist__value">{{ readingLabel(row.instrumentId, row.rawValue) }}</span>
        <span class="mp-readinglist__instrument">{{ instrumentName(row.instrumentId) }}</span>
        <UiBadge
          v-if="verdictLabel(row.verdict)"
          size="sm"
          :color="row.verdict === 'WATER_NOW' ? 'amber' : 'neutral'"
        >
          {{ verdictLabel(row.verdict) }}
        </UiBadge>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.mp-readinglist { margin-top: var(--space-3); }
.mp-readinglist__empty { margin: 0; font-size: var(--text-sm); color: var(--text-faint); }
.mp-readinglist__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.mp-readinglist__row {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2);
  font-size: var(--text-sm); color: var(--text-body);
}
.mp-readinglist__date { color: var(--text-faint); font-variant-numeric: tabular-nums; }
.mp-readinglist__value { font-weight: var(--weight-semibold); color: var(--text-strong); }
.mp-readinglist__instrument { color: var(--text-faint); }
</style>
