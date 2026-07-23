import { readFileSync } from "node:fs";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Home, { reduceSelectionState } from "../src/App";
import {
  AirQualityGlobe,
  globeLiveMessage,
} from "../components/globe/AirQualityGlobe";
import { AirPanel } from "../components/ui/AirPanel";
import { COUNTRY_PROFILES } from "../lib/geography";

const fiberMockState = vi.hoisted(() => ({ showFallback: false }));

const countryTopology = {
  type: "Topology",
  objects: {
    countries: {
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          id: "UA",
          properties: { name: "Ukraine" },
          arcs: [[0]],
        },
      ],
    },
  },
  arcs: [[[-5, -5], [10, 0], [0, 10], [-10, 0], [0, -10]]],
};

const liveAirResponse = (aqi: number) =>
  ({
    ok: true,
    json: async () => ({
      current: {
        time: "2026-07-22T12:00:00Z",
        us_aqi: aqi,
        pm2_5: 12,
        pm10: 18,
        nitrogen_dioxide: 9,
        ozone: 31,
      },
    }),
  }) as Response;

vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    fallback,
    onPointerLeave,
  }: {
    fallback?: ReactNode;
    onPointerLeave?: () => void;
  }) =>
    fiberMockState.showFallback ? fallback : (
      <div data-testid="globe-canvas" onPointerLeave={onPointerLeave} />
    ),
  useFrame: vi.fn(),
  useThree: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  Edges: () => null,
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
}));

afterEach(() => {
  cleanup();
  fiberMockState.showFallback = false;
  vi.unstubAllGlobals();
});

