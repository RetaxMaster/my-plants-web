import type {
  City, CitySearchResult, CreateCity, CreateKnowledgeSessionResponse, CreatePlace, CreatePlant,
  DueTaskResponse, Feedback, HistoryItem, KnowledgeChatSessionDetail, KnowledgeChatSessionSummary,
  KnowledgeSocketTicketResponse, OwnerSummary, Place, Plant, PlantCare, PlantViability,
  ProgressEntryDetail, ProgressTag, ResumeKnowledgeRunResponse, SpeciesSummary,
  UpdatePlace, UpdatePlant, Viability,
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
  const api = async <T>(path: string, opts?: Parameters<typeof $fetch>[1]) => {
    try {
      return await fetcher<T>(`/api${path}`, opts as any);
    } catch (e: any) {
      // A mid-session 401 means the bearer was revoked/expired: drop the stale
      // session and bounce to /login. Client-side only, and ONLY when we actually
      // had a session — so a public page (blog) that ever sees a 401 from a public
      // endpoint is never bounced to login for a logged-out visitor.
      if (import.meta.client && session.loggedIn.value && (e?.statusCode === 401 || e?.response?.status === 401)) {
        await session.clear();
        await navigateTo('/login');
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
      api<BlogpostAdminDetail>(`/blogposts/${slug}/cover`, { method: 'POST', body: form }),

    // --- Media library (RolesGuard ADMIN on the API) ---
    uploadMedia: (form: FormData) => api<MediaAssetView>('/media', { method: 'POST', body: form }),
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
    getPlant: (id: string) => api<Plant>(`/plants/${id}`),
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
    logProgress: (plantId: string, form: FormData) =>
      api<ProgressEntryDetail>(`/plants/${plantId}/progress`, { method: 'POST', body: form }),
    getProgressEntry: (plantId: string, entryId: string) =>
      api<ProgressEntryDetail>(`/plants/${plantId}/progress/${entryId}`),
    getPlantHistory: (plantId: string) => api<HistoryItem[]>(`/plants/${plantId}/history`),

    simulateMove: (latitude: number, longitude: number) =>
      api<PlantViability[]>('/moving/simulate', { method: 'POST', body: { latitude, longitude } }),
    scheduleMove: (sel: { name: string; latitude: number; longitude: number; timezone: string }, moveOn: string) =>
      api<{ id: string }>('/moving/schedule', { method: 'POST', body: { ...sel, moveOn } }),

    // Admin knowledge-engine chat (all admin-gated on the API via RolesGuard).
    listKnowledgeSessions: () => api<KnowledgeChatSessionSummary[]>('/knowledge-chat/sessions'),
    createKnowledgeSession: (prompt: string) =>
      api<CreateKnowledgeSessionResponse>('/knowledge-chat/sessions', { method: 'POST', body: { prompt } }),
    getKnowledgeSession: (id: string) =>
      api<KnowledgeChatSessionDetail>(`/knowledge-chat/sessions/${id}`),
    resumeKnowledgeSession: (id: string, prompt: string) =>
      api<ResumeKnowledgeRunResponse>(`/knowledge-chat/sessions/${id}/runs`, { method: 'POST', body: { prompt } }),
    deleteKnowledgeSession: (id: string) =>
      api<{ ok: true }>(`/knowledge-chat/sessions/${id}`, { method: 'DELETE' }),
    mintKnowledgeSocketTicket: (runId: string) =>
      api<KnowledgeSocketTicketResponse>(`/knowledge-chat/runs/${runId}/socket-ticket`, { method: 'POST' }),
    // Raw NDJSON transcript. The endpoint returns text/plain; ofetch yields the string as-is.
    fetchKnowledgeRunLog: (logUrl: string) => api<string>(logUrl),

    listOwners: () => api<OwnerSummary[]>('/owners'),
    actAs: (ownerId: string) =>
      $fetch<{ actingAs: { ownerId: string; label: string } }>('/api/acting-as', { method: 'POST', body: { ownerId } }),
    stopActingAs: () =>
      $fetch<{ actingAs: null }>('/api/acting-as', { method: 'DELETE' }),
  };
}
