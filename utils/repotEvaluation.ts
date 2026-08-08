import type { PendingRepotEvaluation, RepotSign } from '~/types/api';
// The narrow subpath, not the package root: this is a browser bundle and the root barrel drags in the whole
// zod schema surface. Same convention `types/api.ts` already uses for `photo-contract-constants` et al.
import {
  REPOT_EVIDENCE_CLASSES,
  REPOT_SIGN_ID_SEPARATOR,
  UNIVERSAL_SIGN_NAMESPACE,
  type RepotEvidenceClass,
} from '@retaxmaster/my-plants-species-schema/repot-sign-constants';

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
 * Which sign ids a submitted evaluation body actually reported — the ids the verdict modal subtracts from
 * the catalogue to name a corroborating sign.
 *
 * The rule is one line and it is entirely about MEANING: only the `signs` answer carries observations. The
 * other two answers ("no signs at all", "I couldn't check it") may still carry an empty/absent `signIds`,
 * and reading them as "the owner ticked nothing" would be right by accident; reading them as observations
 * would be wrong. Returning a COPY matters too — the source is the attempt's frozen request envelope, which
 * must stay byte-identical to what was sent (U2).
 *
 * Extracted from the two renderers, which carried the identical expression. It is a small line, but it is
 * exactly the kind these two files have drifted on twice before (their own comments say so), and it belongs
 * beside the other two rules about what an evaluation answer means.
 */
export function checkedSignIdsFrom(
  body: { answer: string; signIds?: readonly string[] } | null | undefined,
): string[] {
  return body?.answer === 'signs' ? [...(body.signIds ?? [])] : [];
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
 * The classes that CANNOT corroborate, and are therefore never suggested.
 *
 * `definitive` is defined in `docs/care-engine.md` §7.17 as "this alone means root-bound; no other
 * plausible explanation". A sign like that does not corroborate — it DECIDES: ticking it alone
 * short-circuits the whole score straight to `needed` (`SIGN_WEIGHT` has no `definitive` entry at all, on
 * purpose). So on the "not yet" branch it is, by construction, always unticked, which made "the strongest
 * unchecked sign" a mathematical constant: one sign in the whole catalogue holds the class, every species
 * inherits it from the universal set, and it won every single time. Measured by QA: 5 of 5 verdicts across
 * 4 species and 5 different tick-sets all suggested "The pot is cracked, split, or visibly deformed by the
 * roots."
 *
 * Typed as `RepotEvidenceClass[]` deliberately: if the shared contract ever renames or drops the class,
 * this list fails the typecheck instead of silently going empty.
 */
const NON_CORROBORATING_CLASSES: readonly RepotEvidenceClass[] = ['definitive'];

/** The id namespace decides whose sign it is: `universal--…` is app-seeded pot physics, anything else is
 *  this species' own curated row. Composed by `composeUniversalRepotSignId` /
 *  `composeSpeciesRepotSignId`, which REFUSE a species slug equal to the reserved namespace — so this
 *  test can never be fooled by a species that happens to be called "universal". */
function isUniversalSign(id: string): boolean {
  return id.startsWith(`${UNIVERSAL_SIGN_NAMESPACE}${REPOT_SIGN_ID_SEPARATOR}`);
}

/**
 * The corroborating sign to name on a RE-EVALUATE verdict: the strongest sign that could actually
 * CORROBORATE — preferring this species' own evidence — among the ones the owner did NOT tick.
 *
 * PRESENTATION ONLY. It changes no engine input, no score, no verdict, no stored value and no request body
 * — it reads the catalogue the questionnaire already fetched and the answer the owner already sent, and
 * returns a row to render. Nothing here is posted anywhere.
 *
 * WHY THIS RULE. `docs/care-engine.md` §7.17 defines `strong` as "reliable, but worth confirming with one
 * more". The app therefore already knows what would move the answer, and said nothing — so a flat "not
 * yet" read as the app ignoring what the owner reported.
 *
 * The three parts of the selection, each load-bearing:
 *
 *  1. `definitive` is EXCLUDED (see `NON_CORROBORATING_CLASSES`). It is not a corroboration, and telling an
 *     owner to go and check whether their pot has split — right after they described what they can see —
 *     is advice they would already have volunteered, and if it were true the questionnaire would be over.
 *     This is what made the old suggestion identical every time.
 *  2. Then the strongest remaining class wins: `strong`, then `suggestive`, then `ambiguous`. Ranking is
 *     derived from the shared contract's own ordinal array (`REPOT_EVIDENCE_CLASSES`, documented
 *     "strongest first"), never a second hand-written table — a fifth class added upstream lands here for
 *     free and in the right place. An absent or unrecognised class ranks LAST (weaker than every real
 *     class) but stays eligible, so an older API that does not publish `evidence` yet still produces a
 *     suggestion rather than a wrong one.
 *  3. At EQUAL rank, this species' own sign beats a universal one. The feature is sold as species-aware
 *     and the copy implies it: a fern owner should be pointed at fern evidence, not at generic pot physics
 *     they share with every plant in the app.
 *
 * DETERMINISM is a requirement, not a nicety: two identical submissions that suggested different signs
 * would read as a bug. The comparison is a strict lexicographic (rank, universal-last) minimum over a
 * single pass, so a full tie always keeps the FIRST — i.e. CATALOGUE ORDER, the array as the API returned
 * it, already sorted by `sortOrder` then `id`. No dependence on `Array.prototype.sort` stability or on
 * object key order.
 *
 * Returns `null` — and the caller then shows the ordinary copy alone, which is a complete answer — when
 * there is no honest suggestion to make: the catalogue is empty or absent, the owner has already ticked
 * every sign there is, or every remaining unticked sign is `definitive`.
 */
export function corroboratingSign(
  signs: readonly RepotSign[] | null | undefined,
  checkedSignIds: readonly string[] | null | undefined,
): RepotSign | null {
  const checked = new Set(checkedSignIds ?? []);
  let best: RepotSign | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestIsUniversal = true;
  for (const sign of signs ?? []) {
    if (checked.has(sign.id)) continue;
    if (NON_CORROBORATING_CLASSES.includes(sign.evidence as RepotEvidenceClass)) continue;
    const rank = evidenceRank(sign.evidence);
    const universal = isUniversalSign(sign.id);
    // Strictly better on (rank, then species-before-universal). Never `<=`: an exact tie keeps the
    // incumbent, which is what makes catalogue order the final tiebreak.
    if (rank < bestRank || (rank === bestRank && bestIsUniversal && !universal)) {
      best = sign;
      bestRank = rank;
      bestIsUniversal = universal;
    }
  }
  return best;
}
