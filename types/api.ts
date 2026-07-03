import type { TaskCode } from '../utils/tasks.js';

export type ViabilityLevel = 'good' | 'caution' | 'poor';

export interface SpeciesSummary { slug: string; scientificName: string; commonName: string }

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
  indoorTempMinC: number | null; indoorTempMaxC: number | null;
}
export interface CreatePlace {
  cityId: string; name: string; indoor: boolean; lightType: LightType;
  climateControlled?: boolean; humidityCharacter?: HumidityCharacter;
  indoorTempMinC?: number | null; indoorTempMaxC?: number | null;
}

export interface Plant {
  id: string; ownerId: string; placeId: string; speciesSlug: string; nickname: string | null; acquiredOn: string;
  speciesScientificName: string; speciesCommonName: string;
}

export interface Viability { level: ViabilityLevel; reasons: string[] }
export interface UpdatePlant { nickname?: string; placeId?: string }
export interface UpdatePlace { name?: string; climateControlled?: boolean }
export interface CreatePlant {
  placeId: string; speciesSlug: string; nickname?: string; acquiredOn: string;
  lastDone?: { task: CareActionTask; doneOn: string }[]; // PROGRESS excluded — journaled, never seeded
}

export interface DueTaskResponse { plantId: string; task: TaskCode; nextDueOn: string }

export type FeedbackType = 'DONE' | 'POSTPONED' | 'SYMPTOM';
export interface Feedback {
  task: TaskCode; type: FeedbackType; occurredOn: string;
  postponeToOn?: string; payload?: Record<string, unknown>;
}

export interface OwnerSummary {
  ownerId: string;
  username: string;
  role: 'USER' | 'ADMIN' | null;
}

export interface PlantViability {
  plantId: string; nickname: string | null; speciesSlug: string;
  speciesScientificName: string; speciesCommonName: string;
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
}

// --- Care History ---
export type ProgressHealth = 'SICK' | 'POOR' | 'GOOD' | 'EXCELLENT';
export type ProgressTagGroup = 'positive' | 'negative';
export interface ProgressTag { key: string; label: string; group: ProgressTagGroup }
// Only the KEY type lives on the web; label/group data comes from GET /progress/catalog (not duplicated).
export type ProgressTagKey = string;

export interface ProgressPhoto { id: string; imageUrl: string; sortOrder: number }
export interface ProgressEntryDetail {
  id: string;
  plantId: string;
  occurredOn: string;          // YYYY-MM-DD
  health: ProgressHealth;
  observations: string | null;
  sizeCm: number | null;
  tags: ProgressTag[];         // resolved key+label+group
  photos: ProgressPhoto[];
}

// The six species-scheduled care tasks (PROGRESS excluded — it is the richer 'progress' item).
export type CareActionTask = Exclude<TaskCode, 'PROGRESS'>;

export type HistoryItem =
  | { kind: 'progress'; entryId: string; occurredOn: string; health: ProgressHealth; photoCount: number; tagCount: number }
  | { kind: 'action'; task: CareActionTask; type: 'DONE'; occurredOn: string };

// Admin knowledge-engine chat (spec 3). Sessions are a shared admin pool; addressed by internal cuid id.
export type KnowledgeChatRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface KnowledgeChatSessionSummary {
  id: string;
  claudeSessionId: string | null;
  title: string;
  status: KnowledgeChatRunStatus | null;
  turns: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChatTurn {
  runId: string;
  prompt: string;
  status: KnowledgeChatRunStatus;
  isActive: boolean;
  logUrl: string;
}

export interface KnowledgeChatSessionDetail {
  id: string;
  title: string;
  claudeSessionId: string | null;
  turns: KnowledgeChatTurn[];
}

export interface CreateKnowledgeSessionResponse { sessionId: string; runId: string; ticket: string }
export interface ResumeKnowledgeRunResponse { runId: string; ticket: string }
export interface KnowledgeSocketTicketResponse { ticket: string }

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
  speciesCommonName: string | null;
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
