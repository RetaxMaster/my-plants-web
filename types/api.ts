import type { AgentCommand, AgentProviderStatus, CommandCatalog, SessionHistory } from '@retaxmaster/agents-realtime-protocol';
import type { TaskCode } from '../utils/tasks.js';
import type {
  PotType, SoilMix, GrowthHabit, WindowDist,
} from '@retaxmaster/my-plants-species-schema/plant-profile-constants';
import type { Airflow } from '@retaxmaster/my-plants-species-schema/place-constants';
import { PHOTO_STATUSES, PHOTO_FAILURE_KINDS, PHOTO_FAILURE_CODES } from '@retaxmaster/my-plants-species-schema/photo-contract-constants';
import type { ProgressTagKey } from '@retaxmaster/my-plants-species-schema/progress-tag-constants';
export type { ProgressTagKey };

export type ViabilityLevel = 'good' | 'caution' | 'poor';

export interface SpeciesSummary { slug: string; scientificName: string; commonNameEs: string | null; commonNameEn: string | null }

export interface City {
  id: string; name: string; latitude: number; longitude: number; timezone: string; isPrimary: boolean;
}
export interface CreateCity {
  name: string; latitude: number; longitude: number; timezone: string; isPrimary?: boolean;
}
export interface CitySearchResult {
  name: string; country: string; admin1: string; latitude: number; longitude: number; timezone: string;
}

export type LightType = 'DIRECT' | 'BRIGHT_INDIRECT' | 'MEDIUM' | 'LOW';
export type HumidityCharacter = 'DRY' | 'NORMAL' | 'HUMID';

export interface Place {
  id: string; ownerId: string; cityId: string; name: string; indoor: boolean; lightType: LightType;
  climateControlled: boolean; humidityCharacter: HumidityCharacter | null;
  indoorTempMinC: number | null; indoorTempMaxC: number | null; airflow: Airflow | null;
}
export interface CreatePlace {
  cityId: string; name: string; indoor: boolean; lightType: LightType;
  climateControlled?: boolean; humidityCharacter?: HumidityCharacter;
  indoorTempMinC?: number | null; indoorTempMaxC?: number | null; airflow?: Airflow;
}

export interface Plant {
  id: string; ownerId: string; placeId: string; speciesSlug: string; nickname: string | null; acquiredOn: string;
  speciesScientificName: string; speciesCommonNameEs: string | null; speciesCommonNameEn: string | null;
  coverImageUrl: string | null;
  // The species' growth habit (spec §2.4) — drives the measure-info modal. Null for an un-curated species.
  speciesGrowthHabit: GrowthHabit | null;
}

export interface Viability { level: ViabilityLevel; reasons: string[] }
export interface UpdatePlant { nickname?: string; placeId?: string }
export interface UpdatePlace {
  name?: string; climateControlled?: boolean; lightType?: LightType;
  humidityCharacter?: HumidityCharacter | null; airflow?: Airflow | null;
  indoorTempMinC?: number | null; indoorTempMaxC?: number | null;
}
export interface CreatePlant {
  placeId: string; speciesSlug: string; nickname?: string; acquiredOn: string;
  lastDone?: { task: CareActionTask; doneOn: string }[]; // PROGRESS excluded — journaled, never seeded
}

// --- Plant physical profile (spec 1 vocabulary; all fields optional/nullable) ---
export interface PlantProfile {
  windowDistance: WindowDist | null;
  growLight: boolean | null;
  potType: PotType | null;
  potSizeCm: number | null;
  hasDrainage: boolean | null;
  soilMix: SoilMix | null;
  growthHabit: GrowthHabit | null;
  ageMonths: number | null;
  nearHeater: boolean | null;
}
// PATCH body: absent key = leave unchanged, explicit null = clear.
export type PlantProfileUpdate = Partial<PlantProfile>;

// One item in the plant photos gallery (every progress photo, flattened, newest-first).
export interface PlantPhotoItem {
  id: string; imageUrl: string; entryId: string; occurredOn: string; sortOrder: number;
}

