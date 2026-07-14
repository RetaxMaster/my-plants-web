import type { AgentProviderStatus } from '@retaxmaster/agents-realtime-protocol';
import type {
  City, CitySearchResult, CommandCatalog, CreateCity, CreateKnowledgeSessionResponse, CreatePlace, CreatePlant,
  DueTaskResponse, Feedback, HistoryItem, KnowledgeChatSendInput, KnowledgeChatSessionDetail, KnowledgeChatSessionSummary,
  KnowledgeSocketTicketResponse, OwnerSummary, Place, Plant, PlantCare, PlantViability,
  KnowledgeChatHistory, KnowledgeChatProvider, ProgressEntryDetail, ProgressTag, ResumeKnowledgeRunResponse, SpeciesSummary,
  UpdatePlace, UpdatePlant, Viability,
  PlantDetail, PlantProfile, PlantProfileUpdate, PlantPhotoItem,
  BlogPage, BlogpostCard, BlogpostDetail, BlogpostAdminDetail, BlogpostAdminRow,
  MediaAssetView, CreateBlogpost, UpdateBlogpost,
} from '../types/api.js';

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
  const { t } = useI18n();

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
    try {
      return await fetcher<T>(`/api${path}`, opts as any);
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
    opts: { method?: 'POST' | 'PUT'; onProgress?: (percent: number) => void } = {},
  ): Promise<T> => {
    const rejection = checkUploadLimits(form);
    if (rejection) throw makeUploadError(rejection.code, t(`upload.${rejection.code}`, rejection.params));
    try {
      return await uploadFormData<T>(`/api${path}`, form, opts);
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

  return {
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

    listPlants: () => api<Plant[]>('/plants'),
    getPlant: (id: string) => api<PlantDetail>(`/plants/${id}`),
    setCoverPhoto: (id: string, file: File) => {
      const form = new FormData();
      form.append('photo', file);
      return upload<PlantDetail>(`/plants/${id}/cover-photo`, form, { method: 'PUT' });
    },
    deleteCoverPhoto: (id: string) =>
      api<PlantDetail>(`/plants/${id}/cover-photo`, { method: 'DELETE' }),
    getPlantProfile: (id: string) => api<PlantProfile>(`/plants/${id}/profile`),
    updatePlantProfile: (id: string, patch: PlantProfileUpdate) =>
      api<PlantProfile>(`/plants/${id}/profile`, { method: 'PATCH', body: patch }),
    getPlantPhotos: (id: string) => api<PlantPhotoItem[]>(`/plants/${id}/photos`),
    getPlantCare: (id: string) => api<PlantCare>(`/plants/${id}/care`),
    createPlant: (body: CreatePlant) => api<Plant>('/plants', { method: 'POST', body }),
    updatePlant: (id: string, body: UpdatePlant) => api<Plant>(`/plants/${id}`, { method: 'PATCH', body }),
    previewPlantViability: (id: string, placeId: string) =>
      api<Viability>(`/plants/${id}/viability-preview?placeId=${encodeURIComponent(placeId)}`),

    todaysTasks: () => api<DueTaskResponse[]>('/care-plan/today'),
    recompute: () => api<{ ok: true }>('/care-plan/recompute', { method: 'POST' }),

    sendFeedback: (plantId: string, body: Feedback) =>
      api<{ ok: true }>(`/plants/${plantId}/feedback`, { method: 'POST', body }),

    // Care History
    getProgressCatalog: () => api<ProgressTag[]>('/progress/catalog'),
    // The heaviest upload in the app: up to 8 raw camera photos in one request. onProgress drives a real
    // percentage on the save button so a slow phone upload never LOOKS like a frozen one.
    logProgress: (plantId: string, form: FormData, onProgress?: (percent: number) => void) =>
      upload<ProgressEntryDetail>(`/plants/${plantId}/progress`, form, { onProgress }),
    getProgressEntry: (plantId: string, entryId: string) =>
      api<ProgressEntryDetail>(`/plants/${plantId}/progress/${entryId}`),
    getPlantHistory: (plantId: string) => api<HistoryItem[]>(`/plants/${plantId}/history`),

    simulateMove: (latitude: number, longitude: number) =>
      api<PlantViability[]>('/moving/simulate', { method: 'POST', body: { latitude, longitude } }),
    scheduleMove: (sel: { name: string; latitude: number; longitude: number; timezone: string }, moveOn: string) =>
      api<{ id: string }>('/moving/schedule', { method: 'POST', body: { ...sel, moveOn } }),

    // Admin knowledge-engine chat (all admin-gated on the API via RolesGuard).
    listKnowledgeSessions: () => api<KnowledgeChatSessionSummary[]>('/knowledge-chat/sessions'),
    // The agent is chosen at CREATION and owned by the conversation from then on — resume never carries
    // one (the API reads it off the session row).
    createKnowledgeSession: (prompt: string, provider: KnowledgeChatProvider) =>
      api<CreateKnowledgeSessionResponse>('/knowledge-chat/sessions', { method: 'POST', body: { prompt, provider } }),
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
      api<ResumeKnowledgeRunResponse>(`/knowledge-chat/sessions/${id}/runs`, {
        method: 'POST',
        body: { ...input, provider },
      }),
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
    // Raw NDJSON transcript. The endpoint returns text/plain; ofetch yields the string as-is.

    listOwners: () => api<OwnerSummary[]>('/owners'),
    actAs: (ownerId: string) =>
      $fetch<{ actingAs: { ownerId: string; label: string } }>('/api/acting-as', { method: 'POST', body: { ownerId } }),
    stopActingAs: () =>
      $fetch<{ actingAs: null }>('/api/acting-as', { method: 'DELETE' }),
  };
}
