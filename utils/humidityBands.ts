// The Place form's humidity option copy ("Dry (0–42%)", "Normal (42–58%)", "Humid (58–100%)") is
// generated from THESE two boundaries so the three labels can never disagree with one another. They
// mirror the deterministic care engine's humidity bands in
// my-plants-api/src/engines/indoor-climate.ts (`humidityBand`): humidityPct < 42 → DRY, > 58 → HUMID.
// This is the ONE place to change if the engine's thresholds ever move (guarded by humidityBands.test.ts).
export const HUMIDITY_BAND_DRY_MAX = 42; // humidityPct < 42 → DRY
export const HUMIDITY_BAND_HUMID_MIN = 58; // humidityPct > 58 → HUMID
