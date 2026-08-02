import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import { PROGRESS_TAG_KEYS } from '@retaxmaster/my-plants-species-schema/progress-tag-constants';
import { permittedTypesFor, type AgentScope } from '@retaxmaster/my-plants-species-schema/agent-capabilities';
import type { KnowledgeChatRunStatus } from '../types/api';
import { OP_TYPE_KEY } from '../utils/agentProposalOpTypes';

type Tree = { [k: string]: string | Tree };

function keyPaths(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? keyPaths(v as Tree, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

// Namespaces that HOST A PROPOSAL BANNER, and the agent scope each one renders. `knowledgeEngine` is
// absent on purpose: the KE surface injects no proposals adapter, so it has no banner and needs no labels.
// Typed as `Record<string, AgentScope>` (not `as const`) so a typo'd scope value fails right here, at the
// declaration site, with a clear "not assignable to AgentScope" compile error — rather than downstream,
// wherever `permittedTypesFor` first gets called with it.
const BANNER_NAMESPACES: Record<string, AgentScope> = { diagnose: 'doctor', gardener: 'gardener' };

// Namespaces that host a CHAT AT ALL: every banner namespace, plus `knowledgeEngine`, which drives the
// same shared AgentChat component and therefore needs run-status labels too, even though — per the comment
// above — it never renders a proposal banner and so is excluded from BANNER_NAMESPACES itself. Derived
// from BANNER_NAMESPACES rather than hand-listed a second time, so a namespace added to one set is never
// silently missing from the other.
const CHAT_NAMESPACES = [...Object.keys(BANNER_NAMESPACES), 'knowledgeEngine'];

describe('locale catalogues', () => {
  it('have byte-identical key trees (en vs es)', () => {
    const enKeys = keyPaths(en as Tree).sort();
    const esKeys = keyPaths(es as Tree).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('have no empty string values', () => {
    const values = (obj: Tree): string[] =>
      Object.values(obj).flatMap((v) => (typeof v === 'object' && v !== null ? values(v as Tree) : [v as string]));
    expect(values(en as Tree).every((v) => v.length > 0)).toBe(true);
    expect(values(es as Tree).every((v) => v.length > 0)).toBe(true);
  });
});

describe('REPOT inspection keys (spec F.7)', () => {
  it('both locales define the three inspection outcomes, the title and the signs heading', () => {
    for (const slug of ['not-needed-yet', 'needed-cannot-now', 'could-not-check'] as const) {
      expect((en.feedback.reason as Record<string, string>)[slug]).toBeTruthy();
      expect((es.feedback.reason as Record<string, string>)[slug]).toBeTruthy();
    }
    expect(en.feedback.repotInspectTitle).toBeTruthy();
    expect(es.feedback.repotInspectTitle).toBeTruthy();
    expect(en.feedback.repotSignsHeading).toBeTruthy();
    expect(es.feedback.repotSignsHeading).toBeTruthy();
  });

  it('the REPOT task label is the bare verb (F.7\'s label guard RETRACTED 2026-08-01)', () => {
    // F.7 originally hard-asserted "Check the roots" / "Revisar las raíces" here, plus a `not.toBe` guard
    // against the bare verb, because the engine has never seen the roots and a bare verb would read as a
    // verdict it has no evidence for. Spec 4 §4 ("REPOT rename", request 6, 2026-08-01) RETRACTED that label
    // wording back to "Repot" / "Replantar": the conditional meaning ("inspect, and repot if needed") that
    // the label used to have to carry alone now lives in the info modal, so the shorter name is safe again.
    // The protection itself is NOT retracted — it MOVED to the modal-key assertion above, which stays
    // load-bearing. This assertion is rewritten, not deleted, so the decision stays discoverable here.
    expect(en.tasks.labels.REPOT).toBe('Repot');
    expect(es.tasks.labels.REPOT).toBe('Replantar');
  });
});

describe('every banner namespace mirrors the shared chat component keys', () => {
  // The shared component (AgentChat.vue) resolves strings as `${i18nNamespace}.<suffix>`. Every namespace
  // that drives it — 'diagnose', 'gardener', and 'knowledgeEngine' itself — passes its own name as that
  // namespace. So EVERY one of them must cover every knowledgeEngine leaf, or that screen renders raw key
  // paths instead of copy. knowledgeEngine is the reference set because it is the plainest chat surface
  // (no proposal banner, no skip-permissions), so its leaves are exactly the shared-component minimum.
  const keKeys = keyPaths((en as Tree).knowledgeEngine as Tree);

  for (const ns of Object.keys(BANNER_NAMESPACES)) {
    it(`${ns} defines every knowledgeEngine leaf key the shared AgentChat resolves`, () => {
      const nsKeys = new Set(keyPaths((en as Tree)[ns] as Tree));
      const missing = keKeys.filter((k) => !nsKeys.has(k));
      expect(missing, ns).toEqual([]);
    });
  }
});

describe('progress tag chip i18n (spec §1.2/§1.3)', () => {
  it('every catalog key resolves to a non-empty label in BOTH locales', () => {
    for (const key of PROGRESS_TAG_KEYS) {
      expect((en.progress.tags as Record<string, string>)[key]).toBeTruthy();
      expect((es.progress.tags as Record<string, string>)[key]).toBeTruthy();
    }
  });

  it('defines the localized generic fallback (never humanized English)', () => {
    expect(en.progress.tags.unknown).toBeTruthy();
    expect(es.progress.tags.unknown).toBeTruthy();
    expect(es.progress.tags.unknown).not.toBe(en.progress.tags.unknown); // Spanish is actually translated
  });
});

describe('proposal op-type labels are complete PER NAMESPACE, against that scope’s capability set', () => {
  // ⚠️ The denominator is NOT the whole shared union — it is the CAPABILITY MAP's permitted set for that
  // namespace's own agent scope. The doctor can never propose a garden op (place/city/plant.create) and
  // the gardener can never propose progress.delete or clinical_record.*, so demanding the full union here
  // would force dead copy for an operation that scope can never send. `OP_TYPE_KEY` still gives the
  // COMPILE-TIME guarantee that every wire operation type has a camelCase i18n key somewhere (its own
  // `Record<AgentProposalOperationType, string>` annotation in utils/agentProposalOpTypes.ts) — this loop
  // adds the RUNTIME half: that each namespace's locale files actually resolve exactly its own scope's
  // subset of those keys to a non-empty label, in both `en.json` and `es.json`.
  for (const [ns, scope] of Object.entries(BANNER_NAMESPACES)) {
    const expected = permittedTypesFor(scope).map((t) => OP_TYPE_KEY[t]).sort();

    it(`${ns} defines exactly one label per operation its scope may propose`, () => {
      for (const cat of [en, es] as unknown as Tree[]) {
        const opType = (((cat[ns] as Tree).proposal as Tree).opType ?? {}) as Tree;
        // EXACT equality in BOTH directions: a missing key renders a raw key path at the owner, and an
        // extra key is copy a translator had to invent for an operation that can never reach this surface.
        expect(Object.keys(opType).sort(), `${ns}.proposal.opType`).toEqual(expected);
      }
    });
  }

  it('covers every namespace that hosts a banner (guards against a vacuous pass)', () => {
    expect(Object.keys(BANNER_NAMESPACES).length).toBeGreaterThanOrEqual(2);
  });
});

describe('agent write-proposal copy (spec 2026-07-18 §5.4, §6.4; generalized across agent scopes)', () => {
  for (const ns of Object.keys(BANNER_NAMESPACES)) {
    it(`both locales define the ${ns} banner copy`, () => {
      for (const cat of [en, es] as unknown as Tree[]) {
        const proposal = ((cat[ns] as Tree).proposal ?? {}) as Tree;
        // `settingsError` is in this list even though the plan's own list omitted it: AgentChat resolves it
        // when the settings read fails, so leaving it unpinned would let that path render a raw key path.
        for (const k of ['title', 'reviewHint', 'agentSays', 'approve', 'decline', 'dismiss',
                         'applying', 'emptyValue', 'staleNote', 'destructive',
                         'applyError', 'declineError', 'settingsError']) {
          expect(proposal[k], `${ns}.proposal.${k}`).toBeTruthy();
        }
        const conflict = (proposal.conflict ?? {}) as Tree;
        expect(conflict.expired, `${ns}.proposal.conflict.expired`).toBeTruthy();
        expect(conflict.resolved, `${ns}.proposal.conflict.resolved`).toBeTruthy();
      }
    });

    it(`both locales define the ${ns} Dangerously Skip Permissions copy`, () => {
      for (const cat of [en, es] as unknown as Tree[]) {
        const skip = ((cat[ns] as Tree).skipPermissions ?? {}) as Tree;
        for (const k of ['label', 'hint', 'activeTitle', 'activeBody', 'error']) {
          expect(skip[k], `${ns}.skipPermissions.${k}`).toBeTruthy();
        }
      }
    });
  }

  // Every run status the API can emit needs a label in EVERY chat namespace, in BOTH locales. The status
  // is interpolated straight into the key (`runStatus.${s.status}`), so a missing one does not fail a
  // build — it renders the raw key path `runStatus.LAUNCHING` at the owner.
  //
  // ⚠️ Derived from the type union, never hand-listed: LAUNCHING shipped on the wire while the web knew
  // only five statuses, and a hand-written list here would have been copied from the same stale union.
  it('labels every run status in every chat namespace', () => {
    // ⚠️ EXHAUSTIVE BY CONSTRUCTION, not by hand. A plain `KnowledgeChatRunStatus[]` literal is satisfied
    // by any SUBSET, so adding a seventh status to the union would leave this list — and this test —
    // silently stale, which is exactly how LAUNCHING went missing in the first place. A Record keyed by
    // the union makes an omission a COMPILE error (`npm run typecheck` covers test files).
    const EXPECTED: Record<KnowledgeChatRunStatus, true> = {
      QUEUED: true, LAUNCHING: true, RUNNING: true, SUCCEEDED: true, FAILED: true, CANCELLED: true,
    };
    const statuses = Object.keys(EXPECTED) as KnowledgeChatRunStatus[];
    for (const cat of [en, es] as unknown as Tree[]) {
      for (const ns of CHAT_NAMESPACES) {
        const runStatus = ((cat[ns] as Tree).runStatus ?? {}) as Tree;
        expect(Object.keys(runStatus).sort(), `${ns}.runStatus`).toEqual([...statuses].sort());
      }
    }
  });

  it('covers every namespace that hosts a chat (guards against a vacuous pass)', () => {
    expect(CHAT_NAMESPACES.length).toBeGreaterThanOrEqual(3);
  });

  // Spanish must be genuinely translated, not the English string copied across. The catalogue-wide parity
  // test only proves the key trees match — it would stay green on a wholesale copy-paste.
  for (const ns of Object.keys(BANNER_NAMESPACES)) {
    it(`translates the ${ns} banner copy into Spanish rather than mirroring English`, () => {
      const enProposal = ((en as unknown as Tree)[ns] as Tree).proposal as Tree;
      const esProposal = ((es as unknown as Tree)[ns] as Tree).proposal as Tree;
      for (const k of ['title', 'reviewHint', 'approve', 'decline', 'dismiss', 'destructive']) {
        expect(esProposal[k], `${ns}.proposal.${k}`).not.toBe(enProposal[k]);
      }
    });
  }
});

// A mutation test proved this gap: swapping the Spanish `history.clinicalRecordCreated` value for the
// English one survived the full suite, because nothing checked es≠en for either of these two spots — the
// catalogue-wide "byte-identical key trees" test only proves the two files have the same SHAPE, which is
// exactly as green on a wholesale copy-paste as on a real translation.
describe('clinical record copy is genuinely translated (spec 2026-07-20 §6.1, §6.4)', () => {
  it('translates the history-timeline label into Spanish rather than mirroring English', () => {
    expect(es.history.clinicalRecordCreated).not.toBe(en.history.clinicalRecordCreated);
  });

  it('translates every clinicalRecord.* leaf into Spanish rather than mirroring English', () => {
    const enBlock = (en as unknown as Tree).clinicalRecord as Tree;
    const esBlock = (es as unknown as Tree).clinicalRecord as Tree;
    expect(Object.keys(enBlock).length).toBeGreaterThan(0);
    for (const k of Object.keys(enBlock)) {
      expect(esBlock[k], `clinicalRecord.${k}`).not.toBe(enBlock[k]);
    }
  });
});
