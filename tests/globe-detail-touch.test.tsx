import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProgressiveDetailLayer } from "../components/globe/ProgressiveDetailLayer";
import {
  detailSelectionsForLevel,
  sceneVisibilityForLevel,
  selectionActivationForPointer,
} from "../components/globe/globeModel";
import {
  COUNTRY_PROFILES,
  GeographyRepository,
  searchSelectionForGeocoding,
  selectionAggregateKey,
  type GeoSelection,
} from "../lib/geography";

vi.mock("@react-three/drei", () => ({ Edges: () => null }));

describe("progressive detail touch activation", () => {
  it("renders the exact searched Lviv marker as selected with its own AQI accent", () => {
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
      new GeographyRepository(),
    ).selection;
    const details = detailSelectionsForLevel(
      "city",
      COUNTRY_PROFILES.UA,
      COUNTRY_PROFILES.UA.selection,
      lviv,
    );
    const { container } = render(
      <ProgressiveDetailLayer
        visibility={sceneVisibilityForLevel("city")}
        region={details.region}
        city={details.city}
        coordinate={details.coordinate}
        hoveredId={null}
        selectedId={lviv.id}
        aggregatesBySelection={{
          [selectionAggregateKey(lviv)]: {
            aqi: 175,
            pm25: 62,
            pm10: 81,
            no2: 35,
            o3: 72,
            sampleCount: 1,
            measuredAt: "2026-07-22T12:00:00Z",
            mode: "live",
          },
        }}
        onHover={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    const marker = container.querySelector(`mesh[name="detail-${lviv.id}"]`);
    expect(marker).not.toBeNull();
    expect(marker).toHaveAttribute("scale", "1.35");
    expect(marker?.querySelector("meshstandardmaterial"))
      .toHaveAttribute("emissive", "#ee695e");
  });

  it("previews on the first touch and selects on the second touch", () => {
    const city = COUNTRY_PROFILES.UA.cities[0];
    const coordinate: GeoSelection = {
      id: `${city.id}-sample-coordinate`,
      name: `Репрезентативна координата — ${city.name}`,
      level: "coordinate",
      bounds: {
        west: city.centroid.longitude,
        south: city.centroid.latitude,
        east: city.centroid.longitude,
        north: city.centroid.latitude,
      },
      centroid: city.centroid,
      breadcrumbs: city.breadcrumbs,
    };
    const onHover = vi.fn();
    const onSelect = vi.fn();
    let previewId: string | null = null;
    const onActivate = (selection: GeoSelection, pointerType: string) => {
      const transition = selectionActivationForPointer(
        previewId,
        selection.id,
        pointerType,
      );
      previewId = transition.nextPreviewId;
      if (transition.action === "preview") onHover(selection);
      else onSelect(selection);
    };
    const { container } = render(
      <ProgressiveDetailLayer
        visibility={sceneVisibilityForLevel("coordinate")}
        region={null}
        city={null}
        coordinate={coordinate}
        hoveredId={null}
        selectedId={null}
        onHover={onHover}
        onActivate={onActivate}
      />,
    );
    const marker = container.querySelector(`mesh[name="detail-${coordinate.id}"]`);
    expect(marker).not.toBeNull();
    const touch = () => {
      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      fireEvent(marker!, event);
    };

    touch();
    expect(onHover).toHaveBeenCalledWith(coordinate);
    expect(onSelect).not.toHaveBeenCalled();

    touch();
    expect(onSelect).toHaveBeenCalledWith(coordinate);
  });

  it("keeps representative region, city, and coordinate controls interactive in reduced detail", () => {
    const region = COUNTRY_PROFILES.UA.regions[0];
    const city = COUNTRY_PROFILES.UA.cities[0];
    const coordinate: GeoSelection = {
      id: `${city.id}-sample-coordinate`,
      name: `Репрезентативна координата — ${city.name}`,
      level: "coordinate",
      bounds: {
        west: city.centroid.longitude,
        south: city.centroid.latitude,
        east: city.centroid.longitude,
        north: city.centroid.latitude,
      },
      centroid: city.centroid,
      breadcrumbs: city.breadcrumbs,
    };
    const onHover = vi.fn();
    const onActivate = vi.fn();
    const { container } = render(
      <ProgressiveDetailLayer
        reducedDetail
        visibility={sceneVisibilityForLevel("coordinate")}
        region={region}
        city={city}
        coordinate={coordinate}
        hoveredId={null}
        selectedId={null}
        onHover={onHover}
        onActivate={onActivate}
      />,
    );

    expect(container.querySelector('group[data-detail="reduced"]')).not.toBeNull();
    const regionMesh = container.querySelector(`mesh[name="detail-${region.id}"]`);
    const cityMesh = container.querySelector(`mesh[name="detail-${city.id}"]`);
    const coordinateMesh = container.querySelector(
      `mesh[name="detail-${coordinate.id}"]`,
    );
    expect(regionMesh).not.toBeNull();
    expect(cityMesh).not.toBeNull();
    expect(coordinateMesh).not.toBeNull();

    fireEvent.pointerOver(cityMesh!);
    fireEvent.click(coordinateMesh!);

    expect(onHover).toHaveBeenCalledWith(city);
    expect(onActivate).toHaveBeenCalledWith(coordinate, undefined, undefined);
  });
});
