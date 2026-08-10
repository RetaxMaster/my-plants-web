// The WATER row's survey rules, in ONE place, because TWO renderers apply them: the Today list
// (`pages/index.vue`) and the plant page (`components/PlantDetail.vue`). Parallel per-surface copies of one
// rule are this workspace's named highest-yield bug class, and this one had already drifted into a
// half-implementation before it was extracted here.
//
// The function touches neither Vue, the API, nor i18n: it takes the three facts the caller already holds
// and returns a decision, so a test can pin the RULE without mounting a page.
/**
 * Whether THIS plant's WATER row may offer the "¿Necesitas regar?" survey.
 *
 * Three conditions, all necessary:
 *  - `hasInstrument` — spec §5.2: an owner who selected no instrument has no way to satisfy a survey, so
 *    the row keeps today's Hecho | Posponer shape. Declining to measure is a supported choice.
 *  - `measuredToday` — an owner who already measured this plant today has already answered the question
 *    (WATER_NOW writes its reading with `verdict: 'NONE'`), so asking again is the "asks forever" dead end.
 *  - `catalogueAvailable` — ⚠️ THE FAILURE DIRECTION OF THE SAME §5.2 INVARIANT, and the reason this
 *    function exists rather than a two-term `&&` in each renderer. The survey modal needs the plant's
 *    instrument catalogue (`getSoilReadings`), and a FAILED fetch is NOT an empty catalogue: opening the
 *    modal on the empty shape tells an owner who DOES own instruments that he owns none, sends him to
 *    Settings where he sees them, and returns him to the same screen — with Hecho and Posponer still
 *    withheld, because the row's own gate never knew the fetch had failed. A due watering became
 *    uncompletable over an infrastructure fault. So a catalogue we do not hold closes the survey and hands
 *    the classic row back; the caller surfaces a retryable error saying exactly that, and never the
 *    "you have no instruments" copy, which for this owner is a false statement.
 */
export function canOfferWaterSurvey(facts: {
  hasInstrument: boolean;
  measuredToday: boolean;
  catalogueAvailable: boolean;
}): boolean {
  return facts.hasInstrument && !facts.measuredToday && facts.catalogueAvailable;
}

