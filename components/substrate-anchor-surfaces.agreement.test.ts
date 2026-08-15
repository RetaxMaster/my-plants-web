// @vitest-environment happy-dom
//
// ---- THREE SURFACES, ONE QUESTION — and this is the test that makes them agree (mandatory, no exceptions) --
//
// "What does the app tell the owner when a repot did NOT move the substrate anchor?" is answered by THREE
// independent renderers — `pages/index.vue` (Today, `noteTextFor`), `components/PlantDetail.vue` (the plant
// page, `outcomeNoteFor`), and `components/AgentChat.vue` (an approved agent proposal, `approvedOutcomeNoteText`).
// All three are SUPPOSED to resolve the answer through one shared seam, `utils/careOutcome.ts`'s
// `substrateAnchorKeptDay()` / `SUBSTRATE_ANCHOR_KEPT_KEY`, and render it identically:
// `t(SUBSTRATE_ANCHOR_KEPT_KEY, { date: d(ymdToLocalDate(day), 'short') })`.
//
// AgentChat was blind to this fact ENTIRELY until the fix that added this file — the THIRD time this
// project has shipped one question answered differently on the owner's path (Today/PlantDetail) and the
// agent path (AgentChat). Each surface already has its own test (`pages/index.test.ts`,
// `PlantDetail.test.ts`, `AgentChat.test.ts`) — but every one of those asserts against ITS OWN literal, so a
// future edit that changes the key or the date format on ONE surface passes by simply updating that one
// surface's own expectation. Nothing in the existing suite fails on DIVERGENCE between the three.
//
// This file is that missing check. It drives all three real components with the SAME `SubstrateAnchorOutcome`
// (never a hardcoded literal string) and asserts the three rendered sentences are EQUAL TO ONE ANOTHER. A
// positive control (a `refreshed` outcome, and an absent `substrate`) proves the equality isn't trivially
// satisfied by "all three render nothing" — this project has been bitten by exactly that shape of false
// green four times in one fix wave. The `t`/`d` i18n stubs (`sharedMocks`/`sharedUseI18n` below) are
// IDENTICAL across all three mounts on purpose: if one surface got a different stub, this file would be
// comparing the stubs, not the surfaces.
//
// ⚠️ IF THIS FILE GOES RED: fix the surface that drifted from the other two — never edit one of the three
// expectations to match. A red here means one of the three renderers stopped using the shared seam (or
// started formatting it differently), which is exactly the defect this file exists to catch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ref, computed, watch, shallowRef, inject, onMounted, onBeforeUnmount, nextTick, defineComponent,
} from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';

// ---- AgentChat's own harness (verbatim from components/AgentChat.test.ts) — the vendored chat package is
// mocked wholesale; we only care that OUR wiring reaches the shared `careOutcome.ts` seam, never about
// re-testing a third-party transcript renderer. -----------------------------------------------------------
const chatStub = await vi.hoisted(async () => {
  const { ref: r } = await import('vue');
  return {
    entries: r([]),
    state: r('idle'),
    sessionId: r<string | null>('agent-session-1'),
    selectedProvider: r('claude'),
    providerLocked: r(false),
    providerBusy: r(false),
    failure: r(null),
    retrying: r(null),
    setProvider: vi.fn(),
    applyAvailability: vi.fn(),
    retry: vi.fn(),
    connect: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
    pushUserPrompt: vi.fn(),
    start: vi.fn(),
    resume: vi.fn(),
    seedHistory: vi.fn(),
    relabel: vi.fn(),
    queuedMessage: r<{ text: string; attachments: unknown[] } | null>(null),
    returnedToComposer: r<{ text: string; attachments: unknown[] } | null>(null),
    restoredDraft: r<{ text: string; attachmentsDropped: boolean } | null>(null),
    clearReturned: vi.fn(),
    clearRestored: vi.fn(),
    enqueueMessage: vi.fn(),
    cancelQueued: vi.fn(),
    abandonConversation: vi.fn(),
    restoredAttachments: vi.fn(() => []),
    setRestoredAttachmentPreview: vi.fn(() => true),
  };
});

