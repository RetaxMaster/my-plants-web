import type { PlantCare } from '../types/api.js';

/**
 * A1 + B1's owner-facing explanation (spec §2.1, ledger D3).
 *
 * If the owner postpones to Aug 8 and the app shows Sep 13, that is a second silent contradiction
 * unless the app says why — and the change that exists to REMOVE dishonest claims must not introduce
 * one. So the payload reports the CAUSES THAT ACTED, and this renders **one sentence per cause**.
 *
 * ⚠️ DO NOT COLLAPSE THESE INTO ONE SENTENCE. "Held back because the substrate is still charged" and
 * "moved so it lands on a watering day" are different facts about different mechanisms, and a floored
 * override may then ALSO be snapped, in which case both are true. `utils/repotExplanation.ts` carries a
 * long comment recording the QA round where exactly this shortcut — one sentence serving two different
 * authors — told the owner they had postponed something they never touched.
 *
 * FLOOR renders before SNAP, sorted here rather than trusted from the payload: the floor is the cause
 * and the snap is what happened to the result, so any other order reads backwards.
 *
 * `t` is INJECTED, matching `repotExplanation`, so this stays a plain function a test can call without
 * mounting Vue or Nuxt's i18n runtime.
 */
const CAUSE_KEY = {
  FLOOR: 'taskInfo.substrate.fertilizeOverrideFloor',
  SNAP: 'taskInfo.substrate.fertilizeOverrideSnap',
} as const;
const CAUSE_ORDER = ['FLOOR', 'SNAP'] as const;

export function fertilizeExplanation(
  fertilize: PlantCare['fertilize'] | null | undefined,
  t: (key: string) => string,
): string | undefined {
  if (!fertilize || fertilize.overrideOn == null) return undefined;
  const acted = CAUSE_ORDER.filter((c) => fertilize.overrideMovedBy.includes(c));
  if (acted.length === 0) return undefined;
  return acted.map((c) => t(CAUSE_KEY[c])).join(' ');
}
