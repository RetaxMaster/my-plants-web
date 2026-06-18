import type {
  City, CreateCity, CreatePlace, CreatePlant, DueTaskResponse, Feedback, Place, Plant,
  PlantViability, SpeciesSummary,
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

    listPlaces: () => api<Place[]>('/places'),
    createPlace: (body: CreatePlace) => api<Place>('/places', { method: 'POST', body }),

    listPlants: () => api<Plant[]>('/plants'),
    getPlant: (id: string) => api<Plant>(`/plants/${id}`),
    createPlant: (body: CreatePlant) => api<Plant>('/plants', { method: 'POST', body }),

    todaysTasks: () => api<DueTaskResponse[]>('/care-plan/today'),
    recompute: () => api<{ ok: true }>('/care-plan/recompute', { method: 'POST' }),

    sendFeedback: (plantId: string, body: Feedback) =>
      api<{ ok: true }>(`/plants/${plantId}/feedback`, { method: 'POST', body }),

    simulateMove: (targetCityId: string) =>
      api<PlantViability[]>('/moving/simulate', { method: 'POST', body: { targetCityId } }),
    scheduleMove: (targetCityId: string, moveOn: string) =>
      api<{ id: string }>('/moving/schedule', { method: 'POST', body: { targetCityId, moveOn } }),
  };
}