vi.mock('@retaxmaster/agents-realtime-client/vue', async () => {
  const { defineComponent: dc, ref: r } = await import('vue');
  const stub = (name: string, cls: string) =>
    dc({
      name,
      inheritAttrs: false,
      props: ['entries', 'labels', 'busy', 'agentLabel', 'running', 'canSend', 'disabled', 'error',
              'commands', 'failure', 'retrying', 'providers', 'selected', 'locked', 'providerLabels',
              'modelValue', 'attachmentsEnabled', 'attachmentCaps', 'urlRegistry', 'attachments',
              'queuedText', 'queuedAttachmentCount', 'queueingEnabled'],
      template: `<div class="${cls}" />`,
    });
  return {
    AgentSelector: stub('AgentSelector', 'stub-selector'),
    Console: stub('Console', 'stub-console'),
    Composer: stub('Composer', 'stub-composer'),
    RunFailureNotice: stub('RunFailureNotice', 'stub-failure'),
    ThemeSelector: stub('ThemeSelector', 'stub-theme'),
    useTheme: () => ({ theme: r('auto'), setTheme: vi.fn() }),
    useAgentChat: () => chatStub,
  };
});
const urlRegistryStub = {
  urlFor: vi.fn((_surface: string, item: { id: string }) => `blob:stub-${item.id}`),
  release: vi.fn(),
  releaseSurface: vi.fn(),
  releaseAll: vi.fn(),
  dispose: vi.fn(),
  size: 0,
  onTurnSealed: vi.fn(),
  onTurnSuperseded: vi.fn(),
};
vi.mock('@retaxmaster/agents-realtime-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@retaxmaster/agents-realtime-client')>();
  return {
    ...actual,
    createObjectUrlRegistry: vi.fn(() => urlRegistryStub),
  };
});
vi.mock('@retaxmaster/agents-realtime-protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@retaxmaster/agents-realtime-protocol')>()),
}));

import AgentChat from './AgentChat.vue';
import TaskRow from './ui/TaskRow.vue';
import type { ChatProposalsAdapter, RepotDoneResult, SubstrateAnchorOutcome } from '../types/api.js';
import { ymdToLocalDate } from '../utils/localDate.js';

// ---- Globals shared by pages/index.vue AND components/PlantDetail.vue (union of both files' own harness
// setups — neither component reads a key the other doesn't, so one stub per composable covers both). -------
vi.stubGlobal('ref', ref);
vi.stubGlobal('computed', computed);
vi.stubGlobal('shallowRef', shallowRef);
vi.stubGlobal('watch', watch);
vi.stubGlobal('inject', inject);
vi.stubGlobal('onMounted', (fn: () => unknown) => { void fn(); });
vi.stubGlobal('onBeforeUnmount', () => {});
vi.stubGlobal('nextTick', nextTick);
vi.stubGlobal('useIsDesktop', () => ref(true));
vi.stubGlobal('useHead', () => {});
vi.stubGlobal('useSeoMeta', () => {});
vi.stubGlobal('navigateTo', vi.fn());
vi.stubGlobal('useTaskMeta', () => ({
  TASK_ICONS: {
    WATER: 'droplet', FERTILIZE: 'beaker', REPOT: 'magnifying-glass',
    ROTATE: 'arrow-path', CLEAN_LEAVES: 'sparkles', MIST: 'cloud', PROGRESS: 'camera',
  },
  taskLabel: (t: string) => t,
  dueLabel: () => 'Today',
  dueLabelLong: () => 'Today',
  healthLabel: () => '',
}));
// TaskRow.vue (mounted for real on both Today and PlantDetail below) imports this through an EXPLICIT
// `~/composables/useTaskMeta` path — `vi.stubGlobal` only intercepts a global reference, never an import
// statement, so the module itself has to be mocked too. Same technique `pages/index.test.ts` /
// `PlantDetail.test.ts` / `TaskRow.test.ts` already use.
vi.mock('~/composables/useTaskMeta', () => ({
  useTaskMeta: () => ({
    TASK_ICONS: {
      WATER: 'droplet', FERTILIZE: 'beaker', REPOT: 'magnifying-glass',
      ROTATE: 'arrow-path', CLEAN_LEAVES: 'sparkles', MIST: 'cloud', PROGRESS: 'camera',
    },
    taskLabel: (t: string) => t,
    dueLabel: () => 'Today',
    dueLabelLong: () => 'Today',
    healthLabel: () => '',
  }),
}));
vi.stubGlobal('useFeedbackReasons', () => ({
  earlyWaterOptions: computed(() => []),
  postponeOptions: computed(() => []),
  repotPostponeOptions: computed(() => []),
}));
vi.stubGlobal('useProfileMeta', () => ({
  windowDistanceLabel: () => null,
  potTypeLabel: () => null,
  soilMixLabel: () => null,
  growthHabitLabel: () => null,
  soilMixOptions: computed(() => [{ value: 'potting-mix', label: 'Potting mix' }]),
  withNotSet: (opts: { value: string; label: string }[], notSetLabel?: string | null) =>
    [{ value: '', label: notSetLabel ?? 'plantProfile.pickOption' }, ...opts],
}));

