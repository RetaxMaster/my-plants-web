import type { AgentProviderStatus } from '@retaxmaster/agents-realtime-protocol';
import { IDEMPOTENCY_KEY_HEADER } from '@retaxmaster/my-plants-species-schema';
import type { InstrumentId } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import { checkChatSendLimits, sendChatJson, type ChatAttachmentPayload } from '../utils/chatSend.js';
import { createGetCache, getCacheKey, getCacheKeyPath, type GetCache } from '~/utils/getCache';
import { withIdempotencyKey } from '~/utils/idempotency';
import type {
  City, CitySearchResult, CommandCatalog, CreateCity, CreateKnowledgeSessionResponse, CreatePlace, CreatePlant,
  DueTaskResponse, Feedback, HistoryItem, KnowledgeChatSendInput, KnowledgeChatSessionDetail, KnowledgeChatSessionSummary,
  KnowledgeSocketTicketResponse, OwnerSummary, Place, Plant, PlantCare, PlantViability,
  KnowledgeChatHistory, KnowledgeChatProvider, ProgressEntryDetail, ProgressTag, ResumeKnowledgeRunResponse, SpeciesSummary,
  UpdatePlace, UpdatePlant, Viability,
  PlantDetail, PlantLifecycleState, PlantProfile, PlantProfileUpdate, PlantPhotoItem,
  BlogPage, BlogpostCard, BlogpostDetail, BlogpostAdminDetail, BlogpostAdminRow,
  MediaAssetView, CreateBlogpost, UpdateBlogpost,
  AgentProposal, DoctorSessionSettings,
  ClinicalRecordSummary, ClinicalRecordDetail,
  RepotSign, RepotSignsResponse, RepotEvaluationSubmit, RepotEvaluationResult, RepotDonePayload,
  OwnerInstruments, PlantSoilReadings, CreateSoilReading, InstrumentCalibration, SoilReadingPreview,
  CareWriteResult, RepotDoneResult,
} from '../types/api.js';

// Bounded wait for the two REPOT mutating submits (round-4 finding V2): a plain JSON POST via ofetch has NO
// default timeout, so a connection that HANGS (rather than rejecting) leaves RepotEvaluationModal.vue /
// RepotDoneForm.vue's `submitting` spinner spinning and every control disabled forever — `frozen && error`
// never becomes true because no error ever arrives, so the "start over" escape hatch never renders either.
// Same technique the sliding-session refresh already uses (`utils/refreshMemo.ts`'s `REFRESH_TIMEOUT_MS`,
// wired through ofetch's own `timeout` option in `server/middleware/session-slide.ts`) rather than the
// uploads' XHR watchdog (`utils/upload.ts`) — these are plain JSON bodies with no upload-progress events to
// arm a stall timer against, so ofetch's built-in abort-after-`timeout` is the right-sized tool, not a
// second XHR machinery. 20s is generous for a same-origin write + one plant's care recompute (no image
// processing, no R2 round-trip) while still bounding the wait to something the owner can act on: on timeout
// ofetch aborts and rejects like any other network failure, so the callers' existing catch block (keep the
// idempotency key, surface `repotError`) already produces the exact recovery state this fix requires.
const REPOT_SUBMIT_TIMEOUT_MS = 20_000;

// Client-side app-scoped GET cache (one per browser tab, lives until a full reload). The SERVER cache is
// request-scoped instead (hung off the SSR event context below) — a server module-global would leak one
// user's data into another user's render.
const clientGetCache: GetCache = createGetCache();

// Flush the client-side app-scoped GET cache. The cache is keyed only by path, so it MUST be cleared on any
// client-side auth-identity change — login, logout, the forced-401 logout, or an acting-as switch. Without
// it, a same-tab account switch (an SPA navigateTo, NOT a full reload) would serve the previous identity's
// cached reads to the next user — a cross-user leak. `plugins/session-cache-flush.client.ts` calls this on
// every identity transition so the "never across users" guarantee is structural, not reliant on a reload.
export function flushClientGetCache(): void {
  clientGetCache.flush();
}