describe("air quality globe shell", () => {
  it("anchors the mobile masthead to the shell instead of the stacked panel flow", () => {
    const { container } = render(<Home />);

    expect(container.querySelector(".air-shell > .air-masthead")).not.toBeNull();
    expect(container.querySelector(".air-panel-layer .air-masthead")).toBeNull();
  });

  it("exposes the interactive globe and its initial progressive level", async () => {
    render(<Home />);

    expect(
      await screen.findByRole("region", { name: "Інтерактивний глобус" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Рівень: континент")).toBeInTheDocument();
    expect(screen.getByTestId("globe-canvas")).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Пошук міста" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Оберіть забруднювач" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Збільшити/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Зменшити/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Закріпити територію" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Open-Meteo.*CAMS/)).toBeInTheDocument();
  });

  it("clears the pinned selection when Escape is pressed", () => {
    const onSelect = vi.fn();
    render(
      <AirQualityGlobe
        selectedSelection={COUNTRY_PROFILES.UA.selection}
        onHover={vi.fn()}
        onSelect={onSelect}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("clears a transient territory hover when the pointer leaves the globe", () => {
    const onHover = vi.fn();
    render(<AirQualityGlobe onHover={onHover} onSelect={vi.fn()} />);

    fireEvent.pointerLeave(screen.getByTestId("globe-canvas"));

    expect(onHover).toHaveBeenCalledWith(null);
  });

  it("offers a retry action when the WebGL fallback is visible", () => {
    fiberMockState.showFallback = true;
    render(<AirQualityGlobe onHover={vi.fn()} onSelect={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Спробувати 3D знову" }),
    ).toBeInTheDocument();
  });

  it("exposes a geography error and retries the failed asset request", async () => {
    const geographyFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => countryTopology });
    vi.stubGlobal("fetch", geographyFetch);
    render(<AirQualityGlobe onHover={vi.fn()} onSelect={vi.fn()} />);

    expect(
      await screen.findByText("Не вдалося завантажити географію."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Повторити завантаження географії" }),
    );

    expect(await screen.findByRole("button", { name: "Україна" }))
      .toBeInTheDocument();
    expect(geographyFetch).toHaveBeenCalledTimes(2);
  });

  it("uses one globe live region and prioritizes context failure over loading", () => {
    render(<AirQualityGlobe onHover={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("завантажується");
    expect(
      globeLiveMessage({ renderReady: false, recoveryStatus: "failed" }),
    ).toContain("недоступне");
    expect(
      globeLiveMessage({ renderReady: false, recoveryStatus: "failed" }),
    ).not.toContain("завантажується");
  });

  it("pins a territory from the visible text list without pointer picking", async () => {
    const onSelect = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => countryTopology,
      }),
    );

    render(<AirQualityGlobe onHover={vi.fn()} onSelect={onSelect} />);

    fireEvent.click(await screen.findByRole("button", { name: "Україна" }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "UA" }),
    );
  });

  it("uses an immediate, constrained renderer for reduced-motion and reduced-data preferences", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("prefers-reduced-motion") || query.includes("prefers-reduced-data"),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    render(<AirQualityGlobe onHover={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Інтерактивний глобус" })).toHaveAttribute(
      "data-motion",
      "reduced",
    );
    expect(screen.getByRole("region", { name: "Інтерактивний глобус" })).toHaveAttribute(
      "data-detail",
      "constrained",
    );
  });

  it("resolves a Ukrainian city search and sends its coordinates to the globe", async () => {
    const onSearchResult = vi.fn();
    const geocodingFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generationtime_ms: 0.21,
        results: [
          {
            id: 703448,
            name: "Київ",
            latitude: 50.45,
            longitude: 30.52,
            elevation: 187,
            feature_code: "PPLC",
            country_code: "UA",
            admin1: "Місто Київ",
            timezone: "Europe/Kyiv",
            population: 2797553,
            country_id: 690791,
            country: "Україна",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", geocodingFetch);

    render(
      <AirPanel
        aggregate={{
          aqi: 42,
          pm25: 12,
          pm10: 18,
          no2: 9,
          o3: 31,
          sampleCount: 1,
          measuredAt: "2026-07-22T12:00",
          mode: "live",
        }}
        selection={null}
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
        onSearchResult={onSearchResult}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Пошук міста" });
    fireEvent.change(search, { target: { value: "Київ" } });
    fireEvent.click(screen.getByRole("button", { name: "Знайти місто" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Київ — Місто Київ, Україна",
      }),
    );

    expect(geocodingFetch).toHaveBeenCalledOnce();
    expect(String(geocodingFetch.mock.calls[0][0])).toContain("language=uk");
    expect(onSearchResult).toHaveBeenCalledWith({
      id: 703448,
      name: "Київ",
      latitude: 50.45,
      longitude: 30.52,
      country: "Україна",
      countryCode: "UA",
      admin1: "Місто Київ",
    });
  });

  it("keeps only named finite WGS84 geocoding results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { id: 1, name: "", latitude: 50, longitude: 30 },
            { id: 2, name: "Північ", latitude: 91, longitude: 30 },
            { id: 3, name: "Схід", latitude: 50, longitude: 181 },
            { id: 4, name: "Невідомо", latitude: "50", longitude: 30 },
            {
              id: 5,
              name: "Київ",
              latitude: 50.45,
              longitude: 30.52,
              country: "Україна",
            },
          ],
        }),
      }),
    );

    render(
      <AirPanel
        aggregate={{
          aqi: 42,
          pm25: 12,
          pm10: 18,
          no2: 9,
          o3: 31,
          sampleCount: 1,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "live",
        }}
        selection={null}
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Пошук міста" }),
      { target: { value: "Київ" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Знайти місто" }));

    const results = await screen.findByRole("list", {
      name: "Результати пошуку міст",
    });
    expect(within(results).getAllByRole("button")).toHaveLength(1);
    expect(
      within(results).getByRole("button", { name: "Київ, Україна" }),
    ).toBeInTheDocument();
  });

  it("clears old place results when a new search starts", async () => {
    const resolvers: Array<(response: unknown) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) =>
            resolvers.push((payload) =>
              resolve({ ok: true, json: async () => payload }),
            ),
          ),
      ),
    );
    render(
      <AirPanel
        aggregate={{
          aqi: 42,
          pm25: 12,
          pm10: 18,
          no2: 9,
          o3: 31,
          sampleCount: 1,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "live",
        }}
        selection={null}
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Пошук міста" });
    fireEvent.change(search, { target: { value: "Київ" } });
    fireEvent.click(screen.getByRole("button", { name: "Знайти місто" }));
    await act(async () => {
      resolvers[0]({
        results: [
          {
            id: 703448,
            name: "Київ",
            latitude: 50.45,
            longitude: 30.52,
            country: "Україна",
          },
        ],
      });
      await Promise.resolve();
    });
    expect(
      screen.getByRole("button", { name: "Київ, Україна" }),
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Львів" } });
    fireEvent.click(screen.getByRole("button", { name: "Знайти місто" }));

    expect(
      screen.queryByRole("button", { name: "Київ, Україна" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Шукаємо місто…")).toBeInTheDocument();
  });

  it("ignores a stale geocoding response that resolves last", async () => {
    const resolvers: Array<(response: unknown) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) =>
            resolvers.push((payload) =>
              resolve({ ok: true, json: async () => payload }),
            ),
          ),
      ),
    );
    render(
      <AirPanel
        aggregate={{
          aqi: 42,
          pm25: 12,
          pm10: 18,
          no2: 9,
          o3: 31,
          sampleCount: 1,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "live",
        }}
        selection={null}
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Пошук міста" });
    fireEvent.change(search, { target: { value: "Київ" } });
    fireEvent.click(screen.getByRole("button", { name: "Знайти місто" }));
    fireEvent.change(search, { target: { value: "Львів" } });
    fireEvent.click(screen.getByRole("button", { name: "Знайти місто" }));

    await act(async () => {
      resolvers[1]({
        results: [
          {
            id: 702550,
            name: "Львів",
            latitude: 49.84,
            longitude: 24.03,
            country: "Україна",
          },
        ],
      });
      await Promise.resolve();
    });
    expect(
      screen.getByRole("button", { name: "Львів, Україна" }),
    ).toBeInTheDocument();

    await act(async () => {
      resolvers[0]({
        results: [
          {
            id: 703448,
            name: "Київ",
            latitude: 50.45,
            longitude: 30.52,
            country: "Україна",
          },
        ],
      });
      await Promise.resolve();
    });

    expect(
      screen.getByRole("button", { name: "Львів, Україна" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Київ, Україна" }),
    ).not.toBeInTheDocument();
  });

  it("explains the spatial estimate, hierarchy, completeness, and data mode", () => {
    const onBreadcrumbSelect = vi.fn();
    render(
      <AirPanel
        aggregate={{
          aqi: 42,
          pm25: 12,
          pm10: 18,
          no2: 9,
          o3: 31,
          sampleCount: 1,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "demo",
        }}
        selection={COUNTRY_PROFILES.UA.selection}
        level="country"
        loading
        pollutant="aqi"
        requestedSampleCount={6}
        onBreadcrumbSelect={onBreadcrumbSelect}
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Демо-дані")).toBeInTheDocument();
    expect(screen.getByText("оновлення…")).toBeInTheDocument();
    expect(screen.getByText("Просторова оцінка")).toBeInTheDocument();
    expect(screen.getByLabelText("Обраний показник якості повітря"))
      .toHaveTextContent("42 AQI · Добре");
    expect(screen.getByText("Повнота вибірки: 1/6")).toBeInTheDocument();
    expect(screen.getByText(/22 лип. 2026/)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Ієрархія території" }))
      .toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Шкала AQI" }))
      .toBeInTheDocument();
    expect(screen.getByText(/модельовані оцінки/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Україна" }));
    expect(onBreadcrumbSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "UA", level: "country" }),
    );
  });

  it("announces demo data and exposes an equivalent text alternative", () => {
    render(
      <AirPanel
        aggregate={{
          aqi: 42,
          pm25: 12,
          pm10: 18,
          no2: 9,
          o3: 31,
          sampleCount: 1,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "demo",
        }}
        selection={COUNTRY_PROFILES.UA.selection}
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "Україна: Демо-дані.",
    );
    expect(
      screen.getByRole("region", { name: "Текстова альтернатива даних" }),
    ).toHaveTextContent("Україна");
    expect(
      screen.getByRole("region", { name: "Текстова альтернатива даних" }),
    ).toHaveTextContent("AQI 42 — Добре");
    expect(
      screen.getByRole("region", { name: "Текстова альтернатива даних" }),
    ).toHaveTextContent("не дані станції");
    expect(
      screen.getByRole("region", { name: "Текстова альтернатива даних" }),
    ).toHaveTextContent("CAMS (~11 км) через Open-Meteo");
  });

  it("keeps the source timestamp visible with cached data", () => {
    render(
      <AirPanel
        aggregate={{
          aqi: 57,
          pm25: 18,
          pm10: 29,
          no2: 13,
          o3: 35,
          sampleCount: 2,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "cached",
        }}
        selection={COUNTRY_PROFILES.UA.selection}
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "Кешовані дані",
    );
    expect(screen.getByText(/Час джерела:/)).toHaveTextContent(
      "22 лип. 2026",
    );
  });

  it("keeps data provenance neutral while a new territory is loading", () => {
    const { container } = render(
      <AirPanel
        aggregate={{
          aqi: 191,
          pm25: 72,
          pm10: 94,
          no2: 41,
          o3: 83,
          sampleCount: 6,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "live",
        }}
        aggregateSelectionId="world"
        worldAggregate={{
          aqi: 33,
          pm25: 8,
          pm10: 11,
          no2: 5,
          o3: 24,
          sampleCount: 6,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "live",
        }}
        selection={COUNTRY_PROFILES.UA.selection}
        loading
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "Україна: завантаження оцінки.",
    );
    expect(screen.getByText("Світовий огляд: Актуальні дані"))
      .toBeInTheDocument();
    expect(screen.getAllByText("Оцінка вибраної території оновлюється"))
      .toHaveLength(2);
    const compactStatus = within(
      container.querySelector(".air-mobile-essential") as HTMLElement,
    );
    expect(compactStatus.getByText(
      "Україна · Світовий огляд: Актуальні дані · AQI",
    )).toBeInTheDocument();
    expect(compactStatus.getByText(
      "Оцінка вибраної території оновлюється",
    )).toBeInTheDocument();
  });

  it("uses Ukrainian copy for representative geographic bounds", () => {
    const source = readFileSync(
      "components/globe/AirQualityGlobe.tsx",
      "utf8",
    );

    expect(source).toContain("Репрезентативне покриття (межі)");
    expect(source).not.toContain("Репрезентативне покриття (bounds)");
  });

  it("renders two collapsed accessible mobile sheets and restores focus on close", () => {
    const { container } = render(
      <AirPanel
        aggregate={{
          aqi: 42,
          pm25: 12,
          pm10: 18,
          no2: 9,
          o3: 31,
          sampleCount: 1,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "live",
        }}
        selection={COUNTRY_PROFILES.UA.selection}
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );
    const controlsToggle = screen.getByRole("button", {
      name: "Відкрити керування",
    });
    const detailsToggle = screen.getByRole("button", {
      name: "Відкрити деталі",
    });
    expect(controlsToggle).toHaveAttribute("aria-expanded", "false");
    expect(detailsToggle).toHaveAttribute("aria-expanded", "false");
    expect(controlsToggle).toHaveAttribute("aria-controls", "air-controls-sheet");
    expect(detailsToggle).toHaveAttribute("aria-controls", "air-details-sheet");
    expect(container.querySelector("#air-controls-sheet")).toHaveAttribute(
      "data-open",
      "false",
    );
    expect(screen.getByText(/Україна · Актуальні дані · AQI/)).toBeInTheDocument();
    expect(screen.getByText(/модельована оцінка, не дані станції/i))
      .toBeInTheDocument();

    fireEvent.click(controlsToggle);
    expect(controlsToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Закрити керування" }));
    expect(controlsToggle).toHaveFocus();
    expect(controlsToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the 390×844 mobile contract in structural CSS", () => {
    const css = readFileSync("src/globals.css", "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 759px)"));

    expect(mobile).toContain("min-height: 62vh");
    expect(mobile).toContain("position: absolute");
    expect(mobile).toMatch(/max-height:\s*min\(/);
    expect(mobile).toContain("overflow-y: auto");
  });

  it("announces the active territory and state from one data live region", () => {
    const aggregate = {
      aqi: 42,
      pm25: 12,
      pm10: 18,
      no2: 9,
      o3: 31,
      sampleCount: 1,
      measuredAt: "2026-07-22T12:00:00Z",
      mode: "live" as const,
    };
    const view = render(
      <AirPanel
        aggregate={aggregate}
        aggregateSelectionId="world"
        selection={COUNTRY_PROFILES.UA.selection}
        loading
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "Україна",
    );
    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "завантаження",
    );

    view.rerender(
      <AirPanel
        aggregate={aggregate}
        selection={COUNTRY_PROFILES.PL.selection}
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "Польща: Актуальні дані.",
    );

    view.rerender(
      <AirPanel
        aggregate={aggregate}
        aggregateSelectionId="world"
        selection={COUNTRY_PROFILES.PL.selection}
        loading
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "Польща",
    );
    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "завантаження",
    );

    view.rerender(
      <AirPanel
        aggregate={{ ...aggregate, mode: "cached" }}
        selection={COUNTRY_PROFILES.PL.selection}
        pollutant="aqi"
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "Польща",
    );
    expect(screen.getByRole("status", { name: "Стан даних" })).toHaveTextContent(
      "Кешовані дані",
    );
  });

  it("changes the prominent metric for every pollutant selection", () => {
    const aggregate = {
      aqi: 42,
      pm25: 12,
      pm10: 18,
      no2: 9,
      o3: 31,
      sampleCount: 1,
      measuredAt: "2026-07-22T12:00:00Z",
      mode: "live" as const,
    };
    const commonProps = {
      aggregate,
      selection: COUNTRY_PROFILES.UA.selection,
      onPin: vi.fn(),
      onPollutantChange: vi.fn(),
    };
    const view = render(<AirPanel {...commonProps} pollutant="aqi" />);
    const selectedMetric = () =>
      screen.getByLabelText("Обраний показник якості повітря");

    expect(selectedMetric()).toHaveTextContent("42 AQI · Добре");
    for (const [pollutant, expected] of [
      ["pm25", "PM2.5 12 мкг/м³"],
      ["pm10", "PM10 18 мкг/м³"],
      ["no2", "NO₂ 9 мкг/м³"],
      ["o3", "O₃ 31 мкг/м³"],
    ] as const) {
      view.rerender(
        <AirPanel {...commonProps} pollutant={pollutant} />,
      );
      expect(selectedMetric()).toHaveTextContent(expected);
    }
    expect(screen.getByText(/Колір країни: AQI 42 · Добре/))
      .toBeInTheDocument();
  });

  it("hides measurements until they belong to the active selection", () => {
    render(
      <AirPanel
        aggregate={{
          aqi: 191,
          pm25: 72,
          pm10: 94,
          no2: 41,
          o3: 83,
          sampleCount: 6,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "live",
        }}
        aggregateSelectionId="world"
        worldAggregate={{
          aqi: 33,
          pm25: 8,
          pm10: 11,
          no2: 5,
          o3: 24,
          sampleCount: 6,
          measuredAt: "2026-07-22T12:00:00Z",
          mode: "live",
        }}
        selection={COUNTRY_PROFILES.UA.cities[0]}
        loading
        pollutant="aqi"
        requestedSampleCount={1}
        onPin={vi.fn()}
        onPollutantChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Київ" })).toBeInTheDocument();
    expect(screen.getByText("Оцінку оновлюємо…")).toBeInTheDocument();
    expect(screen.queryByText(/191 AQI/)).not.toBeInTheDocument();
    expect(screen.queryByText(/72 мкг\/м³/)).not.toBeInTheDocument();
  });

  it("never commits a late aggregate or shows it under a new selection", async () => {
    vi.useFakeTimers();
    try {
      const airResolvers: Array<(response: Response) => void> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.startsWith("/data/")) {
            return Promise.reject(new Error("Географія не потрібна в цьому тесті"));
          }
          if (url.includes("geocoding-api.open-meteo.com")) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                results: [
                  {
                    id: 703448,
                    name: "Київ",
                    latitude: 50.45,
                    longitude: 30.52,
                    country: "Україна",
                  },
                ],
              }),
            });
          }
          return new Promise<Response>((resolve) => airResolvers.push(resolve));
        }),
      );

      render(<Home />);
      await act(() => vi.advanceTimersByTimeAsync(350));
      expect(airResolvers).toHaveLength(1);

      fireEvent.change(
        screen.getByRole("searchbox", { name: "Пошук міста" }),
        { target: { value: "Київ" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Знайти місто" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole("button", { name: "Київ, Україна" }));

      expect(
        screen.getByRole("heading", { name: "Київ" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Оцінку оновлюємо…")).toBeInTheDocument();

      await act(async () => {
        airResolvers[0](liveAirResponse(191));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.queryByText(/191 AQI/)).not.toBeInTheDocument();
      expect(screen.getByText("Оцінку оновлюємо…")).toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(350));
      expect(airResolvers).toHaveLength(2);
      await act(async () => {
        airResolvers[1](liveAirResponse(42));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText(/42 AQI.*Добре/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cannot resurrect an old search selection after another territory is unpinned", () => {
    const searchSelection = {
      ...COUNTRY_PROFILES.UA.cities[0],
      id: "search-kyiv",
      name: "Результат пошуку",
    };

    let state = reduceSelectionState(
      { hovered: null, pinned: null },
      { type: "select", selection: searchSelection },
    );
    state = reduceSelectionState(state, {
      type: "select",
      selection: COUNTRY_PROFILES.PL.selection,
    });
    state = reduceSelectionState(state, {
      type: "toggle-pin",
      selection: COUNTRY_PROFILES.PL.selection,
    });
    state = reduceSelectionState(state, { type: "hover", selection: null });

    expect(state).toEqual({ hovered: null, pinned: null });
  });

  it("debounces selection data by 350 ms and aborts a stale request", async () => {
    vi.useFakeTimers();
    try {
      const airRequests: Array<{ url: string; signal?: AbortSignal }> = [];
      let geocodingRequest = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.startsWith("/data/")) {
            return Promise.reject(new Error("Географія не потрібна в цьому тесті"));
          }
          if (url.includes("geocoding-api.open-meteo.com")) {
            const places = [
              {
                id: 702550,
                name: "Львів",
                latitude: 49.84,
                longitude: 24.03,
                country: "Україна",
              },
              {
                id: 698740,
                name: "Одеса",
                latitude: 46.48,
                longitude: 30.72,
                country: "Україна",
              },
            ];
            const result = places[geocodingRequest++] ?? places[1];
            return Promise.resolve({
              ok: true,
              json: async () => ({
                generationtime_ms: 0.18,
                results: [result],
              }),
            });
          }

          airRequests.push({ url, signal: init?.signal ?? undefined });
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }),
      );

      const view = render(<Home />);
      fireEvent.change(
        screen.getByRole("searchbox", { name: "Пошук міста" }),
        { target: { value: "Львів" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Знайти місто" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole("button", { name: "Львів, Україна" }));

      await act(() => vi.advanceTimersByTimeAsync(349));
      expect(airRequests).toHaveLength(0);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(airRequests).toHaveLength(1);
      expect(airRequests[0].signal?.aborted).toBe(false);

      fireEvent.change(
        screen.getByRole("searchbox", { name: "Пошук міста" }),
        { target: { value: "Одеса" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Знайти місто" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole("button", { name: "Одеса, Україна" }));

      expect(airRequests[0].signal?.aborted).toBe(true);
      await act(() => vi.advanceTimersByTimeAsync(350));
      expect(airRequests).toHaveLength(2);
      expect(airRequests[1].url).toContain("latitude=46.48");
      expect(airRequests[1].url).toContain("longitude=30.72");

      view.unmount();
      expect(airRequests[1].signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
