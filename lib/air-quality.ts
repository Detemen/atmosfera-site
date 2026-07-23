import { demoAggregateFor } from "./demo-data";
import type {
  AirAggregate,
  AirSample,
  AqiCategory,
  Coordinate,
} from "./types";

export type { AirAggregate, AirSample, AqiCategory, Coordinate, DataMode } from "./types";

type SampleAverage = AirSample & { sampleCount: number };
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type OpenMeteoEntry = {
  current?: {
    time?: string;
    us_aqi?: number;
    pm2_5?: number;
    pm10?: number;
    nitrogen_dioxide?: number;
    ozone?: number;
  };
};
type CacheEntry = { aggregate: AirAggregate; cachedAt: number };

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

const categories: Array<AqiCategory & { maximum: number }> = [
  { maximum: 50, label: "Добре", color: "#a7ef5a" },
  { maximum: 100, label: "Помірно", color: "#f2cf5b" },
  {
    maximum: 150,
    label: "Шкідливо для чутливих груп",
    color: "#f29a4a",
  },
  { maximum: 200, label: "Шкідливо", color: "#ee695e" },
  { maximum: 300, label: "Дуже шкідливо", color: "#c05ad8" },
  { maximum: Infinity, label: "Небезпечно", color: "#8f2f4f" },
];

export const aqiCategory = (value: number): AqiCategory =>
  categories.find(({ maximum }) => value <= maximum) ?? categories.at(-1)!;

export const averageSamples = (samples: AirSample[]): SampleAverage => {
  if (samples.length === 0) {
    throw new Error("At least one air-quality sample is required");
  }

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
  };
};

const cacheKeyFor = (points: Coordinate[]) =>
  points
    .map(
      ({ latitude, longitude }) =>
        `${latitude.toFixed(4)},${longitude.toFixed(4)}`,
    )
    .join("|");

const requestUrlFor = (points: Coordinate[]) => {
  const query = new URLSearchParams({
    latitude: points.map(({ latitude }) => latitude).join(","),
    longitude: points.map(({ longitude }) => longitude).join(","),
    current: "us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone",
    timezone: "GMT",
  });

  return `https://air-quality-api.open-meteo.com/v1/air-quality?${query}`;
};

const normalizeEntries = (payload: OpenMeteoEntry | OpenMeteoEntry[]) =>
  Array.isArray(payload) ? payload : [payload];

const normalizeUtcTimestamp = (timestamp: string) =>
  /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`;

const sampleFrom = (entry: OpenMeteoEntry): AirSample => {
  const current = entry.current;
  if (
    !current ||
    typeof current.us_aqi !== "number" ||
    typeof current.pm2_5 !== "number" ||
    typeof current.pm10 !== "number" ||
    typeof current.nitrogen_dioxide !== "number" ||
    typeof current.ozone !== "number"
  ) {
    throw new Error("Open-Meteo response is missing current air-quality values");
  }

  return {
    aqi: current.us_aqi,
    pm25: current.pm2_5,
    pm10: current.pm10,
    no2: current.nitrogen_dioxide,
    o3: current.ozone,
  };
};

const aggregateLiveEntries = (payload: OpenMeteoEntry | OpenMeteoEntry[]) => {
  const entries = normalizeEntries(payload);
  const measuredAt = entries.at(-1)?.current?.time;
  if (!measuredAt) {
    throw new Error("Open-Meteo response is missing its current timestamp");
  }

  return {
    ...averageSamples(entries.map(sampleFrom)),
    measuredAt: normalizeUtcTimestamp(measuredAt),
    mode: "live" as const,
  };
};

export const fetchAirQuality = async (
  points: Coordinate[],
  fetcher: Fetcher = globalThis.fetch,
): Promise<AirAggregate> => {
  if (points.length === 0) {
    throw new Error("At least one coordinate is required");
  }

  const key = cacheKeyFor(points);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.aggregate;
  }

  try {
    const response = await fetcher(requestUrlFor(points));
    if (!response.ok) {
      throw new Error(`Open-Meteo request failed with status ${response.status}`);
    }

    const aggregate = aggregateLiveEntries(await response.json());
    cache.set(key, { aggregate, cachedAt: Date.now() });
    return aggregate;
  } catch {
    if (cached) {
      return { ...cached.aggregate, mode: "cached" };
    }

    return demoAggregateFor(points);
  }
};