// Care-basis summary fields carried by GET /plants/:id (spec 2 §6). ProgressHealth is defined below.
export interface PlantLatestProgress {
  entryId: string; occurredOn: string; health: ProgressHealth; observations: string | null;
}
export interface PlantDerived {
  heightCm: number | null;
  lastRepottedOn: string | null;
}
// GET /plants/:id — the plant view enriched with the care-basis payload. GET /plants returns Plant[].
export interface PlantDetail extends Plant {
  profile: PlantProfile;
  latestProgress: PlantLatestProgress | null;
  derived: PlantDerived;
}

export interface DueTaskResponse { plantId: string; task: TaskCode; nextDueOn: string }

export type FeedbackType = 'DONE' | 'POSTPONED' | 'SYMPTOM';
export interface Feedback {
  task: TaskCode; type: FeedbackType; occurredOn: string;
  postponeToOn?: string;
  // Feedback reason. For WATER (spec B): captured on an early WATER Done or a WATER Postpone; a slug from
  // EARLY_WATER_REASONS ∪ WATER_POSTPONE_REASONS. For REPOT (spec F): the inspection outcome on a Postpone,
  // a slug from REPOT_POSTPONE_REASONS. Omitted for every other task and for due waterings.
  //
  // A REPOT Postpone sends NO `postponeToOn`: the server derives a FLOOR date from the reason.
  reason?: string;
  payload?: Record<string, unknown>;
}

export interface OwnerSummary {
  ownerId: string;
  username: string;
  role: 'USER' | 'ADMIN' | null;
}

export interface PlantViability {
  plantId: string; nickname: string | null; speciesSlug: string;
  speciesScientificName: string; speciesCommonNameEs: string | null; speciesCommonNameEn: string | null;
  level: ViabilityLevel; reasons: string[];
  placeCityName: string;
  inPrimaryCity: boolean;
}

export interface PlantCareTask {
  task: TaskCode;
  nextDueOn: string;        // YYYY-MM-DD
  daysUntilDue: number;     // <0 overdue, 0 today, >0 upcoming
  status: 'overdue' | 'today' | 'upcoming';
}
export interface PlantCare {
  plantId: string;
  tasks: PlantCareTask[];
  // Added in Phase C — the per-plant viability semaphore for its current place.
  viability: { level: ViabilityLevel; reasons: string[] };
  // The species' soil-dryness-before-watering slug (e.g. 'mostly-dry'), used by the WATER info modal.
  soilDrynessBeforeWatering?: string;
  // The plant-to-pot crowding index (spec E, Area A). `usedByEngine` is the single source of truth for
  // the height dot on "care is based on" — never re-derive that rule on the client. `repotSigns` is
  // species catalog data, rendered verbatim. Optional so an older API during a rolling deploy still types.
  crowding?: {
    index: number | null;
    usedByEngine: boolean;
    repotSigns: string[];
  };
}

// --- Care History ---
export type ProgressHealth = 'SICK' | 'POOR' | 'GOOD' | 'EXCELLENT';
export type ProgressTagGroup = 'positive' | 'negative';
// label removed — the API sends only { key, group }; the label is resolved on the web via i18n on the
// key (useProgressTagMeta), never duplicated here. ProgressTagKey is the shared closed union re-exported
// above — never re-typed as a bare `string` (fork-prevention).
export interface ProgressTag { key: ProgressTagKey; group: ProgressTagGroup }

// These unions MUST equal the shared arrays exactly — enforced by photo-contract.parity.test.ts. The web
// treats RECOVERING identically to PROCESSING (spec §6.3): still-not-ready, no imageUrl, counts toward
// processingCount, no remove control.
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];
export type PhotoFailureKind = (typeof PHOTO_FAILURE_KINDS)[number];
export type PhotoFailureCode = (typeof PHOTO_FAILURE_CODES)[number];