// ---- THE ONE SHARED i18n STUB — the load-bearing part of this file's design. -----------------------------
//
// If Today got one `t`/`d` stub and AgentChat got another, an equality assertion between their outputs would
// prove nothing about the REAL components — it would prove the two stubs happen to agree. So there is
// exactly ONE localized `t` (echoes its interpolation params back, so a dropped/garbled param is visible in
// the rendered string, the same technique `pages/index.test.ts`'s/`AgentChat.test.ts`'s own substrate-anchor
// tests use) and ONE `d`, and every mount below is wired to it.
//
// ⚠️ `d` ECHOES ITS FORMAT TOKEN, NOT ONLY ITS VALUE — and that is not a detail. This stub first read
// `(v) => String(v)`, which discards the second argument entirely; the format a surface asks for was then
// INVISIBLE to the comparison. Measured, not reasoned: with that version, changing `PlantDetail.vue` alone
// from `d(…, 'short')` to `d(…, 'long')` left this file GREEN — three surfaces rendering the same fact in
// two different date formats is exactly the cross-surface inconsistency this file exists to catch, and the
// file could not see it. Echoing the token makes a format drift a STRING drift, so it fails the equality
// assertion like any other divergence. If you ever simplify this back to `String(v)`, you delete half the
// test without changing a single assertion.
const localizedT = (k: string, named?: Record<string, unknown>) =>
  (named ? `${k}|${JSON.stringify(named)}` : k);
const sharedD = (v: unknown, format?: unknown) => `${String(v)}@${String(format ?? 'default')}`;
vi.stubGlobal('useI18n', () => ({ t: localizedT, d: sharedD, locale: ref('en'), te: () => false }));
const sharedMocks = { $t: localizedT, $d: sharedD };

// ---- Text extraction: DIRECT TEXT NODES ONLY. --------------------------------------------------------
//
// AgentChat's outcome-note `<p>` also holds a "Close" button (`.mp-kchat__recheck`) as a sibling of the
// sentence — `.text()` would fold the button's own label into the comparison and make an otherwise-correct
// equality assertion fail for a reason that has nothing to do with the sentence under test. Reading only
// the element's own text nodes isolates exactly what `outcomeNoteText`/`outcomeNoteFor`/`noteTextFor`
// produced, on all three surfaces alike (Today's and PlantDetail's `.mp-taskrow__outcome-note` carry no
// such sibling, so this is a no-op for them — but using the SAME extraction everywhere is what keeps the
// comparison honest).
function directText(w: { element: Element }): string {
  return Array.from(w.element.childNodes)
    .filter((n) => n.nodeType === 3) // Node.TEXT_NODE
    .map((n) => n.textContent ?? '')
    .join('')
    .trim();
}

