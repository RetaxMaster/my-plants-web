import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import { PROGRESS_TAG_KEYS } from '@retaxmaster/my-plants-species-schema/progress-tag-constants';
import type { KnowledgeChatRunStatus } from '../types/api';

type Tree = { [k: string]: string | Tree };

function keyPaths(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? keyPaths(v as Tree, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

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

  it('the REPOT task label reads as an INSPECTION, not as a verdict', () => {
    // The engine has never seen the roots. "Repot" asserts a conclusion it has no evidence for; the task is
    // the *look*. This assertion is what would fail if the label regressed to a bare verb.
    expect(en.tasks.labels.REPOT).toBe('Check the roots');
    expect(es.tasks.labels.REPOT).toBe('Revisar las raíces');
    expect(en.tasks.labels.REPOT).not.toBe('Repot');
    expect(es.tasks.labels.REPOT).not.toBe('Trasplantar');
  });
});

describe('diagnose namespace mirrors the shared chat component keys', () => {
  it('defines every knowledgeEngine leaf key the shared AgentChat resolves', () => {
    // The shared component (AgentChat.vue) resolves strings as `${i18nNamespace}.<suffix>`. The KE view
    // passes namespace 'knowledgeEngine'; the diagnose view passes 'diagnose'. So diagnose MUST cover
    // every knowledgeEngine leaf, or a doctor screen renders raw key paths instead of copy.
    const keKeys = keyPaths((en as Tree).knowledgeEngine as Tree);
    const diagKeys = new Set(keyPaths((en as Tree).diagnose as Tree));
    const missing = keKeys.filter((k) => !diagKeys.has(k));
    expect(missing).toEqual([]);
  });
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

describe('doctor write-proposal copy (spec 2026-07-18 §5.4, §6.4)', () => {
  const OP_KEYS = [
    'profileUpdate', 'plantUpdate', 'progressCreate', 'progressUpdate',
    'progressDelete', 'frequencySet', 'frequencyClear', 'careDone',
  ] as const;

  it('both locales define the banner copy, including every operation-type label', () => {
    for (const cat of [en, es] as unknown as Tree[]) {
      const proposal = ((cat.diagnose as Tree).proposal ?? {}) as Tree;
      // `settingsError` is in this list even though the plan's own list omitted it: AgentChat resolves it
      // when the settings read fails, so leaving it unpinned would let that path render a raw key path.
      for (const k of ['title', 'reviewHint', 'agentSays', 'approve', 'decline', 'dismiss',
                       'applying', 'emptyValue', 'staleNote', 'destructive',
                       'applyError', 'declineError', 'settingsError']) {
        expect(proposal[k], `diagnose.proposal.${k}`).toBeTruthy();
      }
      const conflict = (proposal.conflict ?? {}) as Tree;
      expect(conflict.expired).toBeTruthy();
      expect(conflict.resolved).toBeTruthy();
      const opType = (proposal.opType ?? {}) as Tree;
      for (const k of OP_KEYS) expect(opType[k], `diagnose.proposal.opType.${k}`).toBeTruthy();
    }
  });

  it('both locales define the Dangerously Skip Permissions copy', () => {
    for (const cat of [en, es] as unknown as Tree[]) {
      const skip = ((cat.diagnose as Tree).skipPermissions ?? {}) as Tree;
      for (const k of ['label', 'hint', 'activeTitle', 'activeBody', 'error']) {
        expect(skip[k], `diagnose.skipPermissions.${k}`).toBeTruthy();
      }
    }
  });

  // The eight camelCase keys are a MAPPING of the API's dotted discriminants ('profile.update' → 
  // 'profileUpdate'), and the map lives in AgentProposalBanner.vue. A dot inside an i18n leaf key is read
  // by vue-i18n as a nesting separator, so the wire value can never be used as a key directly. If the API
  // ever adds a ninth operation type, this list and that map both have to grow — pinning the count here is
  // what makes the omission fail a test instead of rendering a raw key path in front of the owner.
  it('defines exactly one label per operation type in the API union', () => {
    for (const cat of [en, es] as unknown as Tree[]) {
      const opType = (((cat.diagnose as Tree).proposal as Tree).opType ?? {}) as Tree;
      expect(Object.keys(opType).sort()).toEqual([...OP_KEYS].sort());
    }
  });

  // Every run status the API can emit needs a label in BOTH chat namespaces, in BOTH locales. The status
  // is interpolated straight into the key (`runStatus.${s.status}`), so a missing one does not fail a
  // build — it renders the raw key path `runStatus.LAUNCHING` at the owner.
  //
  // ⚠️ Derived from the type union, never hand-listed: LAUNCHING shipped on the wire while the web knew
  // only five statuses, and a hand-written list here would have been copied from the same stale union.
  it('labels every run status in both chat namespaces', () => {
    const statuses: KnowledgeChatRunStatus[] = ['QUEUED', 'LAUNCHING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'];
    for (const cat of [en, es] as unknown as Tree[]) {
      for (const ns of ['diagnose', 'knowledgeEngine']) {
        const runStatus = ((cat[ns] as Tree).runStatus ?? {}) as Tree;
        expect(Object.keys(runStatus).sort(), `${ns}.runStatus`).toEqual([...statuses].sort());
      }
    }
  });

  // Spanish must be genuinely translated, not the English string copied across. The catalogue-wide parity
  // test only proves the key trees match — it would stay green on a wholesale copy-paste.
  it('translates the banner copy into Spanish rather than mirroring English', () => {
    const enProposal = ((en as unknown as Tree).diagnose as Tree).proposal as Tree;
    const esProposal = ((es as unknown as Tree).diagnose as Tree).proposal as Tree;
    for (const k of ['title', 'reviewHint', 'approve', 'decline', 'dismiss', 'destructive']) {
      expect(esProposal[k], `diagnose.proposal.${k}`).not.toBe(enProposal[k]);
    }
  });
});
