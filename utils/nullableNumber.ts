// Bridge between a number input and a `number | null` DTO field.
//
// `v-model.number` yields the empty string '' (not undefined) when the user clears a typed value, so
// anything that is not a finite number must become `null` — otherwise '' reaches the DTO and 400s.
// Shared by the place create form and the place edit modal so the two can never disagree.
export const toNullableNumber = (v: number | string): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
