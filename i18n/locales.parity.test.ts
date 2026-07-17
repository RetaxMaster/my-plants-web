import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import { PROGRESS_TAG_KEYS } from '@retaxmaster/my-plants-species-schema/progress-tag-constants';

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
