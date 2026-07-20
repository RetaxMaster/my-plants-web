import { describe, it, expect } from 'vitest';
// The /vue SUBPATH, not the root: unlike defaultTranscriptLabels, defaultChatPanelLabels is not exported
// from the package root. And NOT defaultTranscriptLabels — an upstream consumer pointed the test at the
// transcript set, stayed green, and shipped untranslated English.
import { defaultChatPanelLabels } from '@retaxmaster/agents-realtime-client/vue';
import en from './locales/en.json';
import es from './locales/es.json';

// The sixteen strings 3.0.0 added, enumerated here ONLY as documentation of what this guard protects.
// The assertion itself iterates the PACKAGE's key set, never this list — a hand-written list is a second
// declaration of the set, free to drift.
const NEW_IN_3_0_0 = [
  'systemMessageLabel',
  'attachmentsLabel', 'attachmentRestored', 'attach', 'removeAttachment',
  'attachmentTooLarge', 'attachmentTypeNotAllowed', 'attachmentCountExceeded',
  'attachmentTotalExceeded', 'attachmentsUnavailable',
  'queuedLabel', 'queuedHint', 'queuedCancel', 'queuedEdit',
  'queuedAttachmentsDropped', 'queuedReturned',
] as const;

type Tree = Record<string, unknown>;

/** The keys our i18n catalogue offers for one chat namespace, flattened one level under `chatLabels`. */
function labelKeysFor(catalogue: Tree, namespace: 'knowledgeEngine' | 'diagnose'): Set<string> {
  const ns = catalogue[namespace] as Tree;
  const composer = (ns.composer ?? {}) as Tree;
  const console_ = (ns.console ?? {}) as Tree;
  const command = (ns.command ?? {}) as Tree;
  const agent = (ns.agent ?? {}) as Tree;
  // Mirror of how AgentChat.vue assembles `chatLabels` from these sub-trees plus the namespace's own
  // flat leaves. If that assembly changes, this must change with it — it is the set the UI RENDERS.
  return new Set([
    ...Object.keys(ns).filter((k) => typeof ns[k] === 'string'),
    ...Object.keys(composer),
    ...Object.keys(console_),
    ...Object.keys(command),
    ...Object.keys(agent),
  ]);
}

