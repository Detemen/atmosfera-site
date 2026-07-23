import { describe, expect, it } from "vitest";

import {
  DETAIL_MARKER_CONFIG,
  INITIAL_WEBGL_RECOVERY_STATE,
  clearTouchPreview,
  detailSelectionsForLevel,
  selectionActivationForPointer,
  sceneVisibilityForLevel,
  shouldClearSelectionForKey,
  transitionTouchPreview,
  webGLRecoveryReducer,
} from "../components/globe/globeModel";
import { COUNTRY_PROFILES } from "../lib/geography";

describe("progressive globe scene model", () => {
  it.each([
    ["continent", true, false, false, false, false],
    ["country", false, true, false, false, false],
    ["region", false, true, true, false, false],
    ["city", false, true, true, true, false],
    ["coordinate", false, true, true, true, true],
  ] as const)(
    "materially changes rendered layers at %s level",
    (
      level,
      showContinentGroups,
      showCountryPlates,
      showRegionCoverage,
      showCityMark,
      showCoordinateMark,
    ) => {
      expect(sceneVisibilityForLevel(level)).toMatchObject({
        showContinentGroups,
        showCountryPlates,
        showRegionCoverage,
        showCityMark,
        showCoordinateMark,
      });
    },
  );

  it("exposes representative region, city, and sampled-coordinate selections", () => {
    const details = detailSelectionsForLevel("coordinate", COUNTRY_PROFILES.UA);

    expect(details.region?.name).toBe("Київська область");
    expect(details.city?.name).toBe("Київ");
    expect(details.coordinate).toMatchObject({
      level: "coordinate",
      centroid: COUNTRY_PROFILES.UA.cities[0].centroid,
    });
    expect(details.disclosure).toContain("репрезентатив");
  });

  it("retains representative coordinate detail for an uncurated country", () => {
    const country = {
      id: "032",
      name: "Argentina",
      level: "country" as const,
      bounds: { west: -73.6, south: -55.1, east: -53.6, north: -21.8 },
      centroid: { longitude: -64.0, latitude: -34.0 },
      breadcrumbs: [
        { id: "world", name: "Світ", level: "world" as const },
        { id: "032", name: "Argentina", level: "country" as const },
      ],
    };

    const details = detailSelectionsForLevel("coordinate", undefined, country);

    expect(details.region).toBeNull();
    expect(details.city).toBeNull();
    expect(details.coordinate).toMatchObject({
      level: "coordinate",
      centroid: country.centroid,
      name: "Репрезентативна координата — Argentina",
    });
  });

  it("places the coordinate mark above the city mark for shared coordinates", () => {
    expect(DETAIL_MARKER_CONFIG.coordinate.radialOffset).toBeGreaterThan(
      DETAIL_MARKER_CONFIG.city.radialOffset,
    );
    expect(DETAIL_MARKER_CONFIG.coordinate.size).toBeLessThan(
      DETAIL_MARKER_CONFIG.city.size,
    );
  });
});

describe("globe interaction state", () => {
  it("previews the first touch and selects the second touch", () => {
    const first = transitionTouchPreview(null, "UA");
    const second = transitionTouchPreview(first.nextPreviewId, "UA");

    expect(first).toEqual({ action: "preview", nextPreviewId: "UA" });
    expect(second).toEqual({ action: "select", nextPreviewId: null });
  });

  it("starts a new preview when the second touch targets another territory", () => {
    expect(transitionTouchPreview("UA", "JP")).toEqual({
      action: "preview",
      nextPreviewId: "JP",
    });
  });

  it("shares first-touch preview and second-touch selection across detail ids", () => {
    const first = selectionActivationForPointer(null, "ua-kyiv", "touch");
    const retargeted = selectionActivationForPointer(
      first.nextPreviewId,
      "ua-kyiv-sample-coordinate",
      "touch",
    );
    const second = selectionActivationForPointer(
      retargeted.nextPreviewId,
      "ua-kyiv-sample-coordinate",
      "touch",
    );

    expect(first.action).toBe("preview");
    expect(retargeted.action).toBe("preview");
    expect(second).toEqual({ action: "select", nextPreviewId: null });
  });

  it("selects immediately for a mouse activation and clears touch preview", () => {
    expect(selectionActivationForPointer("ua-kyiv", "ua-kyiv", "mouse")).toEqual(
      { action: "select", nextPreviewId: null },
    );
  });

  it("ignores a territory activation when the pointer moved during a drag", () => {
    expect(selectionActivationForPointer(null, "UA", "mouse", 24)).toEqual({
      action: "ignore",
      nextPreviewId: null,
    });
    expect(selectionActivationForPointer(null, "UA", "touch", 24)).toEqual({
      action: "ignore",
      nextPreviewId: null,
    });
  });

  it("recognizes Escape as pinned-selection clear behavior", () => {
    expect(shouldClearSelectionForKey("Escape")).toBe(true);
    expect(shouldClearSelectionForKey("Enter")).toBe(false);
  });

  it("clears touch preview on an empty-surface event", () => {
    expect(clearTouchPreview("UA")).toBeNull();
  });
});

describe("WebGL recovery state", () => {
  it("moves from failure to a remounted active canvas on retry", () => {
    const failed = webGLRecoveryReducer(INITIAL_WEBGL_RECOVERY_STATE, {
      type: "lost",
    });
    const retried = webGLRecoveryReducer(failed, { type: "retry" });

    expect(failed).toEqual({ status: "failed", generation: 0 });
    expect(retried).toEqual({ status: "active", generation: 1 });
  });

  it("recovers the existing canvas when the browser restores its context", () => {
    const failed = webGLRecoveryReducer(INITIAL_WEBGL_RECOVERY_STATE, {
      type: "lost",
    });

    expect(webGLRecoveryReducer(failed, { type: "restored" })).toEqual({
      status: "active",
      generation: 0,
    });
  });
});