// One place, shared by the Today and PlantDetail mounts below, that names how an action is found on a real
// `TaskRow`/`Button` render — the SAME `data-icon` convention `pages/index.test.ts`/`PlantDetail.test.ts`
// already use ('check' = Done).
type Findable = { findAll: (s: string) => Array<{ attributes: (a: string) => string | undefined; trigger: (e: string) => Promise<void> }> };
const doneButton = (w: Findable) =>
  (w.findAll('.stub-btn') as any[]).find((b) => b.attributes('data-icon') === 'check');

const KEPT_DAY = '2026-08-11';

// ============================================================================================================
// TODAY (pages/index.vue) — mirrors pages/index.test.ts's own `stubs` object and `mountPage()` pattern for
// its REPOT Done flow (the describe block "the substrate anchor stayed, and Today says so").
// ============================================================================================================
const TODAY_STUBS = {
  UiCard: { template: '<div><slot name="header" /><slot /></div>' },
  UiCardGrid: { template: '<div><slot /></div>' },
  UiEmptyState: { template: '<div><slot /></div>' },
  UiScreenHeader: true,
  UiAlert: {
    props: ['color', 'description', 'announce'],
    template: '<div class="repot-error-banner" :data-description="description"><slot /></div>',
  },
  UiButton: {
    props: ['size', 'variant', 'color'],
    emits: ['click'],
    template: '<button class="retry-btn" @click="$emit(\'click\', $event)"><slot /></button>',
  },
  UiPlantPhoto: true,
  UiPlantAvatar: true,
  UiPlantName: true,
  UiPhotoChip: true,
  UiAppIcon: true,
  UiReasonPicker: {
    props: ['open', 'title', 'options', 'confirmLabel'],
    emits: ['update:open', 'confirm'],
    template: '<div class="reason-picker" :data-open="String(!!open)" />',
  },
  UiRepotVerdictModal: {
    props: ['open', 'result', 'signs', 'checkedSignIds'],
    template: '<div class="verdict-modal" :data-open="open" />',
  },
  UiTaskRow: TaskRow,
  AppIcon: true,
  Badge: { template: '<span class="stub-badge"><slot /></span>' },
  Button: {
    props: ['size', 'color', 'variant', 'icon', 'disabled', 'loading'],
    template: '<button class="stub-btn" :data-icon="icon" :data-variant="variant"><slot /></button>',
  },
  UiSoilReadingModal: {
    props: ['open', 'plantId', 'data', 'mode', 'wateredToday'],
    emits: ['update:open', 'saved'],
    template: '<div class="soil-modal" :data-open="open" />',
  },
  UiRepotEvaluationModal: {
    props: ['open', 'signs', 'submitting', 'error', 'frozen', 'typicalIntervalMonths'],
    emits: ['submit', 'start-over'],
    template:
      '<div class="eval-modal" :data-open="open">'
      + '<button class="submit-btn" @click="$emit(\'submit\', { answer: \'no-signs\' })">submit</button></div>',
  },
  UiRepotDoneForm: {
    props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
    emits: ['confirm', 'start-over', 'update:open'],
    template:
      '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-submitting="submitting" :data-error="error">'
      + '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true })">confirm</button>'
      + '</div>',
  },
  NuxtLink: { template: '<a><slot /></a>' },
};

const RESOLVED = { id: 'ev-resolved', verdict: 'REPOT' as const, reevaluateOn: null };
function repotTasks() {
  return [
    { plantId: 'A', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: { ...RESOLVED } },
    { plantId: 'B', task: 'REPOT' as const, nextDueOn: '2026-01-01', pendingEvaluation: { ...RESOLVED } },
  ];
}

