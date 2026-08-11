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
import { INSTRUMENTS } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import type { InstrumentRow } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';

const props = defineProps<{ data: PlantSoilReadings }>();

const { t, d } = useI18n();

const rows = computed(() => props.data.readings);

/**
 * The instrument row a reading was taken with — resolved from the SHARED CONTRACT'S CATALOGUE, keyed by the
 * id stored on the reading itself.
 *
 * ⚠️ IT USED TO READ `props.data.instruments`, THE OWNER'S CURRENT SELECTION, AND THAT WAS A REGRESSION OF
 * THIS COMPONENT'S OWN RULE (QA, 2026-08-10). Deselecting an instrument in /settings does not retract the
 * readings taken with it — the selection is an ORDERING, never a filter — so the row simply vanished from
 * that array, `captureKind` came back `undefined`, and every past stick or finger reading fell through to
 * the bare-value branch and rendered as `2` or `3`: precisely the raw ordinal number the paragraph below
 * exists to forbid. One toggle in Settings was enough to reach it.
 *
 * The lesson is narrower than "look somewhere else": the CATALOGUE (what instruments exist, and what shape
 * each one reports) and the SELECTION (which ones this owner measures with) are two different facts, and
 * only the first can answer "how should this reading be displayed". A reading is a historical statement;
 * what the owner ticked afterwards cannot change what it was.
 */
function instrumentFor(id: string) {
  return (INSTRUMENTS as Record<string, InstrumentRow | undefined>)[id];
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
 * A numeric instrument shows its value with its unit.
 *
 * The bare-value fallback survives, but it now means what it always claimed to: an id THE CONTRACT DOES NOT
 * KNOW — a row retired from the catalogue in some future release, leaving readings behind. That is the only
 * case where no honest label exists, and showing the number as recorded beats inventing one for a scale
 * nobody can describe. It is emphatically NOT the case of an instrument the owner merely un-ticked, which
 * is what this fallback used to swallow.
 */
function readingLabel(instrumentId: string, rawValue: number): string {
  const row = instrumentFor(instrumentId);
  if (row?.captureKind === 'ordinal') return t(`reading.levels.${instrumentId}.${rawValue}`);
  const unit = row ? t(`settings.instruments.unit.${instrumentId}`) : '';
  return unit ? `${rawValue} ${unit}` : String(rawValue);
}

/**
 * Has this reading been INTERPRETED — i.e. does a moisture value exist for it at all?
 *
 * A raw number is not a moisture: a kitchen scale's `1450 g` means nothing until this pot's two reference
 * weights (bone dry, freshly watered) are on file. A reading taken before calibration is therefore stored
 * honestly with `wetness: null`, and the first calibration BACKFILLS it. `typeof` rather than `!== null`
 * because an absent key must land in the same honest branch as an explicit null, never in the numeric one.
 */
function isInterpreted(wetness: number | null): wetness is number {
  return typeof wetness === 'number';
}

/**
 * The moisture the raw value TURNED OUT TO MEAN — the payoff for calibrating.
 *
 * ⚠️ THE LIST USED TO RENDER NOTHING HERE (QA F5, 2026-08-10). The first calibration really did backfill the
 * old readings — `wetness` went from `null` to `0.75` in the database — and the list looked byte-identical
 * before and after: `Aug 10, 2026 · 1450 grams · Kitchen scale`. The owner did the work of weighing the pot
 * twice and got no visible payoff whatsoever, which reads as "calibration did nothing".
 *
 * Two rules hold this honest, and neither is cosmetic:
 *
 * 1. The stored `wetness` is a 0..1 FRACTION of this pot's own dry→watered span. That is our internal unit,
 *    not the owner's, so it is published as a rounded percentage — a raw `0.7559` would both invite
 *    false precision and read as a scale nobody was ever shown.
 * 2. An UNINTERPRETED reading gets its own words. It must never render as `0`, `0%` or a blank gap: each of
 *    those is a positive claim ("this pot is bone dry" / "nothing to see") about a measurement we have
 *    explicitly declined to interpret. Saying "no moisture reading" is the whole point of storing `null`
 *    instead of guessing, and it is also what makes the backfill legible — the marker is what disappears.
 */
function wetnessLabel(wetness: number | null): string {
  return isInterpreted(wetness)
    ? t('reading.wetnessPct', { pct: Math.round(wetness * 100) })
    : t('reading.wetnessUnknown');
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
        <span
          class="mp-readinglist__wetness"
          :class="{ 'mp-readinglist__wetness--unknown': !isInterpreted(row.wetness) }"
        >{{ wetnessLabel(row.wetness) }}</span>
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
/* An interpreted moisture reads as a figure; an uninterpreted one must not be mistakable for one — hence a
   different colour AND a different face, on top of the different words. */
.mp-readinglist__wetness { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.mp-readinglist__wetness--unknown { color: var(--text-faint); font-style: italic; }
</style>
