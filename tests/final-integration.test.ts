import { readFileSync } from "node:fs";

import { geoContains } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";

import {
  aggregateForCountryPlate,
} from "../components/globe/CountryLayer";
import {
  cameraTargetForSelection,
} from "../components/globe/AirQualityGlobe";
import {
  detailAccentForSelection,
} from "../components/globe/ProgressiveDetailLayer";
import { detailSelectionsForLevel } from "../components/globe/globeModel";
import {
  continentInteractionModel,
  normalizeCountries,
} from "../components/globe/globeCountries";
import {
  COUNTRY_PROFILES,
  CONTINENT_SELECTIONS,
  GeographyRepository,
  WORLD_SAMPLE_POINTS,
  isPointInSelection,
  sampleSelection,
  searchSelectionForGeocoding,
  selectionAggregateKey,
} from "../lib/geography";
import { countryMetadataForFeature } from "../lib/countryMetadata";
import type { AirAggregate } from "../lib/types";

type CountryTopology = Topology<{
  countries: GeometryCollection<{ name?: string }>;
}>;

const topology = JSON.parse(
  readFileSync("public/data/countries-110m.json", "utf8"),
) as CountryTopology;
const collection = feature(
  topology,
  topology.objects.countries,
) as unknown as FeatureCollection<Geometry, { name?: string }>;
const countries = normalizeCountries(collection);

const aggregate = (aqi: number): AirAggregate => ({
  aqi,
  pm25: 12,
  pm10: 18,
  no2: 9,
  o3: 31,
  sampleCount: 1,
  measuredAt: "2026-07-22T12:00:00Z",
  mode: "live",
});

describe("complete Natural Earth metadata and hierarchy", () => {
  it("assigns every bundled feature a Ukrainian accessible name and continent", () => {
    expect(collection.features).toHaveLength(177);
    expect(countries).toHaveLength(177);

    for (const sourceFeature of collection.features) {
      const metadata = countryMetadataForFeature({
        id: sourceFeature.id,
        name: sourceFeature.properties?.name,
      });
      expect(metadata).toBeDefined();
      expect(metadata!.displayName).toMatch(/[А-Яа-яІіЇїЄєҐґ]/);
      expect(CONTINENT_SELECTIONS.map(({ id }) => id)).toContain(
        metadata!.continentId,
      );
    }

    for (const country of countries) {
      expect(country.selection.breadcrumbs.map(({ level }) => level)).toEqual([
        "world",
        "continent",
        "country",
      ]);
    }
  });

  it("uses representative Ukrainian names and exposes all seven selectable groups", () => {
    expect(countries.find(({ sourceNumericId }) => sourceNumericId === "804")?.name)
      .toBe("Україна");
    expect(countries.find(({ sourceNumericId }) => sourceNumericId === "404")?.name)
      .toBe("Кенія");
    expect(countries.find(({ sourceNumericId }) => sourceNumericId === "010")?.name)
      .toBe("Антарктида");

    const model = continentInteractionModel(countries);
    expect(model.choices.map(({ id }) => id).sort()).toEqual(
      CONTINENT_SELECTIONS.map(({ id }) => id).sort(),
    );
    const kenya = countries.find(({ sourceNumericId }) => sourceNumericId === "404")!;
    const antarctica = countries.find(({ sourceNumericId }) => sourceNumericId === "010")!;
    expect(model.interactionSelectionsByCountry[kenya.id].name).toBe("Африка");
    expect(model.interactionSelectionsByCountry[antarctica.id].name).toBe("Антарктида");
  });
});

describe("truthful path-independent sampling", () => {
  it("uses six explicitly global world points across regions and hemispheres", () => {
    expect(WORLD_SAMPLE_POINTS).toHaveLength(6);
    expect(new Set(WORLD_SAMPLE_POINTS.map(({ region }) => region)).size).toBe(6);
    expect(WORLD_SAMPLE_POINTS.some(({ latitude }) => latitude < 0)).toBe(true);
    expect(WORLD_SAMPLE_POINTS.some(({ latitude }) => latitude > 0)).toBe(true);
    expect(WORLD_SAMPLE_POINTS.some(({ longitude }) => longitude < 0)).toBe(true);
    expect(WORLD_SAMPLE_POINTS.some(({ longitude }) => longitude > 0)).toBe(true);
  });

  it("is deterministic, polygon-valid, capped at six, and materially dispersed", () => {
    const ukraine = countries.find(({ sourceNumericId }) => sourceNumericId === "804")!
      .selection;
    const first = sampleSelection(ukraine, 99);
    const second = sampleSelection(ukraine, 99);

    expect(first).toEqual(second);
    expect(first).toHaveLength(6);
    expect(Math.max(...first.map(({ longitude }) => longitude)) - Math.min(...first.map(({ longitude }) => longitude)))
      .toBeGreaterThan(10);
    expect(Math.max(...first.map(({ latitude }) => latitude)) - Math.min(...first.map(({ latitude }) => latitude)))
      .toBeGreaterThan(4);
    for (const point of first) {
      expect(isPointInSelection(point, ukraine)).toBe(true);
      expect(geoContains(ukraine.polygon!, [point.longitude, point.latitude])).toBe(true);
    }
  });

  it("restores the exact runtime country geometry through child breadcrumbs", () => {
    const runtimeUkraine = countries.find(({ sourceNumericId }) => sourceNumericId === "804")!
      .selection;
    const repository = new GeographyRepository();
    repository.registerSelections(countries.map(({ selection }) => selection));
    const countryCrumb = COUNTRY_PROFILES.UA.cities[0].breadcrumbs.find(
      ({ level }) => level === "country",
    )!;

    const direct = repository.selection("UA")!;
    const restored = repository.resolveBreadcrumb(countryCrumb)!;
    expect(direct.polygon).toBe(runtimeUkraine.polygon);
    expect(restored.polygon).toBe(runtimeUkraine.polygon);
    expect(sampleSelection(direct, 6)).toEqual(sampleSelection(restored, 6));
  });
});

