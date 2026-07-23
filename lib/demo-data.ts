import type { AirAggregate, AirSample, Coordinate } from "./types";

export const DEMO_MEASURED_AT = "2026-01-01T00:00:00Z";

const deterministicValue = (coordinate: Coordinate, salt: number) => {
  const seed = Math.sin(
    (coordinate.latitude + 90) * 12.9898 +
      (coordinate.longitude + 180) * 78.233 +
      salt,
  );

  return seed - Math.floor(seed);
};

/**
 * Returns stable modelled estimates for the visual demo, never station data.
 */
export const demoSampleFor = (coordinate: Coordinate): AirSample => {
  const aqi = Math.round(30 + deterministicValue(coordinate, 1) * 110);

  return {
    aqi,
    pm25: Math.round(6 + deterministicValue(coordinate, 2) * 34),
    pm10: Math.round(12 + deterministicValue(coordinate, 3) * 48),
    no2: Math.round(4 + deterministicValue(coordinate, 4) * 24),
    o3: Math.round(20 + deterministicValue(coordinate, 5) * 46),
  };
};

export const demoAggregateFor = (coordinates: Coordinate[]): AirAggregate => {
  const samples = coordinates.map(demoSampleFor);
  const total = samples.reduce<AirSample>(
    (sum, sample) => ({
      aqi: sum.aqi + sample.aqi,
      pm25: sum.pm25 + sample.pm25,
      pm10: sum.pm10 + sample.pm10,
      no2: sum.no2 + sample.no2,
      o3: sum.o3 + sample.o3,
    }),
    { aqi: 0, pm25: 0, pm10: 0, no2: 0, o3: 0 },
  );

  return {
    aqi: total.aqi / samples.length,
    pm25: total.pm25 / samples.length,
    pm10: total.pm10 / samples.length,
    no2: total.no2 / samples.length,
    o3: total.o3 / samples.length,
    sampleCount: samples.length,
    measuredAt: DEMO_MEASURED_AT,
    mode: "demo",
  };
};