export interface ProgressPhoto {
  id: string;
  status: PhotoStatus;
  imageUrl: string | null;        // present only when READY
  sortOrder: number;
  originalName: string | null;
  failureKind: PhotoFailureKind | null;
  failureCode: PhotoFailureCode | null;
  retryable: boolean;
}

export interface ProgressEntryDetail {
  id: string;
  plantId: string;
  occurredOn: string;          // YYYY-MM-DD
  health: ProgressHealth;
  observations: string | null;
  sizeCm: number | null;
  tags: ProgressTag[];         // { key, group } — the label is resolved on the web via i18n
  photos: ProgressPhoto[];
  processingCount: number;
  failedCount: number;
}

// What the edit view sends (serialized into a multipart PATCH). `removePhotoIds` are ids of existing
// photos to drop; `files` are new photos to add. A cleared optional field is sent EMPTY (''/'[]'), an
// unchanged-required field (health/occurredOn) is always sent. See spec §2.1 / §3.1.
export interface UpdateProgressPayload {
  health: ProgressHealth;
  occurredOn: string;               // YYYY-MM-DD
  observations: string;             // '' clears
  sizeCm: number | null;            // null clears
  tags: string[];                   // [] clears
  files: File[];                    // new photos
  removePhotoIds: string[];
}

// The six species-scheduled care tasks (PROGRESS excluded — it is the richer 'progress' item).
export type CareActionTask = Exclude<TaskCode, 'PROGRESS'>;

export type HistoryItem =
  | { kind: 'progress'; entryId: string; occurredOn: string; health: ProgressHealth; photoCount: number; processingCount: number; tagCount: number }
  | { kind: 'action'; task: CareActionTask; type: 'DONE'; occurredOn: string };

// Admin knowledge-engine chat (spec 3). Sessions are a shared admin pool; addressed by internal cuid id.
// ⚠️ `LAUNCHING` is the launch-lease state and IS on the wire: a run that won the QUEUED -> LAUNCHING
// conditional update reports it until it registers its pid. It belongs to the API's ACTIVE_RUN_STATUSES
// alongside QUEUED and RUNNING, so anything gating on "is this session busy" must include it.
//
// Omitting it was the dangerous half of the asymmetry rule: for a value we READ, a type NARROWER than
// what the server can emit lies to the compiler about what can arrive. It rendered the raw key path
// `runStatus.LAUNCHING` at the owner and left the delete button enabled during the one window where the
// server is guaranteed to refuse the delete.
export type KnowledgeChatRunStatus = 'QUEUED' | 'LAUNCHING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** The statuses in which a session is busy — mirrors the API's `ACTIVE_RUN_STATUSES`. */
export const ACTIVE_RUN_STATUSES: readonly KnowledgeChatRunStatus[] = ['QUEUED', 'LAUNCHING', 'RUNNING'];

// Which agent runs a conversation. Mirrors the agents-realtime `AgentProvider` wire vocabulary — the
// value the API persists is the value it sends the engine, so this stays a plain string union.
export type KnowledgeChatProvider = 'claude' | 'codex';

// A chat session's scope. KNOWLEDGE = the admin Knowledge Engine pool; DOCTOR = a per-plant diagnosis.
// Present on doctor sessions; absent/KNOWLEDGE on the KE pool.
export type ChatSessionKind = 'KNOWLEDGE' | 'DOCTOR';

export interface KnowledgeChatSessionSummary {
  id: string;
  provider: KnowledgeChatProvider;
  // Scope, returned by the doctor endpoints; the KE endpoints omit it (⇒ KNOWLEDGE).
  kind?: ChatSessionKind;
  // The pinned plant for a DOCTOR session; null/absent for a KNOWLEDGE session.
  plantId?: string | null;
  // The AGENT's own session id (Claude's UUID / Codex's thread id); null until the first run establishes
  // one — a conversation with none can never be resumed.
  providerSessionId: string | null;
  title: string;
  status: KnowledgeChatRunStatus | null;
  turns: number;
  createdAt: string;
  updatedAt: string;
}

