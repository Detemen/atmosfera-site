import { readFileSync } from "node:fs";

import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { MathUtils } from "three";
import { describe, expect, it } from "vitest";

import {
  GLOBE_RADIUS,
  createSphericalPlateGeometry,
  diagnoseSphericalPlateGeometry,
} from "../components/globe/sphericalGeometry";
import { normalizeCountries } from "../components/globe/globeCountries";
import type { CountryGeometry } from "../lib/geography";

type CountryTopology = Topology<{
  countries: GeometryCollection<{ name?: string }>;
}>;

const topology = JSON.parse(
  readFileSync("public/data/countries-110m.json", "utf8"),
) as CountryTopology;
const countries = feature(
  topology,
  topology.objects.countries,
) as unknown as FeatureCollection<Geometry, { name?: string }>;

const geometryFor = (name: string) => {
  const country = countries.features.find(
    (candidate) => candidate.properties?.name === name,
  );
  if (
    country?.geometry?.type !== "Polygon" &&
    country?.geometry?.type !== "MultiPolygon"
  ) {
    throw new Error(`Missing polygon geometry for ${name}`);
  }
  return country.geometry as unknown as CountryGeometry;
};

describe("spherical country plate tessellation", () => {
  it("keeps Antarctica in the rendered Natural Earth country collection", () => {
    expect(
      normalizeCountries(countries).some(({ name }) => name === "Антарктида"),
    ).toBe(true);
  });

  for (const name of ["Brazil", "United States of America", "Russia", "Australia"]) {
    it(`keeps every sampled ${name} front triangle above the ocean`, () => {
      const geometry = createSphericalPlateGeometry(geometryFor(name));
      const diagnostic = diagnoseSphericalPlateGeometry(geometry);

      expect(diagnostic.frontTriangleCount).toBeGreaterThan(0);
      expect(diagnostic.positionsFinite).toBe(true);
      expect(diagnostic.normalsFinite).toBe(true);
      expect(diagnostic.minFrontSampleRadius).toBeGreaterThan(GLOBE_RADIUS);
      expect(diagnostic.invertedFrontTriangleCount).toBe(0);

      geometry.dispose();
    });
  }

  it("renders the real Antarctic pole cap without inverted seam triangles", () => {
    const geometry = createSphericalPlateGeometry(geometryFor("Antarctica"));
    const diagnostic = diagnoseSphericalPlateGeometry(geometry);

    expect(diagnostic.frontTriangleCount).toBeGreaterThan(0);
    expect(diagnostic.positionsFinite).toBe(true);
    expect(diagnostic.normalsFinite).toBe(true);
    expect(diagnostic.minFrontSampleRadius).toBeGreaterThan(GLOBE_RADIUS);
    expect(diagnostic.invertedFrontTriangleCount).toBe(0);
    expect(diagnostic.maxFrontEdgeRadians).toBeLessThanOrEqual(
      MathUtils.degToRad(3.001),
    );

    geometry.dispose();
  });
});
