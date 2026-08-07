import type { PendingRepotEvaluation, RepotSign } from '~/types/api';
// The narrow subpath, not the package root: this is a browser bundle and the root barrel drags in the whole
// zod schema surface. Same convention `types/api.ts` already uses for `photo-contract-constants` et al.
import { REPOT_EVIDENCE_CLASSES } from '@retaxmaster/my-plants-species-schema/repot-sign-constants';

/**
 * Which pending evaluation a REPOT Done/Postpone may name as `payload.evaluationId` — and, by construction,
 * WHEN it may name one at all.
 *
 * The server (`feedback.write-core.ts`) resolves an `evaluationId` only when it points at an UNRESOLVED row
 * whose verdict is `REPOT`; anything else is a 400 (`Unknown or already-resolved REPOT evaluation`). Before
 * the standalone-Done affordance existed, both renderers could attach the pending id unconditionally,
 * because a Done button only ever rendered once a `REPOT` verdict was pending — the guard was implicit in
 * the UI's own state machine.
 *
 * It no longer is. `/plants/:id` now offers Done alongside "time to evaluate" (the owner may have repotted
 * the plant regardless of what the questionnaire last said), so a Done can be pressed while a
 * `RE-EVALUATE` row is the pending one. Attaching THAT id names a row the server will refuse to resolve,
 * and the completion would 400 — precisely the case where the owner is contradicting the app, which is the
 * case that has to work. A `RE-EVALUATE` row is not resolved by a Done, it is SUPERSEDED by it
 * (`completeRepotCore` step 2), which needs no id at all.
 *
 * Lives here, not inline in each renderer, because both `pages/index.vue` and `PlantDetail.vue` build this
 * payload and a rule stated twice is a rule that drifts once.
 */
export function resolvableEvaluationId(pending: PendingRepotEvaluation | null | undefined): string | undefined {
  return pending && pending.verdict === 'REPOT' ? pending.id : undefined;
}

/**
 * Rank of an evidence class, LOW = strongest. Derived from the shared contract's own ordinal array
 * (`REPOT_EVIDENCE_CLASSES`, which is documented "strongest first"), never a second hand-written table — a
 * fifth class added upstream lands here for free and in the right place.
 *
 * An absent or unrecognised class ranks LAST (weaker than every real class), so an older API that does not
 * publish `evidence` yet, or a catalogue row holding something outside the enum, can never be suggested
 * ahead of a sign whose class we actually know.
 */
function evidenceRank(evidence: string | undefined): number {
  const at = (REPOT_EVIDENCE_CLASSES as readonly string[]).indexOf(evidence ?? '');
  return at === -1 ? REPOT_EVIDENCE_CLASSES.length : at;
}

/**
 * The corroborating sign to name on a RE-EVALUATE verdict: the strongest sign in this plant's own catalogue
 * that the owner did NOT tick.
 *
 * PRESENTATION ONLY. It changes no engine input, no score, no verdict, no stored value and no request body
 * — it reads the catalogue the questionnaire already fetched and the answer the owner already sent, and
 * returns a row to render. Nothing here is posted anywhere.
 *
 * WHY THIS RULE. `docs/care-engine.md` §7.17 defines `strong` as "reliable, but worth confirming with one
 * more" and `definitive` as "this alone means root-bound". The app therefore already knows what would move
 * the answer, and said nothing — so a flat "not yet" read as the app ignoring what the owner reported. The
 * strongest unchecked sign is the one whose observation would count for most, which makes it the honest
 * thing to point at.
 *
 * DETERMINISM is a requirement, not a nicety: two identical submissions that suggested different signs
 * would read as a bug. Ties are broken by CATALOGUE ORDER (the array as the API returned it, already sorted
 * by `sortOrder` then `id`), and the sort below is a single-pass minimum scan, so equal ranks always keep
 * the first — no dependence on `Array.prototype.sort` stability or on object key order.
 *
 * Returns `null` — and the caller then shows the ordinary copy alone, which is a complete answer — when
 * there is no honest suggestion to make: the catalogue is empty or absent, or the owner has already ticked
 * every sign there is.
 */
export function corroboratingSign(
  signs: readonly RepotSign[] | null | undefined,
  checkedSignIds: readonly string[] | null | undefined,
): RepotSign | null {
  const checked = new Set(checkedSignIds ?? []);
  let best: RepotSign | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const sign of signs ?? []) {
    if (checked.has(sign.id)) continue;
    const rank = evidenceRank(sign.evidence);
    if (rank < bestRank) {
      best = sign;
      bestRank = rank;
    }
  }
  return best;
}