// A turn is a prompt OR a command — the API guarantees exactly one is set.
export interface KnowledgeChatTurn {
  runId: string;
  prompt: string | null;
  command: AgentCommand | null;
  status: KnowledgeChatRunStatus;
  isActive: boolean;
  logUrl: string;
}

// What a send carries. The union is the point: there is no shape in which a command rides inside a prompt.
export type KnowledgeChatSendInput = { prompt: string } | { command: AgentCommand };

export type { CommandCatalog };

export interface KnowledgeChatSessionDetail {
  id: string;
  title: string;
  provider: KnowledgeChatProvider;
  // Scope, returned by the doctor endpoints; the KE endpoints omit it (⇒ KNOWLEDGE).
  kind?: ChatSessionKind;
  // The pinned plant for a DOCTOR session; null/absent for a KNOWLEDGE session.
  plantId?: string | null;
  providerSessionId: string | null;
  turns: KnowledgeChatTurn[];
}

// The engine's canonical SessionHistory plus the one fact only our API can report: the agent itself no
// longer holds this session, so the conversation cannot be continued either.
export type KnowledgeChatHistory = SessionHistory & { agentSessionMissing?: boolean };

export interface CreateKnowledgeSessionResponse { sessionId: string; runId: string; ticket: string }
export interface ResumeKnowledgeRunResponse { runId: string; ticket: string }
export interface KnowledgeSocketTicketResponse { ticket: string }

// What the shared <AgentChat> needs from a "sessions" source — the intersection the component actually
// calls (create/resume/history/providers/commands). Both useKnowledgeChatSessions() and
// useDoctorChatSessions() return a superset of this, so either satisfies it structurally (fork-prevention:
// one component, injected scope). `list`/`fetch`/`remove` are used by the PAGE, not the component, so they
// are deliberately absent here.
export interface ChatSessionsAdapter {
  create: (prompt: string, provider: KnowledgeChatProvider) => Promise<CreateKnowledgeSessionResponse>;
  resume: (id: string, input: KnowledgeChatSendInput, provider?: KnowledgeChatProvider) => Promise<ResumeKnowledgeRunResponse>;
  history: (id: string) => Promise<KnowledgeChatHistory>;
  providers: (force?: boolean) => Promise<AgentProviderStatus[]>;
  commands: (provider: KnowledgeChatProvider) => Promise<CommandCatalog>;
}

// What the shared <AgentChatWorkspace> SHELL needs — a SUPERSET of ChatSessionsAdapter that also includes
// the list / fetch / remove the session list + selection use (the inner <AgentChat> does not call these,
// which is why ChatSessionsAdapter omits them). Both useKnowledgeChatSessions() and useDoctorChatSessions()
// return this exact shape, so either satisfies it structurally (fork-prevention: one shell, injected scope).
export interface ChatWorkspaceSessionsAdapter extends ChatSessionsAdapter {
  list: () => Promise<KnowledgeChatSessionSummary[]>;
  fetch: (id: string) => Promise<KnowledgeChatSessionDetail>;
  remove: (id: string) => Promise<unknown>;
}

// What the shared <AgentChat> / <AgentChatWorkspace> need from a "runs" source.
export interface ChatRunsAdapter {
  mintSocketTicket: (runId: string) => Promise<string>;
}

// --- Plant Doctor write proposals (spec 2026-07-18 §5.4, §5.5.1, §5.5.3) ---
//
// The doctor agent cannot mutate anything. It files a PROPOSAL, and the owner approves it. Everything
// below is SERVER-RENDERED: the API resolves each operation's human target label and its before/after
// values and hands them over as strings. That is deliberate and load-bearing — if the browser re-derived
// the labels it would be a second implementation of "what does this change mean", free to disagree with
// the one that actually applies the write. The owner must approve exactly what the server will do.
//
// These types MIRROR `RenderedChange` / `RenderedOperation` / `ProposalView` in the API's
// `src/plant-doctor/proposals/proposal-render.service.ts`. The two repos never co-compile, so nothing
// mechanical keeps them in step. If they ever disagree, THE API WINS and this file is corrected — never
// the reverse, and never by reshaping the payload in the browser.