export function useApi() {
  // The browser only ever talks to the same-origin Nitro proxy at /api; the proxy
  // attaches the bearer from the sealed session. During SSR we clone the incoming
  // request (cookies/headers) with useRequestFetch() so the session cookie reaches
  // the proxy. Capture the fetcher in setup scope — useRequestFetch() must not be
  // called lazily inside a handler after an await.
  const fetcher = import.meta.server ? useRequestFetch() : $fetch;
  // Capture the session in setup scope so the 401 handler below never calls a
  // composable after an await (which would trigger a composable-scope warning).
  const session = useUserSession();
  const { t, locale } = useI18n();

  // Request-scoped on the server (never a module-global → no cross-user leak), app-scoped on the client.
  // useRequestEvent() can return undefined outside a real incoming request (e.g. some build-time/SSG
  // contexts) — same nullability the codebase already guards for elsewhere (see pages/blog/[id].vue) — so
  // that edge falls back to a fresh, unshared cache rather than assuming the event always exists.
  const cache: GetCache = (() => {
    if (import.meta.server) {
      const event = useRequestEvent();
      if (!event) return createGetCache();
      const ctx = event.context as Record<string, unknown>;
      return (ctx.__apiGetCache as GetCache | undefined) ?? (ctx.__apiGetCache = createGetCache()) as GetCache;
    }
    return clientGetCache;
  })();
  // Any successful mutation (POST/PATCH/PUT/DELETE) flushes the WHOLE GET cache — the simplest
  // always-correct invalidation rule, called from all three mutation-capable paths below (api(), upload(),
  // sendChat()) on their SUCCESS branch only. A failed mutation changed nothing, so nothing is flushed.
  const flushGetCache = () => cache.flush();

  // A mid-session 401 means the bearer was revoked/expired: drop the stale session and bounce to
  // /login. Client-side only, and ONLY when we actually had a session — so a public page (blog) that
  // ever sees a 401 from a public endpoint is never bounced to login for a logged-out visitor.
  const handle401 = async (e: any) => {
    if (import.meta.client && session.loggedIn.value && (e?.statusCode === 401 || e?.response?.status === 401)) {
      await session.clear();
      await navigateTo('/login');
    }
  };

  const api = async <T>(path: string, opts?: Parameters<typeof $fetch>[1]) => {
    const method = ((opts as { method?: string } | undefined)?.method ?? 'GET').toUpperCase();
    const isGet = method === 'GET';
    // Global idempotency-key attach seam (createPlant-idempotency feature): computed uniformly for every
    // call, GET included — the helper itself no-ops on a GET (and on an excluded /auth/* path), so the
    // GET-cached branch below is unaffected: the cache is still keyed by `path` alone and a GET never grows
    // an Idempotency-Key header. Only a mutating POST gets one attached, and a caller-pinned key (plant-
    // create's own retry key) is preserved rather than overwritten. See utils/idempotency.ts.
    //
    // Deliberately OUT of scope here: the XHR upload()/sendChat() paths below don't call api() at all for
    // their attachment-carrying branches, so they get no auto-attached key — the bulk import batch already
    // has its own per-clientKey idempotency (see appendImportChunk), and no other upload path has asked for
    // this guarantee yet.
    const finalOpts = withIdempotencyKey(method, path, opts as any);
    try {
      // GETs are deduped + cached for this scope's lifetime; a REJECTED GET evicts itself immediately
      // (see getCache.ts), so a failed read never poisons the cache for the retry.
      //
      // Keyed by locale + path, not path alone: the BFF proxy forwards an `x-locale` header derived from
      // the active locale on every request, so a locale-sensitive endpoint's response body is only valid
      // for the locale it was fetched under. This does NOT claim `locale.value` and the `x-locale` cookie
      // are always in lockstep (they need not be) — all that's required is that the key CHANGES when the
      // owner switches language, so a stale-locale body is never served back after the switch.
      if (isGet) {
        return await cache.get<T>(
          getCacheKey(locale.value, path),
          () => fetcher<T>(`/api${path}`, finalOpts as any) as Promise<T>,
        );
      }
      const res = await fetcher<T>(`/api${path}`, finalOpts as any);
      // Flush on SUCCESS only — a failed mutation changed nothing server-side, so the existing GET cache
      // is still accurate and must not be thrown away.
      flushGetCache();
      return res;
    } catch (e: any) {
      await handle401(e);
      throw e;
    }
  };

  // EVERY file upload goes through here — never through `api()`. A large body can be refused by NGINX
  // (413) while the browser is still sending it, and a fetch() in that state never settles: the save
  // hangs forever with no error (see utils/upload.ts). So an upload is (1) pre-flighted against the
  // limits the server actually enforces, and (2) sent over XHR, whose progress events let us detect a
  // dead connection. Failures arrive in the same shape as any API error (`e.data.code`/`e.data.message`),
  // so callers keep a single catch block.
  const upload = async <T>(
    path: string,
    form: FormData,
    opts: { method?: 'POST' | 'PUT' | 'PATCH'; onProgress?: (percent: number) => void } = {},
  ): Promise<T> => {
    const rejection = checkUploadLimits(form);
    if (rejection) throw makeUploadError(rejection.code, t(`upload.${rejection.code}`, rejection.params));
    try {
      const res = await uploadFormData<T>(`/api${path}`, form, opts);
      // upload() is ALWAYS a mutation (cover photo, progress entry, media, …) — flush on success only, same
      // rule as api()'s mutation branch above.
      flushGetCache();
      return res;
    } catch (e: any) {
      await handle401(e);
      // Give our own client-side failures (dead connection, backend never answered) a translated,
      // actionable message; an API error already carries its own.
      const code: string | undefined = e?.data?.code;
      if (code === 'upload_stalled' || code === 'upload_no_response' || code === 'upload_network') {
        e.data.message = t(`upload.${code}`);
      }
      // 413 never comes from our API — it comes from the infrastructure in front of it (NGINX's
      // client_max_body_size), so it carries no error code of ours. Say the one thing the user can act
      // on: the photos were too heavy for the server. Without this they retry the same batch and fail
      // again on a generic "could not save".
      if (e?.statusCode === 413) {
        e.data = { ...(e.data ?? {}), code: 'upload_rejected_by_server', message: t('upload.upload_rejected_by_server') };
      }
      throw e;
    }
  };

  // A send with attachments must fail VISIBLY: it goes through the watchdogged XHR path, never a bare
  // fetch() that can hang forever on a hop that closes the socket mid-upload (see utils/chatSend.ts). A
  // send with no attachments keeps the existing $fetch path unchanged — it is exactly as light as any other
  // JSON call, so it gets none of the XHR/watchdog machinery.
  const sendChat = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const attachments = (body.attachments ?? []) as ChatAttachmentPayload[];
    // Cast needed only because `api`'s own generic T, forwarded through a SECOND generic function (this
    // one), loses ofetch's route-typing machinery down to an opaque conditional type TS can no longer prove
    // reduces to T — a generic-forwarding quirk, not a real type mismatch (every other call site here calls
    // `api<Concrete>()` directly, where the conditional type collapses cleanly).
    // The no-attachments branch already goes through api(), which flushes on its own success path — no
    // separate flush needed here.
    if (attachments.length === 0) return api<T>(path, { method: 'POST', body }) as Promise<T>;
    const rejection = checkChatSendLimits(String(body.prompt ?? ''), attachments);
    if (rejection) throw createError({ statusCode: 400, data: { code: rejection.code } });
    try {
      const res = await sendChatJson<T>(`/api${path}`, body);
      // The attachments branch bypasses api() entirely (its own XHR path), so it flushes explicitly on
      // success — a chat send is a mutation (it creates/advances a session), same rule as the other two paths.
      flushGetCache();
      return res;
    } catch (e: any) {
      await handle401(e);
      throw e;
    }
  };

  // A BINARY read. Deliberately NOT routed through `api()`: that path is JSON-shaped and caches every GET
  // by path in the app-scoped GET cache, and a cache of image blobs keyed by url is both a memory leak
  // and a way to serve one conversation's photo after an identity switch. This asks ofetch for a Blob and
  // caches nothing.
  //
  // It still goes through the SAME `/api` BFF proxy as everything else (the browser never talks to the
  // NestJS API directly), and the proxy's binary branch is what preserves the bytes, the status and the
  // content type. A non-2xx throws exactly like any other call, carrying its status — which is what lets
  // the caller tell an expired image (410) apart from a misconfiguration (500).
  const fetchChatAttachment = async (path: string): Promise<Blob> => {
    try {
      return await fetcher<Blob>(`/api${path}`, { responseType: 'blob' } as any);
    } catch (e: any) {
      await handle401(e);
      throw e;
    }
  };

  return {
    // Drop this plant's cached GET reads (`/plants/:id`, `/plants/:id/photos`, `/plants/:id/history`, …)
    // from the page-lifetime GET cache. A normal refresh() re-runs its fetcher but this cache re-serves
    // the cached value, so a DELAYED re-read that no mutation flushed the cache for (reconciling a
    // background-processed photo whose worker finished AFTER the write returned) would otherwise never see
    // the new data. Scope is exactly this plant's keys, not a whole-cache flush.
    invalidatePlant: (id: string) => {
      const base = `/plants/${id}`;
      // Cache keys now carry a locale prefix (see the `cache.get` call in api() above), so matching against
      // the raw key would silently match nothing. Compare against the PATH half of the key instead — this
      // still invalidates the plant's cached reads under every locale it was fetched in.
      cache.invalidate((k) => {
        const p = getCacheKeyPath(k);
        return p === base || p.startsWith(`${base}/`) || p.startsWith(`${base}?`);
      });
    },

    // Chat-attachment recall (spec 2026-08-01 §3.4). Shared by all three runs adapters
    // (useKnowledgeChatRuns / useDoctorChatRuns / useGardenerChatRuns) — each builds its own surface's
    // path via `~/utils/chatAttachmentPath` and hands it here unchanged.
    fetchChatAttachment,

    listSpecies: () => api<SpeciesSummary[]>('/species'),

    // --- Blog (public: no session; @Public on the API) ---
    listBlog: (page = 1, pageSize = 10) =>
      api<BlogPage<BlogpostCard>>(`/blog?page=${page}&pageSize=${pageSize}`),
    getBlogpost: (slug: string) => api<BlogpostDetail>(`/blog/${slug}`),

    // --- Blog admin (RolesGuard ADMIN on the API) ---
    // q is free text (title/slug) so it MUST be encoded; build the query with URLSearchParams and
    // omit empty params. Called with no args by the desk's default view.
    listBlogposts: (params: { status?: 0 | 1; q?: string; page?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.status !== undefined) qs.set('status', String(params.status));
      if (params.q) qs.set('q', params.q);
      if (params.page) qs.set('page', String(params.page));
      const query = qs.toString();
      return api<BlogPage<BlogpostAdminRow>>(`/blogposts${query ? `?${query}` : ''}`);
    },
    createBlogpost: (body: CreateBlogpost) =>
      api<BlogpostAdminDetail>('/blogposts', { method: 'POST', body }),
    getBlogpostAdmin: (slug: string) => api<BlogpostAdminDetail>(`/blogposts/${slug}`),
    updateBlogpost: (slug: string, body: UpdateBlogpost) =>
      api<BlogpostAdminDetail>(`/blogposts/${slug}`, { method: 'PATCH', body }),
    deleteBlogpost: (slug: string) =>
      api<{ ok: true }>(`/blogposts/${slug}`, { method: 'DELETE' }),
    uploadBlogpostCover: (slug: string, form: FormData) =>
      upload<BlogpostAdminDetail>(`/blogposts/${slug}/cover`, form),

    // --- Media library (RolesGuard ADMIN on the API) ---
    uploadMedia: (form: FormData) => upload<MediaAssetView>('/media', form),
    listMedia: (page = 1) => api<BlogPage<MediaAssetView>>(`/media?page=${page}`),
    deleteMedia: (id: string) => api<{ ok: true }>(`/media/${id}`, { method: 'DELETE' }),

    listCities: () => api<City[]>('/cities'),
    createCity: (body: CreateCity) => api<City>('/cities', { method: 'POST', body }),
    makePrimaryCity: (id: string) => api<City>(`/cities/${id}/make-primary`, { method: 'POST' }),
    searchCities: (q: string) =>
      api<CitySearchResult[]>(`/cities/search?q=${encodeURIComponent(q)}`),

    listPlaces: () => api<Place[]>('/places'),
    createPlace: (body: CreatePlace) => api<Place>('/places', { method: 'POST', body }),
    updatePlace: (id: string, body: UpdatePlace) => api<Place>(`/places/${id}`, { method: 'PATCH', body }),

    // Lifecycle-scoped section listing (Spec 3/Phase 4): the API defaults/coerces an unknown or missing
    // `lifecycle` query param to `active`, so the default param here matches the server's own default —
    // every pre-existing `listPlants()` call site (no args) keeps listing the active garden unchanged.
    listPlants: (lifecycle: PlantLifecycleState = 'ACTIVE') =>
      api<Plant[]>(`/plants?lifecycle=${lifecycle.toLowerCase()}`),
    listPantheon: () => api<Plant[]>('/plants?lifecycle=memorial'),
    listGifted: () => api<Plant[]>('/plants?lifecycle=gifted'),
    memorializePlant: (id: string) => api<PlantDetail>(`/plants/${id}/memorialize`, { method: 'POST' }),
    giftPlant: (id: string) => api<PlantDetail>(`/plants/${id}/gift`, { method: 'POST' }),
    revivePlant: (id: string, placeId: string) =>
      api<PlantDetail>(`/plants/${id}/revive`, { method: 'POST', body: { placeId } }),
    getPlant: (id: string) => api<PlantDetail>(`/plants/${id}`),
    setCoverPhoto: async (id: string, file: File) => {
      // One shared path (spec §3b): the cover photo is compressed through the SAME seam as progress photos
      // before it hits the wire. No HD toggle here — cover is a single auto-upload-on-pick; the seam still
      // fails open, so a compression hiccup uploads the original.
      const { compress } = useImageCompression();
      const c = await compress(file);
      const form = new FormData();
      form.append('photo', c.blob, c.filename);
      return upload<PlantDetail>(`/plants/${id}/cover-photo`, form, { method: 'PUT' });
    },
    deleteCoverPhoto: (id: string) =>
      api<PlantDetail>(`/plants/${id}/cover-photo`, { method: 'DELETE' }),
    getPlantProfile: (id: string) => api<PlantProfile>(`/plants/${id}/profile`),
    updatePlantProfile: (id: string, patch: PlantProfileUpdate) =>
      api<PlantProfile>(`/plants/${id}/profile`, { method: 'PATCH', body: patch }),
    getPlantPhotos: (id: string) => api<PlantPhotoItem[]>(`/plants/${id}/photos`),
    getPlantCare: (id: string) => api<PlantCare>(`/plants/${id}/care`),
    getRepotSigns: (plantId: string) => api<RepotSignsResponse>(`/plants/${plantId}/repot-signs`),

    // ---- Measured soil (spec Part C) ----------------------------------------------------------------
    getOwnerInstruments: () => api<OwnerInstruments>('/settings/instruments'),
    setOwnerInstruments: (selected: InstrumentId[]) =>
      api<OwnerInstruments>('/settings/instruments', { method: 'PUT', body: { selected } }),

    getSoilReadings: (plantId: string) =>
      api<PlantSoilReadings>(`/plants/${plantId}/soil-readings`),

    /** `idempotencyKey` is PINNED, minted once when the measuring modal opens and reused on every retry —
     *  the same stable-key discipline the repot submit uses. A create whose response is lost after the
     *  server committed must never write a second reading. */
    recordSoilReading: (plantId: string, body: CreateSoilReading, idempotencyKey: string) =>
      api<{ readingId: string }>(`/plants/${plantId}/soil-readings`, {
        method: 'POST',
        body,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      }),

    /** Read-only — "water this pot today, or hold?" — writes nothing, so unlike `recordSoilReading` it
     *  carries NO idempotency key: the interceptor dedups any header-bearing POST regardless of route, and
     *  a preview has no create to protect from a lost-response retry. */
    previewSoilReading: (plantId: string, body: { instrumentId: InstrumentId; rawValue: number }) =>
      api<SoilReadingPreview>(`/plants/${plantId}/soil-readings/preview`, { method: 'POST', body }),

    setInstrumentCalibration: (
      plantId: string, instrumentId: InstrumentId, body: InstrumentCalibration,
    ) =>
      api<InstrumentCalibration>(
        `/plants/${plantId}/soil-readings/calibration/${instrumentId}`, { method: 'PUT', body },
      ),

    /**
     * The submit boundary. `idempotencyKey` is a STABLE key minted at the submit boundary and reused across
     * retries of that same submission — never a fresh one per attempt, and never content-derived (two
     * genuinely separate evaluations of one plant must not collapse into one).
     */
    submitRepotEvaluation: (plantId: string, body: RepotEvaluationSubmit, idempotencyKey: string) =>
      api<RepotEvaluationResult>(`/plants/${plantId}/repot-evaluation`, {
        method: 'POST',
        body,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        timeout: REPOT_SUBMIT_TIMEOUT_MS,
      }),

    /** A REPOT completion. Same stable-key discipline as the evaluation submit.
     *
     *  Answers with `RepotDoneResult`, not the plain `CareWriteResult` every other care write returns: a
     *  completion also reports what the SUBSTRATE CLOCK did (`substrate`), because that clock only ever
     *  moves forward and a completion dated before the stored anchor leaves it standing. The two outcomes
     *  are independent — see `SubstrateAnchorOutcome`. */
    completeRepot: (plantId: string, occurredOn: string, payload: RepotDonePayload, idempotencyKey: string) =>
      api<RepotDoneResult>(`/plants/${plantId}/feedback`, {
        method: 'POST',
        body: { task: 'REPOT', type: 'DONE', occurredOn, payload },
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        timeout: REPOT_SUBMIT_TIMEOUT_MS,
      }),
    // `idempotencyKey`, when passed, is PINNED as the Idempotency-Key header — Task 8's withIdempotencyKey
    // (inside api(), above) preserves a caller-pinned key rather than minting its own. This is what lets
    // pages/plants/new.vue anchor one stable key to the whole submit lifecycle (mint once, reuse on every
    // retry) instead of getting a fresh key auto-generated on each call, which would defeat the dedup. When
    // omitted, the auto-generated key still applies — no caller regresses.
    createPlant: (body: CreatePlant, idempotencyKey?: string) =>
      api<Plant>('/plants', {
        method: 'POST',
        body,
        headers: idempotencyKey ? { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } : undefined,
      }),
    updatePlant: (id: string, body: UpdatePlant) => api<Plant>(`/plants/${id}`, { method: 'PATCH', body }),
    previewPlantViability: (id: string, placeId: string) =>
      api<Viability>(`/plants/${id}/viability-preview?placeId=${encodeURIComponent(placeId)}`),

    todaysTasks: () => api<DueTaskResponse[]>('/care-plan/today'),
    recompute: () => api<{ ok: true }>('/care-plan/recompute', { method: 'POST' }),

    sendFeedback: (plantId: string, body: Feedback) =>
      api<CareWriteResult>(`/plants/${plantId}/feedback`, { method: 'POST', body }),

    // Care History
    getProgressCatalog: () => api<ProgressTag[]>('/progress/catalog'),
    // The heaviest upload in the app: up to 8 raw camera photos in one request. onProgress drives a real
    // percentage on the save button so a slow phone upload never LOOKS like a frozen one.
    logProgress: (plantId: string, form: FormData, onProgress?: (percent: number) => void) =>
      upload<ProgressEntryDetail>(`/plants/${plantId}/progress`, form, { onProgress }),
    getProgressEntry: (plantId: string, entryId: string) =>
      api<ProgressEntryDetail>(`/plants/${plantId}/progress/${entryId}`),
    // Edit an entry: changed fields + new `photos` files + `removePhotoIds` in ONE multipart PATCH. Goes
    // through the XHR upload path (files + a real progress %), exactly like logProgress.
    updateProgress: (plantId: string, entryId: string, form: FormData, onProgress?: (percent: number) => void) =>
      upload<ProgressEntryDetail>(`/plants/${plantId}/progress/${entryId}`, form, { method: 'PATCH', onProgress }),
    // Retry a transient-failed photo. No body; returns the refreshed entry. Not an upload — plain api().
    retryProgressPhoto: (plantId: string, entryId: string, photoId: string) =>
      api<ProgressEntryDetail>(`/plants/${plantId}/progress/${entryId}/photos/${photoId}/retry`, { method: 'POST' }),
    // Delete the whole entry (204). Returns nothing.
    deleteProgress: (plantId: string, entryId: string) =>
      api<void>(`/plants/${plantId}/progress/${entryId}`, { method: 'DELETE' }),
    getPlantHistory: (plantId: string) => api<HistoryItem[]>(`/plants/${plantId}/history`),
    // Bulk history import (Spec 3/Phase 4, T30 composes the FormData): the wire carries repeated `photos`
    // parallel to repeated `clientKeys`, chunked and idempotent per key on the server, so a chunk may be
    // retried safely. `finishImport` closes the batch once every chunk has landed.
    appendImportChunk: (plantId: string, form: FormData, onProgress?: (percent: number) => void) =>
      upload<void>(`/plants/${plantId}/progress/import`, form, { onProgress }),
    finishImport: (plantId: string) => api<void>(`/plants/${plantId}/progress/import/finish`, { method: 'POST' }),
    getClinicalRecords: (plantId: string) =>
      api<ClinicalRecordSummary[]>(`/plants/${plantId}/clinical-records`),
    getClinicalRecord: (plantId: string, recordId: string) =>
      api<ClinicalRecordDetail>(`/plants/${plantId}/clinical-records/${recordId}`),
    // Plain-JSON notes — no upload path, notes carry no files.
    createNote: (plantId: string, body: string) =>
      api<{ noteId: string }>(`/plants/${plantId}/notes`, { method: 'POST', body: { body } }),
    updateNote: (plantId: string, noteId: string, body: string) =>
      api<{ noteId: string }>(`/plants/${plantId}/notes/${noteId}`, { method: 'PATCH', body: { body } }),
    deleteNote: (plantId: string, noteId: string) =>
      api<void>(`/plants/${plantId}/notes/${noteId}`, { method: 'DELETE' }),

    simulateMove: (latitude: number, longitude: number) =>
      api<PlantViability[]>('/moving/simulate', { method: 'POST', body: { latitude, longitude } }),
    scheduleMove: (sel: { name: string; latitude: number; longitude: number; timezone: string }, moveOn: string) =>
      api<{ id: string }>('/moving/schedule', { method: 'POST', body: { ...sel, moveOn } }),

    // Admin knowledge-engine chat (all admin-gated on the API via RolesGuard).
    listKnowledgeSessions: () => api<KnowledgeChatSessionSummary[]>('/knowledge-chat/sessions'),
    // The agent is chosen at CREATION and owned by the conversation from then on — resume never carries
    // one (the API reads it off the session row).
    // `input` is a prompt (optionally carrying attachments) — a command can never OPEN a conversation, but
    // it is typed with the same union as `resume` for consistency; `sendChat` routes an attachment-carrying
    // body through the watchdogged XHR path automatically.
    createKnowledgeSession: (input: KnowledgeChatSendInput, provider: KnowledgeChatProvider) =>
      sendChat<CreateKnowledgeSessionResponse>('/knowledge-chat/sessions', { ...input, provider }),
    getKnowledgeSession: (id: string) =>
      api<KnowledgeChatSessionDetail>(`/knowledge-chat/sessions/${id}`),
    // The conversation's transcript as CANONICAL AgentEvents, ready to seed straight into the chat. The
    // browser never parses raw agent output any more — the engine owns that translation.
    getKnowledgeSessionHistory: (id: string) =>
      api<KnowledgeChatHistory>(`/knowledge-chat/sessions/${id}/history`),
    // `provider` is honored ONLY when the conversation never established an agent session (its opening turn
    // is being retried, possibly on the other agent). Once a session exists the server ignores it and uses
    // the conversation's own agent.
    //
    // `input` is a prompt OR a command — never both. A command is an instruction to the agent's runtime, and
    // it has its own field at every hop precisely so no host can accidentally bury it inside a prompt string.
    resumeKnowledgeSession: (id: string, input: KnowledgeChatSendInput, provider?: KnowledgeChatProvider) =>
      sendChat<ResumeKnowledgeRunResponse>(`/knowledge-chat/sessions/${id}/runs`, { ...input, provider }),
    deleteKnowledgeSession: (id: string) =>
      api<{ ok: true }>(`/knowledge-chat/sessions/${id}`, { method: 'DELETE' }),
    // Per-agent availability, proxied by our API behind its own admin auth (the browser never touches the
    // engine's control plane). Drives the agent picker: only an available agent is selectable.
    listKnowledgeProviders: (force = false) =>
      api<AgentProviderStatus[]>(`/knowledge-chat/provider-status${force ? '?force=1' : ''}`),
    mintKnowledgeSocketTicket: (runId: string) =>
      api<KnowledgeSocketTicketResponse>(`/knowledge-chat/runs/${runId}/socket-ticket`, { method: 'POST' }),
    // The agent's command catalog — what the composer's `/` autocomplete lists. Proxied by our API behind
    // its own admin auth; the package never fetches it itself.
    getKnowledgeCommands: (provider: KnowledgeChatProvider) =>
      api<CommandCatalog>(`/knowledge-chat/commands?provider=${provider}`),

    // --- Plant Doctor chat (owner-scoped; API enforces plant ownership, 404 otherwise). Same response
    //     shapes as the knowledge-chat endpoints — the API reuses KnowledgeChatService. ---
    listDoctorSessions: (plantId: string) =>
      api<KnowledgeChatSessionSummary[]>(`/plants/${plantId}/diagnose/sessions`),
    createDoctorSession: (plantId: string, input: KnowledgeChatSendInput, provider: KnowledgeChatProvider) =>
      sendChat<CreateKnowledgeSessionResponse>(`/plants/${plantId}/diagnose/sessions`, { ...input, provider }),
    getDoctorSession: (plantId: string, id: string) =>
      api<KnowledgeChatSessionDetail>(`/plants/${plantId}/diagnose/sessions/${id}`),
    getDoctorSessionHistory: (plantId: string, id: string) =>
      api<KnowledgeChatHistory>(`/plants/${plantId}/diagnose/sessions/${id}/history`),
    resumeDoctorSession: (plantId: string, id: string, input: KnowledgeChatSendInput, provider?: KnowledgeChatProvider) =>
      sendChat<ResumeKnowledgeRunResponse>(`/plants/${plantId}/diagnose/sessions/${id}/runs`, { ...input, provider }),
    deleteDoctorSession: (plantId: string, id: string) =>
      api<{ ok: true }>(`/plants/${plantId}/diagnose/sessions/${id}`, { method: 'DELETE' }),
    listDoctorProviders: (plantId: string, force = false) =>
      api<AgentProviderStatus[]>(`/plants/${plantId}/diagnose/provider-status${force ? '?force=1' : ''}`),
    getDoctorCommands: (plantId: string, provider: KnowledgeChatProvider) =>
      api<CommandCatalog>(`/plants/${plantId}/diagnose/commands?provider=${provider}`),
    mintDoctorSocketTicket: (plantId: string, runId: string) =>
      api<KnowledgeSocketTicketResponse>(`/plants/${plantId}/diagnose/runs/${runId}/socket-ticket`, { method: 'POST' }),

    // --- Plant Doctor write proposals (spec 2026-07-18 §5.5.1) ---
    // The doctor agent has NO write access: it files a proposal and the owner resolves it here. All five
    // routes are effective-owner routes (the owner's own session, or an ADMIN acting-as them) — a
    // doctor-scoped token gets a 403, and a proposal from another plant/owner is a 404, never a 403.
    //
    // The response is typed `unknown` ON PURPOSE. "Nothing is pending" is a 200 with an empty body, which
    // ofetch delivers as the empty STRING — so `AgentProposal | null` would be a type the wire does not
    // honour, and every consumer would inherit the trap. `normalizePendingProposal` collapses it here,
    // once, and the honest `AgentProposal | null` starts at this boundary.
    getDoctorPendingProposal: async (plantId: string, sessionId: string) =>
      normalizePendingProposal(
        await api<unknown>(`/plants/${plantId}/diagnose/sessions/${sessionId}/proposals/pending`),
      ),
    // Approve and decline take an EMPTY body by contract — a non-empty body is a 400. So no `body` key.
    // A 409 means the proposal is no longer PENDING (expired by a newer turn, or already resolved), and
    // the terminal status travels in the error payload so the UI can explain WHICH happened.
    //
    // code review AF-12 — `idempotencyKey` is a STABLE key, minted ONCE per (session, proposal) at the
    // submit boundary (AgentChat.vue's `approveProposal`) and reused across retries — same discipline as
    // `completeRepot` above, never `api()`'s own per-call auto-mint (which would defeat the retry: a lost
    // approve response could never replay the stored 201, including its outcome).
    approveDoctorProposal: (plantId: string, sessionId: string, proposalId: string, idempotencyKey: string) =>
      api<AgentProposal>(`/plants/${plantId}/diagnose/sessions/${sessionId}/proposals/${proposalId}/approve`, {
        method: 'POST',
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      }),
    declineDoctorProposal: (plantId: string, sessionId: string, proposalId: string) =>
      api<AgentProposal>(`/plants/${plantId}/diagnose/sessions/${sessionId}/proposals/${proposalId}/decline`, { method: 'POST' }),
    // Dangerously Skip Permissions, persisted PER SESSION. Owner-writable only.
    getDoctorSessionSettings: (plantId: string, sessionId: string) =>
      api<DoctorSessionSettings>(`/plants/${plantId}/diagnose/sessions/${sessionId}/settings`),
    updateDoctorSessionSettings: (plantId: string, sessionId: string, skipPermissions: boolean) =>
      api<DoctorSessionSettings>(`/plants/${plantId}/diagnose/sessions/${sessionId}/settings`, {
        method: 'PATCH',
        body: { skipPermissions },
      }),
    // Raw NDJSON transcript. The endpoint returns text/plain; ofetch yields the string as-is.

    // --- Gardener (owner-scoped, garden-wide chat). Same response shapes as the knowledge-chat/doctor
    //     endpoints — the API reuses KnowledgeChatService for this session kind too. Unlike EVERY doctor
    //     call above, none of these close over a plantId: the gardener is scoped to the owner's whole
    //     garden, not to one plant. ---
    listGardenerSessions: () => api<KnowledgeChatSessionSummary[]>('/gardener/sessions'),
    createGardenerSession: (input: KnowledgeChatSendInput, provider: KnowledgeChatProvider) =>
      sendChat<CreateKnowledgeSessionResponse>('/gardener/sessions', { ...input, provider }),
    getGardenerSession: (id: string) => api<KnowledgeChatSessionDetail>(`/gardener/sessions/${id}`),
    getGardenerSessionHistory: (id: string) =>
      api<KnowledgeChatHistory>(`/gardener/sessions/${id}/history`),
    resumeGardenerSession: (id: string, input: KnowledgeChatSendInput, provider?: KnowledgeChatProvider) =>
      sendChat<ResumeKnowledgeRunResponse>(`/gardener/sessions/${id}/runs`, { ...input, provider }),
    deleteGardenerSession: (id: string) =>
      api<{ ok: true }>(`/gardener/sessions/${id}`, { method: 'DELETE' }),
    listGardenerProviders: (force = false) =>
      api<AgentProviderStatus[]>(`/gardener/provider-status${force ? '?force=1' : ''}`),
    getGardenerCommands: (provider: KnowledgeChatProvider) =>
      api<CommandCatalog>(`/gardener/commands?provider=${provider}`),
    mintGardenerSocketTicket: (runId: string) =>
      api<KnowledgeSocketTicketResponse>(`/gardener/runs/${runId}/socket-ticket`, { method: 'POST' }),

    // --- Gardener write proposals (same contract as the Plant Doctor's, generalized: spec 2026-07-18
    //     §5.5.1). The gardener has NO write access either — it files a proposal and the owner resolves it
    //     here. The client below implements FIVE of the surface's six routes — pending/approve/decline/
    //     get-settings/update-settings; the sixth, `POST …/proposals` (spec `2026-07-20-gardener-agent-
    //     design.md:286`), is gardener-TOKEN only (the agent files the proposal) and the browser never
    //     calls it. A proposal from another owner is a 404, never a 403.
    //
    // Reuses the doctor's `normalizePendingProposal` rather than re-deriving the coercion: the empty-body
    // quirk it collapses is the ENGINE's ("nothing pending" = 200 with an empty body = ofetch's `''`, not
    // `null`), not something specific to the doctor scope, so the gardener endpoint hits the exact same
    // trap. See utils/doctorProposal.ts for why `AgentProposal | null` would be a lie about the wire here.
    getGardenerPendingProposal: async (sessionId: string) =>
      normalizePendingProposal(
        await api<unknown>(`/gardener/sessions/${sessionId}/proposals/pending`),
      ),
    // Approve and decline take an EMPTY body by contract — a non-empty body is a 400. So no `body` key.
    // A 409 means the proposal is no longer PENDING (expired by a newer turn, or already resolved), and
    // the terminal status travels in the error payload so the UI can explain WHICH happened — same
    // behaviour as the doctor's equivalent call, since both go through the same generic `api()` wrapper.
    //
    // code review AF-12 — same stable-key discipline as `approveDoctorProposal` above: see its comment.
    approveGardenerProposal: (sessionId: string, proposalId: string, idempotencyKey: string) =>
      api<AgentProposal>(`/gardener/sessions/${sessionId}/proposals/${proposalId}/approve`, {
        method: 'POST',
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      }),
    declineGardenerProposal: (sessionId: string, proposalId: string) =>
      api<AgentProposal>(`/gardener/sessions/${sessionId}/proposals/${proposalId}/decline`, { method: 'POST' }),
    // Dangerously Skip Permissions, persisted PER SESSION. Owner-writable only.
    getGardenerSessionSettings: (sessionId: string) =>
      api<DoctorSessionSettings>(`/gardener/sessions/${sessionId}/settings`),
    updateGardenerSessionSettings: (sessionId: string, skipPermissions: boolean) =>
      api<DoctorSessionSettings>(`/gardener/sessions/${sessionId}/settings`, {
        method: 'PATCH',
        body: { skipPermissions },
      }),

    listOwners: () => api<OwnerSummary[]>('/owners'),
    actAs: (ownerId: string) =>
      $fetch<{ actingAs: { ownerId: string; label: string } }>('/api/acting-as', { method: 'POST', body: { ownerId } }),
    stopActingAs: () =>
      $fetch<{ actingAs: null }>('/api/acting-as', { method: 'DELETE' }),
  };
}
