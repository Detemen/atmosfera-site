"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { aqiCategory } from "../../lib/air-quality";
import type {
  GeocodingIdentity,
  GeoBreadcrumb,
  GeoLevel,
  GeoSelection,
} from "../../lib/geography";
import type { AirAggregate, AqiCategory, DataMode } from "../../lib/types";
import type { PollutantKey } from "../globe/CountryLayer";

type AirPanelProps = {
  aggregate: AirAggregate;
  aggregateSelectionId?: string;
  worldAggregate?: AirAggregate;
  selection: GeoSelection | null;
  level?: GeoLevel;
  pollutant: PollutantKey;
  loading?: boolean;
  pinned?: boolean;
  requestedSampleCount?: number;
  onBreadcrumbSelect?: (breadcrumb: GeoBreadcrumb) => void;
  onPin: () => void;
  onPollutantChange: (pollutant: PollutantKey) => void;
  onSearchResult?: (result: GeocodingIdentity) => void;
};

type GeocodingResult = GeocodingIdentity;

const parseGeocodingResults = (payload: unknown): GeocodingResult[] => {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  return results.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const entry = candidate as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const latitude = entry.latitude;
    const longitude = entry.longitude;
    if (
      !name ||
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return [];
    }

    const country =
      typeof entry.country === "string" && entry.country.trim()
        ? entry.country.trim()
        : undefined;
    const admin1 =
      typeof entry.admin1 === "string" && entry.admin1.trim()
        ? entry.admin1.trim()
        : undefined;
    const countryCode =
      typeof entry.country_code === "string" && entry.country_code.trim()
        ? entry.country_code.trim().toUpperCase()
        : undefined;
    const id =
      typeof entry.id === "number" || typeof entry.id === "string"
        ? entry.id
        : `${name}-${latitude}-${longitude}`;
    return [{ id, name, latitude, longitude, country, countryCode, admin1 }];
  });
};

const POLLUTANT_META: Record<
  PollutantKey,
  { field: PollutantKey; label: string; unit: "AQI" | "мкг/м³" }
> = {
  aqi: { field: "aqi", label: "AQI", unit: "AQI" },
  pm25: { field: "pm25", label: "PM2.5", unit: "мкг/м³" },
  pm10: { field: "pm10", label: "PM10", unit: "мкг/м³" },
  no2: { field: "no2", label: "NO₂", unit: "мкг/м³" },
  o3: { field: "o3", label: "O₃", unit: "мкг/м³" },
};

const POLLUTANTS = Object.entries(POLLUTANT_META).map(([key, meta]) => ({
  key: key as PollutantKey,
  label: meta.label,
}));

const LEVEL_LABELS: Record<GeoLevel, string> = {
  world: "світ",
  continent: "континент",
  country: "країна",
  region: "регіон",
  city: "місто",
  coordinate: "координата",
};

const MODE_LABELS: Record<DataMode, string> = {
  live: "Актуальні дані",
  cached: "Кешовані дані",
  demo: "Демо-дані",
};

const AQI_LEGEND: Array<AqiCategory & { range: string }> = [
  { range: "0–50", label: "Добре", color: "#a7ef5a" },
  { range: "51–100", label: "Помірно", color: "#f2cf5b" },
  {
    range: "101–150",
    label: "Шкідливо для чутливих груп",
    color: "#f29a4a",
  },
  { range: "151–200", label: "Шкідливо", color: "#ee695e" },
  { range: "201–300", label: "Дуже шкідливо", color: "#c05ad8" },
  { range: "301+", label: "Небезпечно", color: "#8f2f4f" },
];

const DATE_FORMATTER = new Intl.DateTimeFormat("uk-UA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Kyiv",
});

const formatMeasuredAt = (measuredAt: string) => {
  const date = new Date(measuredAt);
  return Number.isNaN(date.valueOf())
    ? "Час джерела недоступний"
    : DATE_FORMATTER.format(date);
};