// Mirrors the Prisma enum `DoctorProposalStatus`. Closed and DB-enforced, so the server cannot emit a
// sixth value without a migration.
export type DoctorProposalStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'EXPIRED' | 'FAILED';

// Mirrors the Prisma enum `DoctorProposalFailureCode` — a CLOSED set of five. The API deliberately keeps
// it coarse: a raw driver error is never something a plant-scoped agent (or this banner) gets to read.
export type DoctorProposalFailureCode = 'VALIDATION' | 'NOT_FOUND' | 'OWNERSHIP' | 'CONFLICT' | 'INTERNAL';

// The `status` travelling in a 409 body from approve/decline. It is NOT `DoctorProposalStatus`: the API
// falls back to the literal `'UNKNOWN'` when the row has vanished entirely
// (`current?.status ?? 'UNKNOWN'`), so a type that admitted only the five enum values would be a lie —
// and an exhaustive switch over it would silently mis-handle the one case that means "we lost track of
// it". Widening a value we only READ is the safe direction; narrowing it is what strands the caller.
export type DoctorProposalConflictStatus = DoctorProposalStatus | 'UNKNOWN';

// The closed operation union's discriminant (spec §5.5.2). The web only ever renders it as a label.
export type DoctorProposalOperationType =
  | 'profile.update'
  | 'plant.update'
  | 'progress.create'
  | 'progress.update'
  | 'progress.delete'
  | 'frequency.set'
  | 'frequency.clear'
  | 'care.done';

// One field-level change inside an operation. `before` is ALWAYS the value to show as current:
// normally the proposal's immutable snapshot, and — when the record drifted since the agent looked —
// the LIVE value, with `stale` carrying what the agent originally saw (§5.5.3). Rendering a stale
// snapshot as if it were current is the one thing the spec forbids outright.
export interface DoctorProposalChange {
  // Server-owned human label for the field ("Pot type", "Every (days)").
  field: string;
  // null = the field currently has no value.
  before: string | null;
  // null = the operation CLEARS the field.
  after: string | null;
  // Present only when the live value drifted from the proposal's snapshot.
  stale?: { atProposeTime: string | null };
}

export interface DoctorProposalOperation {
  type: DoctorProposalOperationType;
  // Server-resolved target ("2026-07-12", "WATER", "Living room"). Rendered verbatim.
  targetLabel: string;
  changes: DoctorProposalChange[];
  // True for progress.delete: the entry AND its photos are gone for good (§7.2). The banner must say so.
  destructive: boolean;
}

export interface DoctorProposal {
  id: string;
  status: DoctorProposalStatus;
  // Agent-authored prose. A CAPTION ONLY — never the consent surface (§5.4). A misleading summary must
  // not be able to change what is shown or what is applied.
  summary: string;
  operations: DoctorProposalOperation[];
  autoApproved: boolean;
  failureCode: DoctorProposalFailureCode | null;
  failureReason: string | null;
  // `createdAt` is a `Date` on the server; it crosses JSON as an ISO-8601 string.
  createdAt: string;
}

// Per-session Dangerously Skip Permissions (§6.4). Owner-toggled only; the agent may read it and never write it.
export interface DoctorSessionSettings {
  skipPermissions: boolean;
}