async function todayAnchorNote(substrate: SubstrateAnchorOutcome | undefined): Promise<string | null> {
  const tasksFixture = repotTasks();
  vi.stubGlobal('useRoute', () => ({ path: '/', query: {} }));
  vi.stubGlobal('useApi', () => ({
    todaysTasks: async () => tasksFixture,
    listPlants: async () => [],
    listPlaces: async () => [],
    getRepotSigns: async () => ({ signs: [] }),
    submitRepotEvaluation: async () => ({ id: 'ev', verdict: 'REPOT', reevaluateOn: null }),
    getPlant: async () => ({ profile: { potSizeCm: 20, soilMix: 'potting-mix' } }),
    completeRepot: async (): Promise<RepotDoneResult> => ({
      ok: true,
      outcome: { status: 'applied' },
      ...(substrate ? { substrate } : {}),
    }),
    getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
    getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [], wateringDays: [] }),
    sendFeedback: async () => ({ ok: true, outcome: { status: 'applied' } }),
  }));
  vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
    data: ref(await fn()),
    refresh: vi.fn(async () => {}),
  }));
  vi.stubGlobal('useLazyAsyncData', (_key: string, fn: () => Promise<unknown>) => {
    const data = ref<unknown>(null);
    void Promise.resolve(fn()).then((v) => { data.value = v; });
    return { data, refresh: vi.fn(async () => {}) };
  });

  const TodayPage = (await import('../pages/index.vue')).default;
  const w = mount(
    { components: { TodayPage }, template: '<Suspense><TodayPage /></Suspense>' },
    { global: { stubs: TODAY_STUBS, mocks: sharedMocks } },
  );
  mounted.push(w);
  await flushPromises();

  await doneButton(w as unknown as Findable)!.trigger('click');
  await flushPromises();
  await w.find('.confirm-btn').trigger('click');
  await flushPromises();

  const note = w.find('.mp-taskrow__outcome-note');
  return note.exists() ? directText(note) : null;
}

