import { describe, expect, it } from "vitest";
import { geoContains } from "d3-geo";

import {
  CONTINENT_SELECTIONS,
  COUNTRY_PROFILES,
  CURATED_COUNTRY_NUMERIC_IDS,
  isPointInSelection,
  levelForDistance,
  profileForCountryFeature,
  sampleSelection,
  selectionForBreadcrumb,
} from "../lib/geography";

describe("geographic hierarchy", () => {
  it("resolves continent breadcrumbs to canonical Natural Earth extents", () => {
    const ukraine = COUNTRY_PROFILES.UA.selection;
    const europeCrumb = ukraine.breadcrumbs.find(({ level }) => level === "continent")!;
    const europe = selectionForBreadcrumb(europeCrumb, ukraine);

    expect(europe).toMatchObject({
      id: "continent-європа",
      name: "Європа",
      level: "continent",
      bounds: {
        west: -9.479736,
        south: 34.934473,
        east: 66.364146,
        north: 71.14209,
      },
      centroid: { longitude: 26.61182, latitude: 54.460515 },
    });
    const samples = sampleSelection(europe!, 6);
    expect(samples).toHaveLength(6);
    expect(samples[0].longitude).toBeCloseTo(europe!.centroid.longitude);
    expect(samples[0].latitude).toBeCloseTo(europe!.centroid.latitude);
    expect(samples.every((point) => isPointInSelection(point, europe!))).toBe(true);
    expect(samples.some((point) => !isPointInSelection(point, ukraine))).toBe(true);
  });

  it("defines all seven continent navigation targets with world-first breadcrumbs", () => {
    expect(CONTINENT_SELECTIONS).toHaveLength(7);
    expect(new Set(CONTINENT_SELECTIONS.map(({ id }) => id)).size).toBe(7);
    for (const continent of CONTINENT_SELECTIONS) {
      expect(continent.level).toBe("continent");
      expect(continent.breadcrumbs.map(({ level }) => level)).toEqual([
        "world",
        "continent",
      ]);
    }
  });

  it("maps globe camera distances to the exact progressive zoom bands", () => {
    expect(levelForDistance(8)).toBe("continent");
    expect(levelForDistance(5.5)).toBe("country");
    expect(levelForDistance(3.8)).toBe("region");
    expect(levelForDistance(2.6)).toBe("city");
    expect(levelForDistance(1.8)).toBe("coordinate");
  });

  it("uses exact inclusive boundaries for every zoom level", () => {
    expect(levelForDistance(12)).toBe("world");
    expect(levelForDistance(6)).toBe("continent");
    expect(levelForDistance(4.5)).toBe("country");
    expect(levelForDistance(3.2)).toBe("region");
    expect(levelForDistance(2.2)).toBe("city");
  });

  it("keeps a curated city breadcrumb ordered through every preceding level", () => {
    const kyiv = COUNTRY_PROFILES.UA.cities.find(({ id }) => id === "ua-kyiv")!;

    expect(kyiv.breadcrumbs.map(({ level }) => level)).toEqual([
      "world",
      "continent",
      "country",
      "region",
      "city",
    ]);
    expect(kyiv.breadcrumbs.map(({ name }) => name)).toEqual([
      "Світ",
      "Європа",
      "Україна",
      "Київська область",
      "Київ",
    ]);
  });

  it("makes Kyiv Oblast materially larger than its Kyiv city selection", () => {
    const oblast = COUNTRY_PROFILES.UA.regions.find(({ id }) => id === "ua-kyiv-region")!;
    const city = COUNTRY_PROFILES.UA.cities.find(({ id }) => id === "ua-kyiv")!;

    expect(oblast.bounds.west).toBeLessThanOrEqual(city.bounds.west);
    expect(oblast.bounds.south).toBeLessThanOrEqual(city.bounds.south);
    expect(oblast.bounds.east).toBeGreaterThanOrEqual(city.bounds.east);
    expect(oblast.bounds.north).toBeGreaterThanOrEqual(city.bounds.north);
    expect(oblast.bounds.east - oblast.bounds.west).toBeGreaterThan(
      (city.bounds.east - city.bounds.west) * 3,
    );
    expect(oblast.bounds.north - oblast.bounds.south).toBeGreaterThan(
      (city.bounds.north - city.bounds.south) * 3,
    );
  });
});

