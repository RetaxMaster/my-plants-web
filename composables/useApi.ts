import type {
  City, CitySearchResult, CreateCity, CreatePlace, CreatePlant, DueTaskResponse, Feedback, Place, Plant,
  PlantCare, PlantViability, SpeciesSummary,
} from '../types/api.js';

export function useApi() {
  const base = useRuntimeConfig().public.apiBase;
  const api = <T>(path: string, opts?: Parameters<typeof $fetch>[1]) =>
    $fetch<T>(`${base}${path}`, opts);

  return {
    listSpecies: () => api<SpeciesSummary[]>('/species'),

    listCities: () => api<City[]>('/cities'),
    createCity: (body: CreateCity) => api<City>('/cities', { method: 'POST', body }),
    makePrimaryCity: (id: string) => api<City>(`/cities/${id}/make-primary`, { method: 'POST' }),
    searchCities: (q: string) =>
      api<CitySearchResult[]>(`/cities/search?q=${encodeURIComponent(q)}`),

    listPlaces: () => api<Place[]>('/places'),
    createPlace: (body: CreatePlace) => api<Place>('/places', { method: 'POST', body }),

    listPlants: () => api<Plant[]>('/plants'),
    getPlant: (id: string) => api<Plant>(`/plants/${id}`),
    getPlantCare: (id: string) => api<PlantCare>(`/plants/${id}/care`),
    createPlant: (body: CreatePlant) => api<Plant>('/plants', { method: 'POST', body }),

    todaysTasks: () => api<DueTaskResponse[]>('/care-plan/today'),
    recompute: () => api<{ ok: true }>('/care-plan/recompute', { method: 'POST' }),

    sendFeedback: (plantId: string, body: Feedback) =>
      api<{ ok: true }>(`/plants/${plantId}/feedback`, { method: 'POST', body }),

    simulateMove: (latitude: number, longitude: number) =>
      api<PlantViability[]>('/moving/simulate', { method: 'POST', body: { latitude, longitude } }),
    scheduleMove: (sel: { name: string; latitude: number; longitude: number; timezone: string }, moveOn: string) =>
      api<{ id: string }>('/moving/schedule', { method: 'POST', body: { ...sel, moveOn } }),
  };
}