describe("selection identity, search hierarchy, and level-aware focus", () => {
  it("does not keep a cached AQI accent on an inactive country plate", () => {
    const canada = countries.find(({ selection }) => selection.name === "Канада")!
      .selection;
    const aggregates = {
      [selectionAggregateKey(canada)]: aggregate(47),
    };

    expect(
      aggregateForCountryPlate(canada, undefined, aggregates, false),
    ).toBeUndefined();
    expect(
      aggregateForCountryPlate(canada, undefined, aggregates, true),
    ).toBe(aggregates[selectionAggregateKey(canada)]);
  });

  it("does not use a Kyiv aggregate to recolor the Ukraine plate", () => {
    const ukraine = COUNTRY_PROFILES.UA.selection;
    const kyiv = COUNTRY_PROFILES.UA.cities[0];
    const aggregates = {
      [selectionAggregateKey(kyiv)]: aggregate(175),
    };

    expect(aggregateForCountryPlate(ukraine, undefined, aggregates)).toBeUndefined();
    expect(detailAccentForSelection(kyiv, aggregates)).toBe("#ee695e");
  });

  it("builds Kyiv as world → continent → country → region → city", () => {
    const repository = new GeographyRepository();
    repository.registerSelections(countries.map(({ selection }) => selection));
    const kyiv = searchSelectionForGeocoding(
      {
        id: 703448,
        name: "Київ",
        country: "Україна",
        countryCode: "UA",
        admin1: "Місто Київ",
        latitude: 50.45,
        longitude: 30.52,
      },
      repository,
    );

    expect(kyiv.selection.name).toBe("Київ");
    expect(kyiv.selection.level).toBe("city");
    expect(kyiv.selection.breadcrumbs.map(({ name }) => name)).toEqual([
      "Світ",
      "Європа",
      "Україна",
      "Місто Київ",
      "Київ",
    ]);
    expect(kyiv.selections).toHaveLength(2);
  });

  it("renders the exact searched Lviv marker with its own aggregate accent", () => {
    const repository = new GeographyRepository();
    repository.registerSelections(countries.map(({ selection }) => selection));
    const lviv = searchSelectionForGeocoding(
      {
        id: 702550,
        name: "Львів",
        country: "Україна",
        countryCode: "UA",
        admin1: "Львівська область",
        latitude: 49.84,
        longitude: 24.03,
      },
      repository,
    ).selection;
    const ukraine = countries.find(
      ({ sourceNumericId }) => sourceNumericId === "804",
    )!.selection;
    const details = detailSelectionsForLevel(
      "city",
      COUNTRY_PROFILES.UA,
      ukraine,
      lviv,
    );
    const aggregates = {
      [selectionAggregateKey(lviv)]: aggregate(175),
      [selectionAggregateKey(COUNTRY_PROFILES.UA.cities[0])]: aggregate(42),
    };

    expect(details.city).toBe(lviv);
    expect(details.city).toMatchObject({
      id: "search-city-702550",
      centroid: { longitude: 24.03, latitude: 49.84 },
    });
    expect(detailAccentForSelection(details.city!, aggregates)).toBe("#ee695e");
  });

  it("retains an exact searched city when no curated country profile exists", () => {
    const repository = new GeographyRepository();
    const reykjavik = searchSelectionForGeocoding(
      {
        id: 3413829,
        name: "Рейк'явік",
        country: "Ісландія",
        countryCode: "IS",
        admin1: "Столичний регіон",
        latitude: 64.15,
        longitude: -21.94,
      },
      repository,
    ).selection;
    const details = detailSelectionsForLevel(
      "city",
      undefined,
      undefined,
      reykjavik,
    );

    expect(details.city).toBe(reykjavik);
    expect(details.city?.centroid).toEqual({
      longitude: -21.94,
      latitude: 64.15,
    });
  });

  it("chooses target distances for city search and outward breadcrumbs", () => {
    // City stays closer than country (a real drill-down), but not so close that the
    // flat-shaded low-poly country plates and base sphere reveal their facets — that
    // used to happen below ~4.6 and looked like shattered glass. See MIN_DISTANCE.
    expect(cameraTargetForSelection(COUNTRY_PROFILES.UA.cities[0]).distance)
      .toBeLessThan(5.25);
    expect(cameraTargetForSelection(COUNTRY_PROFILES.UA.cities[0]).distance)
      .toBeGreaterThanOrEqual(4.5);
    expect(cameraTargetForSelection(COUNTRY_PROFILES.UA.selection).distance)
      .toBeGreaterThanOrEqual(4.5);
    expect(cameraTargetForSelection(CONTINENT_SELECTIONS[3]).distance)
      .toBeGreaterThanOrEqual(6);
  });
});
