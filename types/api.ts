import type { TaskCode } from '../utils/tasks.js';

export type ViabilityLevel = 'good' | 'caution' | 'poor';

export interface SpeciesSummary { slug: string; scientificName: string }

export interface City {
  id: string; name: string; latitude: number; longitude: number; timezone: string; isPrimary: boolean;
}
export interface CreateCity {
  name: string; latitude: number; longitude: number; timezone: string; isPrimary?: boolean;
}

export type LightType = 'DIRECT' | 'BRIGHT_INDIRECT' | 'MEDIUM' | 'LOW';
export type HumidityCharacter = 'DRY' | 'NORMAL' | 'HUMID';

export interface Place {
  id: string; cityId: string; name: string; indoor: boolean; lightType: LightType;
  climateControlled: boolean; humidityCharacter: HumidityCharacter;
  indoorTempMinC: number | null; indoorTempMaxC: number | null;
}
export interface CreatePlace {
  cityId: string; name: string; indoor: boolean; lightType: LightType;
  climateControlled?: boolean; humidityCharacter?: HumidityCharacter;
  indoorTempMinC?: number | null; indoorTempMaxC?: number | null;
}

export interface Plant {
  id: string; placeId: string; speciesSlug: string; nickname: string | null; acquiredOn: string;
}
export interface CreatePlant {
  placeId: string; speciesSlug: string; nickname?: string; acquiredOn: string;
  lastDone?: { task: TaskCode; doneOn: string }[];
}

export interface DueTaskResponse { plantId: string; task: TaskCode; nextDueOn: string }

export type FeedbackType = 'DONE' | 'POSTPONED' | 'SYMPTOM';
export interface Feedback {
  task: TaskCode; type: FeedbackType; occurredOn: string;
  postponeToOn?: string; payload?: Record<string, unknown>;
}

export interface PlantViability { plantId: string; nickname: string | null; level: ViabilityLevel; reasons: string[] }