export function AirPanel({
  aggregate,
  aggregateSelectionId: aggregateOwnerId,
  worldAggregate = aggregate,
  selection,
  level = "continent",
  pollutant,
  loading = false,
  pinned = false,
  requestedSampleCount = aggregate.sampleCount,
  onBreadcrumbSelect,
  onPin,
  onPollutantChange,
  onSearchResult,
}: AirPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "empty" | "error"
  >("idle");
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchGenerationRef = useRef(0);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const controlsToggleRef = useRef<HTMLButtonElement>(null);
  const detailsToggleRef = useRef<HTMLButtonElement>(null);
  const legendToggleRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      searchGenerationRef.current += 1;
      searchAbortRef.current?.abort();
    },
    [],
  );

  const handleSearch = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const query = searchQuery.trim();
      if (!query) return;

      searchAbortRef.current?.abort();
      const controller = new AbortController();
      const generation = searchGenerationRef.current + 1;
      searchGenerationRef.current = generation;
      searchAbortRef.current = controller;
      setSearchResults([]);
      setSearchState("loading");

      const queryString = new URLSearchParams({
        name: query,
        count: "5",
        language: "uk",
        format: "json",
      });

      try {
        const response = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?${queryString}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Geocoding request failed");
        const results = parseGeocodingResults(await response.json());
        if (generation !== searchGenerationRef.current) return;
        setSearchResults(results);
        setSearchState(results.length === 0 ? "empty" : "idle");
      } catch (error) {
        if (generation !== searchGenerationRef.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchResults([]);
        setSearchState("error");
      }
    },
    [searchQuery],
  );

  const chooseSearchResult = useCallback(
    (result: GeocodingResult) => {
      onSearchResult?.(result);
      setSearchQuery(result.name);
      setSearchResults([]);
      setSearchState("idle");
      setControlsOpen(false);
      controlsToggleRef.current?.focus();
    },
    [onSearchResult],
  );

  const activeSelectionId = selection?.id ?? "world";
  const aggregateSelectionId = aggregateOwnerId ?? activeSelectionId;
  const currentAggregate =
    aggregateSelectionId === activeSelectionId ? aggregate : null;
  const category = currentAggregate
    ? aqiCategory(currentAggregate.aqi)
    : null;
  const worldCategory = aqiCategory(worldAggregate.aqi);
  const measuredAt = currentAggregate
    ? formatMeasuredAt(currentAggregate.measuredAt)
    : null;
  const displayedMode = currentAggregate?.mode ?? worldAggregate.mode;
  const selectionLoading = loading && !currentAggregate;
  const activeTerritoryName = selection?.name ?? "Світ";
  const provenanceLabel = currentAggregate
    ? MODE_LABELS[displayedMode]
    : `Світовий огляд: ${MODE_LABELS[worldAggregate.mode]}`;
  const dataStatus = selectionLoading
    ? "Оцінка вибраної території оновлюється"
    : provenanceLabel;
  const dataLiveMessage = selectionLoading
    ? `${activeTerritoryName}: завантаження оцінки.`
    : `${activeTerritoryName}: ${dataStatus}.`;
  const selectedPollutant = POLLUTANT_META[pollutant];
  const selectedValue = currentAggregate
    ? Math.round(currentAggregate[selectedPollutant.field])
    : null;
  const textAlternative = currentAggregate && category
    ? [
        `${selection?.name ?? "Огляд світу"}: AQI ${Math.round(currentAggregate.aqi)} — ${category.label}.`,
        "Це модельована просторова оцінка, не дані станції.",
        "Джерело: CAMS (~11 км) через Open-Meteo, CC BY 4.0.",
        "Час джерела наведено в панелі оцінки.",
      ].join(" ")
    : "Для вибраної території завантажується модельована просторова оцінка Open-Meteo · CAMS; це не дані станції.";
  const openControls = () => {
    setControlsOpen(true);
    setDetailsOpen(false);
    setLegendOpen(false);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };
  const closeControls = () => {
    setControlsOpen(false);
    controlsToggleRef.current?.focus();
  };
  const openDetails = () => {
    setDetailsOpen(true);
    setControlsOpen(false);
    setLegendOpen(false);
  };
  const closeDetails = () => {
    setDetailsOpen(false);
    detailsToggleRef.current?.focus();
  };
  const openLegend = () => {
    setLegendOpen(true);
    setControlsOpen(false);
    setDetailsOpen(false);
  };
  const closeLegend = () => {
    setLegendOpen(false);
    legendToggleRef.current?.focus();
  };
  const colorSemanticsLabel = selection?.level === "country"
    ? "Колір країни"
    : selection?.level === "continent"
      ? "Акцент континентальної групи"
      : `Акцент ${LEVEL_LABELS[selection?.level ?? "world"]}`;

  return (
    <>
      <header className="air-masthead">
        <div>
          <p className="air-kicker">Глобальна атмосфера</p>
          <h1>Якість повітря зараз</h1>
        </div>
        <p
          className="air-mode-badge"
          data-mode={selectionLoading ? "loading" : displayedMode}
        >
          <span className="air-mode-badge__dot" aria-hidden="true" />
          <span>{provenanceLabel}</span>
          {selectionLoading ? (
            <span className="air-mode-badge__refresh">{dataStatus}</span>
          ) : loading ? (
            <span className="air-mode-badge__refresh">оновлення…</span>
          ) : null}
        </p>
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label="Стан даних"
        >
          {dataLiveMessage}
        </p>
      </header>

      <div className="air-panel-layer">
      <div className="air-mobile-essential" aria-label="Стислий стан вибору">
        <div className="air-mobile-essential__status">
          <p>{`${activeTerritoryName} · ${provenanceLabel} · ${selectedPollutant.label}`}</p>
          {selectionLoading ? (
            <p className="air-mobile-essential__refresh">{dataStatus}</p>
          ) : null}
        </div>
        <p>Модельована оцінка, не дані станції</p>
      </div>
      <div className="air-mobile-sheet-tabs" aria-label="Мобільні панелі">
        <button
          ref={controlsToggleRef}
          type="button"
          aria-controls="air-controls-sheet"
          aria-expanded={controlsOpen}
          aria-label="Відкрити керування"
          onClick={openControls}
        >
          Керування · {selectedPollutant.label}
        </button>
        <button
          ref={detailsToggleRef}
          type="button"
          aria-controls="air-details-sheet"
          aria-expanded={detailsOpen}
          aria-label="Відкрити деталі"
          onClick={openDetails}
        >
          {activeTerritoryName}
        </button>
        <button
          ref={legendToggleRef}
          type="button"
          aria-controls="air-legend-sheet"
          aria-expanded={legendOpen}
          aria-label="Відкрити шкалу AQI"
          onClick={openLegend}
        >
          Шкала AQI
        </button>
      </div>
      <section
        id="air-controls-sheet"
        className="air-panel air-panel--controls"
        data-open={controlsOpen}
        aria-label="Керування картою"
      >
        <button
          type="button"
          className="air-sheet-close"
          aria-label="Закрити керування"
          onClick={closeControls}
        >
          Закрити
        </button>
        <form className="air-search-form" role="search" onSubmit={handleSearch}>
          <label className="air-search-label" htmlFor="city-search">
            Пошук міста
          </label>
          <div className="air-search-row">
            <input
              id="city-search"
              ref={searchInputRef}
              className="air-search"
              type="search"
              placeholder="Наприклад, Київ"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <button type="submit" aria-label="Знайти місто">
              →
            </button>
          </div>
          <div className="air-search-results" aria-live="polite">
            {searchState === "loading" ? <p>Шукаємо місто…</p> : null}
            {searchState === "empty" ? <p>Міст не знайдено.</p> : null}
            {searchState === "error" ? (
              <p>Не вдалося виконати пошук. Спробуйте ще раз.</p>
            ) : null}
            {searchResults.length > 0 ? (
              <ul aria-label="Результати пошуку міст">
                {searchResults.map((result) => {
                  const placeLabel = result.admin1
                    ? `${result.name} — ${[result.admin1, result.country].filter(Boolean).join(", ")}`
                    : [result.name, result.country].filter(Boolean).join(", ");
                  return (
                    <li key={result.id}>
                      <button
                        type="button"
                        onClick={() => chooseSearchResult(result)}
                      >
                        {placeLabel}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </form>

        <div className="air-world-summary">
          <div>
            <p className="air-eyebrow">Світовий огляд</p>
            <p className="air-world-summary__value">
              {Math.round(worldAggregate.aqi)} <span>AQI</span>
            </p>
          </div>
          <p style={{ color: worldCategory.color }}>{worldCategory.label}</p>
        </div>

        <p className="air-level">
          Поточний рівень <strong>{LEVEL_LABELS[level]}</strong>
        </p>

        <fieldset className="air-pollutants">
          <legend>Оберіть забруднювач</legend>
          <div className="air-pollutants__options">
            {POLLUTANTS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={pollutant === key}
                onClick={() => onPollutantChange(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          className="air-sheet-apply"
          onClick={closeControls}
        >
          Застосувати й закрити
        </button>
      </section>

      <section
        id="air-details-sheet"
        className="air-panel air-panel--details"
        data-open={detailsOpen}
        aria-label="Деталі вибору"
      >
        <button
          type="button"
          className="air-sheet-close"
          aria-label="Закрити деталі"
          onClick={closeDetails}
        >
          Закрити
        </button>
        <nav aria-label="Ієрархія території" className="air-breadcrumbs">
          <ol>
            {(selection?.breadcrumbs ?? [
              { id: "world", name: "Світ", level: "world" as const },
            ]).map((breadcrumb, index, breadcrumbs) => (
              <li key={breadcrumb.id}>
                <button
                  type="button"
                  aria-current={
                    index === breadcrumbs.length - 1 ? "location" : undefined
                  }
                  onClick={() => onBreadcrumbSelect?.(breadcrumb)}
                >
                  {breadcrumb.name}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="air-detail-heading">
          <div>
            <p className="air-eyebrow">Просторова оцінка</p>
            <h2>{selection?.name ?? "Огляд світу"}</h2>
          </div>
          {selection ? (
            <button
              type="button"
              className="air-pin"
              aria-pressed={pinned}
              onClick={onPin}
            >
              {pinned ? "Територію закріплено" : "Закріпити територію"}
            </button>
          ) : null}
        </div>

        {currentAggregate && category ? (
          <>
            <p
              className="air-aqi-value"
              aria-label="Обраний показник якості повітря"
              style={{ color: pollutant === "aqi" ? category.color : undefined }}
            >
              {pollutant === "aqi"
                ? `${selectedValue} AQI · ${category.label}`
                : `${selectedPollutant.label} ${selectedValue} ${selectedPollutant.unit}`}
            </p>
            <p className="air-color-semantics">
              {`${colorSemanticsLabel}: AQI ${Math.round(currentAggregate.aqi)} · ${category.label}`}
            </p>

            <dl className="air-pollutant-values">
              <div>
                <dt>PM2.5</dt>
                <dd>{Math.round(currentAggregate.pm25)} мкг/м³</dd>
              </div>
              <div>
                <dt>PM10</dt>
                <dd>{Math.round(currentAggregate.pm10)} мкг/м³</dd>
              </div>
              <div>
                <dt>NO₂</dt>
                <dd>{Math.round(currentAggregate.no2)} мкг/м³</dd>
              </div>
              <div>
                <dt>O₃</dt>
                <dd>{Math.round(currentAggregate.o3)} мкг/м³</dd>
              </div>
            </dl>

            <div className="air-provenance">
              <p>{`Повнота вибірки: ${currentAggregate.sampleCount}/${requestedSampleCount}`}</p>
              <p>
                Час джерела:{" "}
                <time dateTime={currentAggregate.measuredAt}>{measuredAt}</time>
              </p>
            </div>

            {currentAggregate.mode === "demo" ? (
              <p className="air-demo-warning">
                Демо-дані — модельовані оцінки для демонстрації, не дані станції.
              </p>
            ) : null}
            {currentAggregate.mode === "cached" ? (
              <p className="air-cache-warning">
                Показано останню доступну кешовану оцінку з указаним часом джерела.
              </p>
            ) : null}
          </>
        ) : (
          <p className="air-measurement-loading">
            Оцінку оновлюємо…
          </p>
        )}
      </section>

      <footer
        id="air-legend-sheet"
        className="air-legend"
        data-open={legendOpen}
      >
        <button
          type="button"
          className="air-sheet-close"
          aria-label="Закрити шкалу AQI"
          onClick={closeLegend}
        >
          Закрити
        </button>
        <ul aria-label="Шкала AQI">
          {AQI_LEGEND.map((item) => (
            <li key={item.range}>
              <span
                className="air-legend__swatch"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span>{item.range}</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <p className="air-attribution">
          Модельовані оцінки: Open-Meteo · CAMS (~11 км), CC BY 4.0
        </p>
      </footer>
      <section className="sr-only" aria-label="Текстова альтернатива даних">
        <h2>Текстовий опис поточної оцінки</h2>
        <p>{textAlternative}</p>
      </section>
      </div>
    </>
  );
}
