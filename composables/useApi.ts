import type {
  City, CitySearchResult, CreateCity, CreatePlace, CreatePlant, DueTaskResponse, Feedback, HistoryItem,
  OwnerSummary, Place, Plant, PlantCare, PlantViability, ProgressEntryDetail, ProgressTag, SpeciesBrief,
  SpeciesSummary, UpdatePlace, UpdatePlant, Viability,
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
    getSpeciesBrief: (slug: string) => api<SpeciesBrief>(`/species/${slug}/brief`),

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

    listOwners: () => api<OwnerSummary[]>('/owners'),
    actAs: (ownerId: string) =>
      $fetch<{ actingAs: { ownerId: string; label: string } }>('/api/acting-as', { method: 'POST', body: { ownerId } }),
    stopActingAs: () =>
      $fetch<{ actingAs: null }>('/api/acting-as', { method: 'DELETE' }),
  };
}
