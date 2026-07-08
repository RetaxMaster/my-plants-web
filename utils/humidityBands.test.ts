import { describe, expect, it } from 'vitest';
import { HUMIDITY_BAND_DRY_MAX, HUMIDITY_BAND_HUMID_MIN } from './humidityBands';

describe('humidity bands mirror the care engine', () => {
  it('matches indoor-climate.ts humidityBand thresholds', () => {
    // Contract: my-plants-api/src/engines/indoor-climate.ts `humidityBand`:
    //   humidityPct < 42 → DRY ; humidityPct > 58 → HUMID ; otherwise NORMAL.
    // If those thresholds change in the engine, update humidityBands.ts (and this test) together.
    expect(HUMIDITY_BAND_DRY_MAX).toBe(42);
    expect(HUMIDITY_BAND_HUMID_MIN).toBe(58);
  });
});