describe('chat label completeness against the package default set', () => {
  const packageKeys = Object.keys(defaultChatPanelLabels());

  /**
   * THE SCOPE OF THIS GUARD — read before "fixing" it to assert all 81 keys, and before "simplifying" it
   * to intersect with what the component already passes. Both are wrong, in opposite directions.
   *
   * `defaultChatPanelLabels()` returns 81 keys, because it describes the package's full `ChatPanel`. We do
   * NOT mount `ChatPanel`; we drive a standalone `Composer` and our own transcript. MEASURED against the
   * catalogue: 49 of those 81 are absent from our namespace, and only 16 of them are the strings 3.0.0
   * added. The other 33 are ChatPanel-only labels for surfaces we never render.
   *
   * - Asserting all 81 would be PERMANENTLY RED, and a permanently-red guard gets skipped within a week.
   * - Asserting only `packageKeys ∩ (what AgentChat.vue already passes)` is CIRCULAR: the scope is derived
   *   from the component's current behaviour, so a label the component FORGETS to pass is automatically
   *   excluded from the check. The guard could never catch its own failure — structurally the same defect
   *   as the documented upstream incident (a test pointed at the wrong set), where the wrong set is
   *   "whatever we happen to do today".
   *
   * So the scope is defined by a NAMED, REVIEWED EXCLUSION LIST instead. Everything the package offers is
   * REQUIRED BY DEFAULT; a key is exempt only if it appears in NOT_OURS with a reason. A new key added by
   * a future package release therefore defaults to *required* and fails loudly, which is the direction we
   * want to fail in.
   */
  const NOT_OURS: ReadonlySet<string> = new Set([
    // ChatPanel chrome we do not mount: title bar, theme toggle, resume box.
    'defaultTitle', 'themeLight', 'themeDark', 'resumeLabel', 'resumePlaceholder', 'continuePrompt',
    'copyFailed', 'rateLimitNotice', 'plan',
    // File/diff and tool rendering owned by our own transcript labels under different names.
    'fileAdded', 'fileDeleted', 'fileUpdated', 'fileBinary', 'diffTruncated', 'noNewline',
    'toolRunning', 'toolSucceeded', 'toolFailed', 'fileChangeLabel', 'unsupportedEventLabel',
    // Provider picker + command transcript: we ship these under our own key names (`select`, `lead`, …).
    'selectProvider', 'providerLockedLabel', 'noProviderAvailable',
    'commandLead', 'commandSucceeded', 'commandFailed', 'commandRefused', 'commandsGroupLabel',
    'commandUnsupported',
    'sessionLabel', 'runFailedNote', 'stoppedNote', 'truncatedNote',
  ]);

  const RENDERED_BY_US = packageKeys.filter((k) => !NOT_OURS.has(k));

  it('every new 3.0.0 label is REQUIRED — none of them may hide in the exclusion list', () => {
    // Without this, someone could silence a failure by adding a new key to NOT_OURS.
    expect(NEW_IN_3_0_0.filter((k) => NOT_OURS.has(k))).toEqual([]);
  });

  it('the exclusion list contains only keys the package actually offers', () => {
    // Keeps NOT_OURS honest across upgrades: a key the package RENAMED must not linger here as a
    // permanent exemption for something that no longer exists.
    expect([...NOT_OURS].filter((k) => !packageKeys.includes(k))).toEqual([]);
  });

  for (const namespace of ['knowledgeEngine', 'diagnose'] as const) {
    for (const [localeName, catalogue] of [['en', en], ['es', es]] as const) {
      it(`${localeName}.${namespace} covers every package label our UI actually renders`, () => {
        const ours = labelKeysFor(catalogue as Tree, namespace);
        const missing = RENDERED_BY_US.filter((k) => !ours.has(k));
        expect(missing).toEqual([]);
      });
    }
  }

  it('covers all sixteen labels 3.0.0 added, in both namespaces and both locales', () => {
    for (const namespace of ['knowledgeEngine', 'diagnose'] as const) {
      for (const catalogue of [en, es]) {
        const ours = labelKeysFor(catalogue as Tree, namespace);
        expect(NEW_IN_3_0_0.filter((k) => !ours.has(k))).toEqual([]);
      }
    }
  });

  it('renders a dismiss label on the two new notices', () => {
    // OURS, not one of the package's sixteen — so the package-derived assertion above can never demand it,
    // and without this the Task 20 dismiss buttons render with an empty label.
    for (const namespace of ['knowledgeEngine', 'diagnose'] as const) {
      for (const catalogue of [en, es]) {
        expect(labelKeysFor(catalogue as Tree, namespace)).toContain('dismiss');
      }
    }
  });

  it('the NEW Spanish values are PRESENT and TRANSLATED, not mirrored from English', () => {
    // Cross-checking en against es is explicitly NOT sufficient — the package's own demo shipped a Spanish
    // set whose completeness test only cross-checked one locale against the other, and so passed vacuously
    // while BOTH were equally incomplete.
    //
    // PRESENCE IS ASSERTED FIRST, and that ordering is the whole point. A filter like
    // `en[k] !== undefined && en[k] === es[k]` skips every ABSENT key, so before Steps 3-4 add any strings
    // all sixteen are `undefined` and the test passes green — reproducing the exact vacuity it cites.
    //
    // Scoped to the keys this feature adds: asserting "no key in the whole tree has an identical en/es
    // value" would fail on pre-existing entries whose translation is legitimately the same word (proper
    // nouns, symbols, borrowings), and a test that fails for a legitimate reason gets deleted.
    for (const namespace of ['knowledgeEngine', 'diagnose'] as const) {
      const enNs = ((en as Tree)[namespace] as Tree).composer as Tree;
      const esNs = ((es as Tree)[namespace] as Tree).composer as Tree;

      const absent = NEW_IN_3_0_0.filter((k) => enNs[k] === undefined || esNs[k] === undefined);
      expect(absent, `${namespace}: missing translations`).toEqual([]);

      const untranslated = NEW_IN_3_0_0.filter((k) => enNs[k] === esNs[k]);
      expect(untranslated, `${namespace}: Spanish mirrors English`).toEqual([]);
    }
  });

  it('honestly records what defaultChatPanelLabels() is and is NOT', () => {
    // It returns 81 of the type's 89 keys — the eight without defaults include noOutputNote,
    // rejectionReasons and noticeLabels, thunks this project already supplies separately. It is a valid
    // guard for all sixteen new labels (every one has a default), but it is NOT a complete reference for
    // ChatPanelLabels, and this suite does not claim it is.
    expect(packageKeys.length).toBeGreaterThanOrEqual(80);
  });
});