// ============================================================================================================
// PLANT DETAIL (components/PlantDetail.vue) — mirrors PlantDetail.test.ts's own AF-20 `mountRepotOutcome`
// pattern: `pendingEvaluation: null` (the verdict already resolved), so Done is directly reachable.
// ============================================================================================================
const PLANT_DETAIL_STUBS = {
  UiScreenHeader: true,
  UiAlert: true,
  UiPlantPhoto: true,
  UiPhotoChip: true,
  UiCard: { template: '<div><slot /></div>' },
  UiPlantName: true,
  UiAppIcon: true,
  UiViabilityBadge: true,
  UiBadge: true,
  UiSectionTitle: true,
  UiEmptyState: true,
  UiMeter: true,
  UiInfoItem: true,
  UiTaskRow: TaskRow,
  AppIcon: true,
  Badge: { template: '<span class="stub-badge"><slot /></span>' },
  Button: {
    props: ['size', 'color', 'variant', 'icon', 'disabled', 'loading'],
    template: '<button class="stub-btn" :data-icon="icon" :data-variant="variant"><slot /></button>',
  },
  HistoryTimeline: true,
  UiImageDropzone: true,
  UiAutosizeTextarea: true,
  UiReasonPicker: true,
  UiTaskInfoModal: true,
  UiImageLightbox: true,
  PlantEditModal: true,
  ProgressEntryModal: true,
  ClinicalRecordModal: true,
  NoteModal: true,
  PlantProfileModal: true,
  UiRepotEvaluationModal: true,
  UiRepotVerdictModal: true,
  UiRepotDoneForm: {
    props: ['open', 'currentPotSizeCm', 'currentSoilMix', 'submitting', 'error', 'frozen'],
    emits: ['confirm', 'start-over', 'update:open'],
    template:
      '<div class="done-form" :data-open="open" :data-frozen="frozen" :data-error="error">'
      + '<button class="confirm-btn" @click="$emit(\'confirm\', { potSizeCm: currentPotSizeCm, soilMix: currentSoilMix, charged: true, occurredOn: \'2026-08-14\' })">confirm</button>'
      + '</div>',
  },
  UiSoilReadingModal: true,
  UiSoilReadingList: true,
  UiPlantCalibrationModal: true,
  NuxtLink: { template: '<a><slot /></a>' },
  UiButton: {
    props: ['disabled', 'loading', 'color', 'variant', 'icon', 'block', 'size', 'to'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
  },
  UiModal: {
    props: ['modelValue', 'title'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" class="generic-modal"><slot /></div>',
  },
  UiConfirmModal: {
    props: ['modelValue', 'title', 'message', 'confirmLabel', 'confirmIcon', 'cancelLabel'],
    emits: ['update:modelValue', 'confirm'],
    template: '<div v-if="modelValue" class="confirm-modal"><button class="confirm-yes" @click="$emit(\'confirm\')" /></div>',
  },
  UiFormGroup: {
    props: ['label', 'error'],
    template: '<div><slot /></div>',
  },
  UiSelectField: {
    props: ['modelValue', 'options', 'placeholder', 'disabled'],
    emits: ['update:modelValue'],
    template: '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"></select>',
  },
};

function basePlant() {
  return {
    id: 'p1', ownerId: 'o1', placeId: 'pl1', speciesSlug: 'ficus-lyrata', nickname: 'Gus',
    acquiredOn: '2026-01-01', speciesScientificName: 'Ficus lyrata', speciesCommonNameEs: null,
    speciesCommonNameEn: null, coverImageUrl: null, speciesGrowthHabit: null,
    lifecycleState: 'ACTIVE' as const, frozenPlaceLabel: null, frozenCityLabel: null,
    latestProgress: null,
  };
}
const repotPlant = () => ({ ...basePlant(), profile: { potSizeCm: 20, soilMix: 'potting-mix' } });
const repotCare = {
  plantId: 'p1',
  tasks: [{ task: 'REPOT', status: 'today', daysUntilDue: 0, pendingEvaluation: null }],
};

async function plantDetailAnchorNote(substrate: SubstrateAnchorOutcome | undefined): Promise<string | null> {
  vi.stubGlobal('useRoute', () => ({ path: '/plants/p1', query: {} }));
  vi.stubGlobal('useRouter', () => ({ replace: vi.fn(async () => {}) }));
  vi.stubGlobal('useApi', () => ({
    getPlant: async () => repotPlant(),
    getPlantCare: async () => repotCare,
    listPlaces: async () => [],
    getPlantHistory: async () => [],
    getPlantPhotos: async () => [],
    getRepotSigns: async () => ({ signs: [] }),
    getSoilReadings: async () => ({ instruments: [], protocol: null, readings: [] }),
    getOwnerInstruments: async () => ({ available: [], selected: [] as string[] }),
    invalidatePlant: vi.fn(),
    completeRepot: vi.fn(async (): Promise<RepotDoneResult> => ({
      ok: true,
      outcome: { status: 'applied' },
      ...(substrate ? { substrate } : {}),
    })),
  }));
  vi.stubGlobal('useAsyncData', async (_key: string, fn: () => Promise<unknown>) => ({
    data: ref(await fn()),
    refresh: vi.fn(async () => {}),
  }));
  vi.stubGlobal('useLazyAsyncData', (_key: string, fn: () => Promise<unknown>) => {
    const data = ref<unknown>(null);
    void Promise.resolve(fn()).then((v) => { data.value = v; });
    return { data, refresh: vi.fn(async () => {}) };
  });

  const PlantDetail = (await import('./PlantDetail.vue')).default;
  const w = mount(
    { components: { PlantDetail }, template: '<Suspense><PlantDetail id="p1" /></Suspense>' },
    { global: { stubs: PLANT_DETAIL_STUBS, mocks: sharedMocks } },
  );
  mounted.push(w);
  await flushPromises();

  await doneButton(w as unknown as Findable)!.trigger('click');
  await flushPromises();
  await w.find('.confirm-btn').trigger('click');
  await flushPromises();

  const note = w.find('.mp-taskrow__outcome-note');
  return note.exists() ? directText(note) : null;
}

// ============================================================================================================
// AGENT CHAT (components/AgentChat.vue) — mirrors AgentChat.test.ts's own V1 "the substrate anchor stayed"
// describe block: an APPROVED proposal whose single operation is `applied` with a `substrate` outcome, and
// `global: 'ALL_APPLIED'` (deliberately, per that file's own comment: this block renders off the per-note
// array, never off `global`).
// ============================================================================================================
const PENDING = {
  id: 'prop-1',
  status: 'PENDING' as const,
  summary: 'summary text',
  autoApproved: false,
  failureCode: null,
  failureReason: null,
  affectedPlantCount: null,
  createdAt: '2026-07-18T10:00:00.000Z',
  operations: [{
    type: 'profile.update' as const,
    targetLabel: 'profile',
    destructive: false,
    changes: [{ field: 'Pot type', before: 'Plastic', after: 'Terracotta' }],
  }],
};
function makeSessions() {
  return {
    create: vi.fn(), resume: vi.fn(),
    history: vi.fn(async () => ({
      turns: [], provider: 'claude' as const, providerSessionId: 'agent-session-1',
      agentSessionMissing: false,
    })),
    providers: vi.fn(async () => []),
    commands: vi.fn(async () => ({ provider: 'claude' as const, commands: [] })),
  };
}
const BannerStub = defineComponent({
  name: 'AgentProposalBanner',
  props: ['proposal', 'i18nNamespace', 'busy', 'errorMessage'],
  template: '<div class="stub-banner">{{ errorMessage }}</div>',
});
const SkipStub = defineComponent({
  name: 'AgentSkipPermissions',
  props: ['modelValue', 'i18nNamespace', 'busy', 'disabled', 'errorMessage'],
  template: '<div class="stub-skip">{{ errorMessage }}</div>',
});

async function agentChatAnchorNote(substrate: SubstrateAnchorOutcome | undefined): Promise<string | null> {
  const proposals = {
    pending: vi.fn(async () => PENDING),
    approve: vi.fn(async () => ({
      ...PENDING,
      status: 'APPROVED' as const,
      outcome: {
        perOperation: [{ status: 'applied' as const, ...(substrate ? { substrate } : {}) }],
        // Deliberately ALL_APPLIED, mirroring AgentChat.test.ts's own V1 tests: this block is gated on the
        // per-operation notes array, never on `global`.
        global: 'ALL_APPLIED' as const,
      },
    })),
    decline: vi.fn(async () => ({ ...PENDING, status: 'DECLINED' as const })),
    getSettings: vi.fn(async () => ({ skipPermissions: false })),
    setSettings: vi.fn(async (_s: string, v: boolean) => ({ skipPermissions: v })),
  };

  const w = mount(AgentChat, {
    props: {
      sessionId: 'sess-1',
      initialProvider: 'claude',
      initialProviderSessionId: 'agent-session-1',
      initialTurns: [],
      sessions: makeSessions(),
      runs: { mintSocketTicket: vi.fn(), fetchAttachment: vi.fn(async () => new Blob(['x'])) },
      socketUrl: 'http://doctor:8400',
      i18nNamespace: 'diagnose',
      proposals: proposals as unknown as ChatProposalsAdapter,
    },
    global: {
      mocks: sharedMocks,
      stubs: {
        AgentProposalBanner: BannerStub,
        AgentSkipPermissions: SkipStub,
        UiImageLightbox: {
          name: 'UiImageLightbox',
          props: ['modelValue', 'images', 'index'],
          template: '<div class="stub-lightbox" />',
        },
      },
    },
  });
  mounted.push(w);
  await flushPromises();
  w.findComponent(BannerStub).vm.$emit('approve');
  await flushPromises();

  const notes = w.findAll('.mp-kchat__note:not(.mp-kchat__note--summary)');
  return notes.length ? directText(notes[0]!) : null;
}

// ============================================================================================================
// The comparison itself.
// ============================================================================================================
const mounted: VueWrapper<any>[] = [];

beforeEach(() => {
  chatStub.state.value = 'idle';
  chatStub.sessionId.value = 'agent-session-1';
  chatStub.queuedMessage.value = null;
  chatStub.returnedToComposer.value = null;
  chatStub.restoredDraft.value = null;
  chatStub.providerBusy.value = false;
});
afterEach(async () => {
  // Deliberately NO `vi.unstubAllGlobals()` here — the composables stubbed once at module scope above
  // (`ref`, `useI18n`, `useTaskMeta`, …) are identical for every mount in every test in this file BY
  // DESIGN (see the "ONE SHARED i18n STUB" comment), so they are meant to survive across tests, exactly
  // like every other file in this suite that stubs its globals once at the top and never tears them down.
  // Only the wrappers need cleanup — a leaked mount keeps a live watcher on `chatStub` (module-level shared
  // state), and a later test driving `chatStub.state` would re-run the leaked instance's own effects.
  while (mounted.length) mounted.pop()!.unmount();
  await flushPromises();
});

async function renderAllThree(substrate: SubstrateAnchorOutcome | undefined) {
  return {
    today: await todayAnchorNote(substrate),
    plantDetail: await plantDetailAnchorNote(substrate),
    agentChat: await agentChatAnchorNote(substrate),
  };
}

describe('cross-surface agreement: the substrate-anchor-kept sentence (Today x PlantDetail x AgentChat)', () => {
  it('renders the IDENTICAL, non-empty anchor-kept sentence on all three surfaces for the SAME outcome', async () => {
    const { today, plantDetail, agentChat } = await renderAllThree({ status: 'kept', refreshedOn: KEPT_DAY });

    // Non-empty first — an equality check alone would be trivially satisfied by three empty strings, which
    // is exactly the false-green shape the positive controls below exist to rule out.
    expect(today).toBeTruthy();
    expect(plantDetail).toBeTruthy();
    expect(agentChat).toBeTruthy();

    // THE load-bearing assertion: the three surfaces agree with EACH OTHER, not with a literal this file
    // invented. If any one of them stops using `substrateAnchorKeptDay()`/`SUBSTRATE_ANCHOR_KEPT_KEY`, or
    // formats the date differently, this equality breaks — regardless of what any single surface's own
    // literal-based test file currently expects.
    expect(plantDetail).toBe(today);
    expect(agentChat).toBe(today);

    // And the sentence they agree on actually carries the interpolated day — not just any non-empty string.
    expect(today).toContain(String(ymdToLocalDate(KEPT_DAY)));
  });

  // POSITIVE CONTROL 1 — an anchor that genuinely moved forward is an ordinary success and earns no
  // sentence. Without this, the equality test above could pass in a world where all three surfaces always
  // render nothing about the anchor at all.
  it('POSITIVE CONTROL — renders NO anchor sentence on any surface when the anchor really moved (refreshed)', async () => {
    const { today, plantDetail, agentChat } = await renderAllThree({ status: 'refreshed', refreshedOn: KEPT_DAY });
    expect(today).toBeNull();
    expect(plantDetail).toBeNull();
    expect(agentChat).toBeNull();
  });

  // POSITIVE CONTROL 2 — an API that said NOTHING about the substrate (a rolling deploy, or any non-REPOT
  // write) must never have a sentence invented for it either.
  it('POSITIVE CONTROL — renders NO anchor sentence on any surface when the write said nothing about the substrate (absent)', async () => {
    const { today, plantDetail, agentChat } = await renderAllThree(undefined);
    expect(today).toBeNull();
    expect(plantDetail).toBeNull();
    expect(agentChat).toBeNull();
  });
});