describe("Natural Earth country profile joins", () => {
  it("aligns every curated alpha-2 profile with its world-atlas numeric id", () => {
    expect(CURATED_COUNTRY_NUMERIC_IDS).toEqual({
      UA: "804",
      PL: "616",
      DE: "276",
      FR: "250",
      IN: "356",
      JP: "392",
      BR: "076",
      US: "840",
      CA: "124",
      AU: "036",
    });
  });

  it("attaches decoded TopoJSON country geometry to the matching curated profile", () => {
    const geometry = {
      type: "Polygon" as const,
      coordinates: [[[13, 52], [14, 52], [14, 53], [13, 52]]],
    };

    const matched = profileForCountryFeature({ id: "276", geometry });

    expect(matched?.code).toBe("DE");
    expect(matched?.selection.polygon).toEqual(geometry);
    expect(profileForCountryFeature({ id: 36, geometry })?.code).toBe("AU");
    expect(profileForCountryFeature({ id: 76, geometry })?.code).toBe("BR");
    expect(profileForCountryFeature({ id: "999", geometry })).toBeUndefined();
  });
});

describe("representative spatial sampling", () => {
  const ukraineSelection = COUNTRY_PROFILES.UA.selection;

  it("returns a bounded six-point sample for Ukraine", () => {
    expect(sampleSelection(ukraineSelection, 6)).toHaveLength(6);
  });

  it("keeps every representative sample inside the selection bounds", () => {
    const samples = sampleSelection(ukraineSelection, 99);

    expect(samples).toHaveLength(6);
    for (const point of samples) {
      expect(point.latitude).toBeGreaterThanOrEqual(ukraineSelection.bounds.south);
      expect(point.latitude).toBeLessThanOrEqual(ukraineSelection.bounds.north);
      expect(point.longitude).toBeGreaterThanOrEqual(ukraineSelection.bounds.west);
      expect(point.longitude).toBeLessThanOrEqual(ukraineSelection.bounds.east);
    }
  });

  it("clips curated Ukraine samples to its bundled Natural Earth boundary", () => {
    const samples = sampleSelection(ukraineSelection, 6);

    expect(ukraineSelection.polygon).toBeDefined();
    for (const point of samples) {
      expect(
        geoContains(ukraineSelection.polygon!, [point.longitude, point.latitude]),
      ).toBe(true);
    }
  });

  it("is deterministic and clips grid candidates to a supplied polygon", () => {
    const triangularSelection = {
      id: "triangle",
      name: "Triangle",
      level: "country" as const,
      bounds: { west: 0, south: 0, east: 2, north: 2 },
      centroid: { longitude: 0.5, latitude: 0.5 },
      polygon: {
        type: "Polygon" as const,
        coordinates: [[[0, 0], [2, 0], [0, 2], [0, 0]]],
      },
      breadcrumbs: [
        { id: "world", name: "World", level: "world" as const },
        { id: "triangle", name: "Triangle", level: "country" as const },
      ],
    };

    const first = sampleSelection(triangularSelection, 6);
    expect(sampleSelection(triangularSelection, 6)).toEqual(first);
    expect(first).toEqual(
      expect.arrayContaining([{ longitude: 0.5, latitude: 0.5 }]),
    );
    for (const point of first) {
      expect(point.latitude + point.longitude).toBeLessThanOrEqual(2);
    }
  });

  it("clips seam-crossing polygons rather than their 340-degree exterior", () => {
    const seamSelection = {
      id: "pacific-square",
      name: "Pacific square",
      level: "country" as const,
      bounds: { west: -180, south: -1, east: 180, north: 1 },
      centroid: { longitude: 0, latitude: 0 },
      polygon: {
        type: "Polygon" as const,
        coordinates: [[[170, -1], [-170, -1], [-170, 1], [170, 1], [170, -1]]],
      },
      breadcrumbs: [
        { id: "world", name: "World", level: "world" as const },
        { id: "pacific-square", name: "Pacific square", level: "country" as const },
      ],
    };

    const samples = sampleSelection(seamSelection, 6);

    expect(samples).toHaveLength(6);
    expect(isPointInSelection({ longitude: 0, latitude: 0 }, seamSelection)).toBe(false);
    expect(isPointInSelection({ longitude: 175, latitude: 0 }, seamSelection)).toBe(true);
    expect(isPointInSelection({ longitude: -175, latitude: 0 }, seamSelection)).toBe(true);
    expect(samples.every((point) => isPointInSelection(point, seamSelection))).toBe(true);
    expect(samples.every(({ longitude }) => Math.abs(longitude) >= 170)).toBe(true);
  });
});
