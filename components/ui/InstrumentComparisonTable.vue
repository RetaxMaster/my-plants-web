<script setup lang="ts">
// Decision support for the /settings picker (spec §4.6) — deliberately NOT shown in the measuring modal,
// where the owner is holding a probe over a pot. Reusable: it renders whatever rows it is handed, so a new
// instrument row appears here with no component change.
import type { InstrumentRow } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import { hasMoreToScrollRight } from '~/utils/scrollAffordance';

const props = defineProps<{ rows: readonly InstrumentRow[] }>();
const { t } = useI18n();

/**
 * ⚠️ THE SCROLL HINT IS MEASURED NOW, NOT PAINTED AND HOPED FOR (QA round 5, F4.1).
 *
 * DEF-7 (round 4) shipped the classic pure-CSS "scroll shadow": two stacked background layers, one attached
 * `local` so it travels with the content and one attached `scroll` so it stays pinned to the container's
 * right edge, arranged so the travelling one lands on top of the pinned one at the end of the scroll and
 * puts the hint out. It is elegant and it is untestable, and QA round 5 measured it still drawing at
 * `scrollLeft = 9999` — an affordance that goes on saying "there is more over here" once there is not.
 *
 * SO THE STATE IS READ FROM THE ELEMENT INSTEAD, and the class it drives is something a unit test can turn
 * red in both directions. The predicate itself is a pure function in `~/utils/scrollAffordance` precisely so
 * the "am I at the end?" arithmetic is provable without a layout engine; this component only supplies the
 * three numbers and re-asks after the two things that can change them — the owner scrolling, and the row
 * set changing under it.
 *
 * Listener is `passive`, and nothing here animates: the hint is a static gradient that is either present or
 * absent, so the project's "never animate a blurred/composited full-viewport element" rule is untouched.
 */
const scroller = ref<HTMLElement | null>(null);
const moreToTheRight = ref(false);

function measure() {
  const el = scroller.value;
  if (el == null) return;
  moreToTheRight.value = hasMoreToScrollRight({
    scrollLeft: el.scrollLeft,
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  });
}

onMounted(measure);
// A row arriving or leaving changes the table's width, and therefore whether there is anything left to
// scroll to — `/settings` renders this component before its instrument list has loaded, so the very first
// measurement is always taken on an EMPTY table. `flush: 'post'` so the DOM has already been patched.
watch(() => props.rows, () => measure(), { flush: 'post' });
</script>

<template>
  <div class="mp-instrtable">
    <!-- Wide content scrolls inside its OWN container; the page body never scrolls horizontally. -->
    <div
      ref="scroller"
      class="mp-instrtable__scroll"
      :class="{ 'mp-instrtable__scroll--more': moreToTheRight }"
      @scroll.passive="measure"
    >
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
    </div>
    <!-- ⚠️ OUTSIDE THE SCROLLER (QA round 5, F4.2). This paragraph used to sit INSIDE it, so on a 390 px
         screen it slid horizontally out of view with the table it was explaining — the one sentence saying
         why a cheap probe is still useful, reachable only by scrolling away from the columns it is about.
         It is a caption, not a column. -->
    <p class="mp-instrtable__note">{{ t('settings.instruments.table.note') }}</p>
  </div>
</template>

<style scoped>
.mp-instrtable__scroll {
  overflow-x: auto;
}

/* QA round 5, F4.1 — the hint, now bound to measured state rather than to a background-attachment trick.
   One static layer, present exactly while something is still to the right of the viewport, and gone at the
   end of the scroll because the class is gone. Both colors come from existing tokens so it repaints
   correctly in dark mode with no new hex/rgba values. */
.mp-instrtable__scroll--more {
  background-image: linear-gradient(to left, var(--border-subtle), transparent);
  background-position: top right;
  background-size: var(--space-8) 100%;
  background-repeat: no-repeat;
  background-attachment: scroll;
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

/* ⚠️ THE HEADINGS WRAP, THE ANSWERS DO NOT — and this is what makes F4.3's sticky column SAFE rather than
   merely tidy (measured in Chromium at 390 px, not reasoned about). The headings are by far the widest
   cells in this table ("Requiere ajuste por maceta" against a "Sí"), and holding them on one line pushed
   the content to 613 px in a 312 px box. Freeze a ~150 px name column in front of that and the last
   column's ANSWERS end up parked underneath it at maximum scroll: four visibly empty cells, i.e. the fix
   hiding the data it exists to caption. Letting the headings wrap takes the table to 357 px, so every
   answer clears the frozen column with room to spare. The DATA cells keep `nowrap` from the rule above —
   "índice 1–10" broken across two lines is a value the owner has to reassemble. */
.mp-instrtable__table thead th,
.mp-instrtable__table th[scope='row'] { white-space: normal; }

/* QA round 5, F4.3 — THE ROW HEADER STAYS. Scrolled to the answer columns the owner used to read
   `No / Sí / No / No` with nothing saying which instrument each row was; and in Spanish the at-rest cut
   landed exactly on a column boundary, so the table looked like it genuinely had two columns. Pinning the
   instrument-name column fixes both halves at once — the names stay, and the half-cut column at the right
   edge is now visibly a column that continues.
   The header cell of that same column is pinned too, or the head and the body would disagree about where
   the frozen column is the moment the owner scrolls.
   The separating line is a `box-shadow`, never a `border-right`: under `border-collapse: collapse` a
   sticky cell's own borders are collapsed away with its neighbour's and stop painting. */
.mp-instrtable__table th[scope='row'],
.mp-instrtable__table thead th:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--surface-card);
  box-shadow: inset -1px 0 0 var(--border-subtle);
}

.mp-instrtable__note { margin-top: var(--space-3); color: var(--text-muted); font-size: var(--text-xs); }
</style>
