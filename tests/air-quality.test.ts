import { describe, expect, it, vi } from "vitest";

import {
  aqiCategory,
  averageSamples,
  fetchAirQuality,
} from "../lib/air-quality";

const response = (entries: unknown) =>
  ({
    ok: true,
    json: async () => entries,
  }) as Response;

const liveEntry = (overrides: Record<string, unknown> = {}) => ({
  current: {
    time: "2026-07-22T12:00",
    us_aqi: 42,
    pm2_5: 12,
    pm10: 18,
    nitrogen_dioxide: 9,
    ozone: 31,
    ...overrides,
  },
});

describe("air-quality domain", () => {
  it("maps AQI values to Ukrainian categories", () => {
    expect(aqiCategory(42).label).toBe("Добре");
    expect(aqiCategory(132).label).toBe("Шкідливо для чутливих груп");
  });

  it("averages air samples", () => {
    expect(
      averageSamples([
        { aqi: 40, pm25: 10, pm10: 20, no2: 8, o3: 30 },
        { aqi: 60, pm25: 20, pm10: 40, no2: 12, o3: 50 },
      ]),
    ).toMatchObject({
      aqi: 50,
      pm25: 15,
      pm10: 30,
      no2: 10,
      o3: 40,
      sampleCount: 2,
    });
  });

  it("normalizes a successful multi-coordinate Open-Meteo response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response([
        liveEntry(),
        liveEntry({
          us_aqi: 58,
          pm2_5: 18,
          pm10: 22,
          nitrogen_dioxide: 11,
          ozone: 39,
          time: "2026-07-22T12:15",
        }),
      ]),
    );

    const aggregate = await fetchAirQuality(
      [
        { latitude: 50.45, longitude: 30.52 },
        { latitude: 48.46, longitude: 35.05 },
      ],
      fetcher,
    );

    expect(aggregate).toMatchObject({
      aqi: 50,
      pm25: 15,
      pm10: 20,
      no2: 10,
      o3: 35,
      sampleCount: 2,
      measuredAt: "2026-07-22T12:15Z",
      mode: "live",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain("latitude=50.45%2C48.46");
    expect(String(fetcher.mock.calls[0][0])).toContain("longitude=30.52%2C35.05");
    expect(String(fetcher.mock.calls[0][0])).toContain("timezone=GMT");
  });

  it("normalizes a successful single-coordinate Open-Meteo response object", async () => {
    const aggregate = await fetchAirQuality(
      [{ latitude: 46.4825, longitude: 30.7233 }],
      vi.fn().mockResolvedValue(
        response(
          liveEntry({
            us_aqi: 73,
            pm2_5: 21,
            pm10: 37,
            nitrogen_dioxide: 14,
            ozone: 46,
            time: "2026-07-22T12:30",
          }),
        ),
      ),
    );

    expect(aggregate).toMatchObject({
      aqi: 73,
      pm25: 21,
      pm10: 37,
      no2: 14,
      o3: 46,
      sampleCount: 1,
      measuredAt: "2026-07-22T12:30Z",
      mode: "live",
    });
  });

  it("reuses a fresh cache entry", async () => {
    const points = [{ latitude: 40.7128, longitude: -74.006 }];
    const firstFetcher = vi.fn().mockResolvedValue(response(liveEntry()));
    const secondFetcher = vi.fn().mockRejectedValue(new Error("offline"));

    await fetchAirQuality(points, firstFetcher);
    const aggregate = await fetchAirQuality(points, secondFetcher);

    expect(aggregate.mode).toBe("live");
    expect(secondFetcher).not.toHaveBeenCalled();
  });

  it("returns stale cache after a request failure", async () => {
    vi.useFakeTimers();
    try {
      const points = [{ latitude: -33.8688, longitude: 151.2093 }];
      const firstFetcher = vi.fn().mockResolvedValue(response(liveEntry()));
      const failedFetcher = vi.fn().mockRejectedValue(new Error("offline"));

      await fetchAirQuality(points, firstFetcher);
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      const aggregate = await fetchAirQuality(points, failedFetcher);

      expect(aggregate.mode).toBe("cached");
      expect(failedFetcher).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns deterministic demo values when a request fails without a cache", async () => {
    const aggregate = await fetchAirQuality(
      [
        { latitude: 1.2345, longitude: 2.3456 },
        { latitude: 3.4567, longitude: 4.5678 },
      ],
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    expect(aggregate.mode).toBe("demo");
    expect(aggregate.sampleCount).toBe(2);
  });

  it("returns deterministic demo data for a malformed Open-Meteo payload", async () => {
    const points = [{ latitude: 59.9343, longitude: 30.3351 }];
    const malformedFetcher = () =>
      Promise.resolve(response({ current: { time: "2026-07-22T12:00" } }));

    const first = await fetchAirQuality(points, malformedFetcher);
    const second = await fetchAirQuality(points, malformedFetcher);

    expect(first).toMatchObject({ mode: "demo", sampleCount: 1 });
    expect(second).toEqual(first);
  });
});