// What the shared <AgentChat> needs from a "proposals" source. OPTIONAL by design: the Knowledge Engine
// injects nothing and therefore renders no approval surface at all, while the doctor page injects the
// plant-scoped adapter. One component, injected scope — the same fork-prevention shape as
// ChatSessionsAdapter / ChatRunsAdapter above.
//
// NOTE on `pending`: the ADAPTER's contract is "a proposal, or null". That is a NORMALIZATION, not the
// raw wire shape — on the wire, "nothing pending" is 200 with an EMPTY BODY, which reaches the browser
// as `''`, not `null`. `useApi.getDoctorPendingProposal` performs that coercion so no consumer has to
// know. See its comment for why the raw shape is a trap.
export interface ChatProposalsAdapter {
  pending: (sessionId: string) => Promise<DoctorProposal | null>;
  approve: (sessionId: string, proposalId: string) => Promise<DoctorProposal>;
  decline: (sessionId: string, proposalId: string) => Promise<DoctorProposal>;
  getSettings: (sessionId: string) => Promise<DoctorSessionSettings>;
  setSettings: (sessionId: string, skipPermissions: boolean) => Promise<DoctorSessionSettings>;
}

// --- Blog & media (Spec 3; mirrors the API read-models in Spec 1) ---

// Paginated envelope returned by GET /blog, GET /blogposts, GET /media.
export interface BlogPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Public feed card (GET /blog items). Bilingual title/excerpt; the web picks the locale field.
// Date fields arrive as ISO strings over JSON. difficulty is currently always null (no species
// difficulty signal exists yet) — the badge is rendered only when it is non-null.
export interface BlogpostCard {
  slug: string;
  titleEs: string;
  titleEn: string | null;
  excerptEs: string;
  excerptEn: string | null;
  coverImageUrl: string | null;
  publishedAt: string | null;
  readingMinutes: number;
  speciesSlug: string | null;
  speciesScientificName: string | null;
  speciesCommonNameEs: string | null;
  speciesCommonNameEn: string | null;
  difficulty: string | null;
}

// Public single-post detail (GET /blog/:slug) — card + body/youtube/cta.
export interface BlogpostDetail extends BlogpostCard {
  bodyEs: string;
  bodyEn: string | null;
  youtubeUrl: string | null;
  ctaLink: string | null;
  ctaLabelEs: string | null;
  ctaLabelEn: string | null;
}

// The full editor view — the RAW blogpost row returned by the admin routes (create/get/patch/cover).
// No species-derived fields, no readingMinutes (that is a public-feed projection only).
export interface BlogpostAdminDetail {
  slug: string;
  status: 0 | 1;
  speciesSlug: string | null;
  titleEs: string;
  titleEn: string | null;
  excerptEs: string;
  excerptEn: string | null;
  bodyEs: string;
  bodyEn: string | null;
  coverImageUrl: string | null;
  coverImageObjectKey: string | null;
  coverImagePrompt: string | null;
  youtubeUrl: string | null;
  ctaLink: string | null;
  ctaLabelEs: string | null;
  ctaLabelEn: string | null;
  createdByUserId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Writing-desk list row (GET /blogposts items).
export interface BlogpostAdminRow {
  slug: string;
  status: 0 | 1;
  titleEs: string;
  excerptEs: string;
  coverImageUrl: string | null;
  speciesSlug: string | null;
  updatedAt: string;
}

// Media library asset (POST /media response + GET /media items).
export interface MediaAssetView {
  id: string;
  imageUrl: string;
  filename: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

// Create/update request bodies (server-owned fields omitted; speciesSlug is whitelist-stripped by the
// API — the desk only creates/edits free-form posts). ES leads (required); EN + the rest are optional.
export interface CreateBlogpost {
  slug?: string;
  status?: 0 | 1;
  titleEs: string;
  titleEn?: string | null;
  excerptEs: string;
  excerptEn?: string | null;
  bodyEs: string;
  bodyEn?: string | null;
  coverImageUrl?: string | null;
  coverImageObjectKey?: string | null;
  youtubeUrl?: string | null;
  ctaLink?: string | null;
  ctaLabelEs?: string | null;
  ctaLabelEn?: string | null;
}

export type UpdateBlogpost = Partial<CreateBlogpost>;
