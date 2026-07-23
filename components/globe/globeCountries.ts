import { geoBounds, geoCentroid } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";

import {
  CONTINENT_SELECTIONS,
  profileForCountryFeature,
  selectionForBreadcrumb,
  type CountryGeometry,
  type GeoSelection,
} from "../../lib/geography";
import { countryMetadataForFeature } from "../../lib/countryMetadata";
import type { GlobeCountry } from "./CountryLayer";

export const normalizeCountries = (
  collection: FeatureCollection<Geometry, { name?: string }>,
): GlobeCountry[] =>
  collection.features.flatMap((countryFeature) => {
    if (
      countryFeature.geometry?.type !== "Polygon" &&
      countryFeature.geometry?.type !== "MultiPolygon"
    ) {
      return [];
    }

    const sourceName = countryFeature.properties?.name;
    const metadata = countryMetadataForFeature({ id: countryFeature.id, name: sourceName });
    if (!metadata) return [];
    const geometry = countryFeature.geometry as unknown as CountryGeometry;
    const curated = profileForCountryFeature({
      id: countryFeature.id,
      name: sourceName,
      geometry,
    });
    const [[west, south], [east, north]] = geoBounds(countryFeature);
    const [longitude, latitude] = geoCentroid(countryFeature);
    const name = metadata.displayName;
    const continent = CONTINENT_SELECTIONS.find(
      ({ id }) => id === metadata.continentId,
    )!;
    const id = curated?.selection.id ?? metadata.alpha2 ?? metadata.featureKey;
    const selection: GeoSelection = curated
      ? {
          ...curated.selection,
          name,
          polygon: geometry,
          countryCode: metadata.alpha2 ?? curated.code,
          sourceNumericId: metadata.numericId,
          continentId: metadata.continentId,
        }
      : {
          id,
          name,
          level: "country",
          bounds: { west, south, east, north },
          centroid: { longitude, latitude },
          breadcrumbs: [
            { id: "world", name: "Світ", level: "world" },
            continent.breadcrumbs[1],
            { id, name, level: "country" },
          ],
          polygon: geometry,
          countryCode: metadata.alpha2 ?? undefined,
          sourceNumericId: metadata.numericId,
          continentId: metadata.continentId,
        };

    return [{
      id: selection.id,
      name,
      sourceNumericId: metadata.numericId,
      geometry,
      selection,
    }];
  });

export const continentInteractionModel = (countries: readonly GlobeCountry[]) => {
  const grouped = new Map<string, GlobeCountry[]>();
  for (const country of countries) {
    const continentCrumb = country.selection.breadcrumbs.find(
      ({ level }) => level === "continent",
    );
    if (!continentCrumb) continue;
    const group = grouped.get(continentCrumb.id) ?? [];
    group.push(country);
    grouped.set(continentCrumb.id, group);
  }

  const interactionSelectionsByCountry: Record<string, GeoSelection> = {};
  const choices: GeoSelection[] = [];
  for (const continent of CONTINENT_SELECTIONS) {
    const members = grouped.get(continent.id);
    if (!members?.length) continue;
    const selection = selectionForBreadcrumb(continent.breadcrumbs[1]);
    if (!selection) continue;
    choices.push(selection);
    for (const country of members) {
      interactionSelectionsByCountry[country.id] = selection;
    }
  }
  return { choices, interactionSelectionsByCountry };
};
