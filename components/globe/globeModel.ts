import type {
  CountryProfile,
  GeoLevel,
  GeoSelection,
} from "../../lib/geography";

export type SceneVisibility = {
  interactionLevel: "continent" | "country" | "region" | "city" | "coordinate";
  showContinentGroups: boolean;
  showCountryPlates: boolean;
  showRegionCoverage: boolean;
  showCityMark: boolean;
  showCoordinateMark: boolean;
};

export const sceneVisibilityForLevel = (level: GeoLevel): SceneVisibility => {
  if (level === "world" || level === "continent") {
    return {
      interactionLevel: "continent",
      showContinentGroups: true,
      showCountryPlates: false,
      showRegionCoverage: false,
      showCityMark: false,
      showCoordinateMark: false,
    };
  }

  return {
    interactionLevel: level,
    showContinentGroups: false,
    showCountryPlates: true,
    showRegionCoverage: ["region", "city", "coordinate"].includes(level),
    showCityMark: ["city", "coordinate"].includes(level),
    showCoordinateMark: level === "coordinate",
  };
};

export type ProgressiveDetailSelections = {
  region: GeoSelection | null;
  city: GeoSelection | null;
  coordinate: GeoSelection | null;
  disclosure: string;
};

export const DETAIL_MARKER_CONFIG = {
  city: { radialOffset: 0.13, size: 0.036 },
  coordinate: { radialOffset: 0.19, size: 0.022 },
} as const;

export const detailSelectionsForLevel = (
  level: GeoLevel,
  profile?: CountryProfile,
  fallbackCountry?: GeoSelection,
  selectedSelection?: GeoSelection | null,
): ProgressiveDetailSelections => {
  const visibility = sceneVisibilityForLevel(level);
  const exactRegion =
    selectedSelection?.level === "region" ? selectedSelection : null;
  const exactCity =
    selectedSelection?.level === "city" ? selectedSelection : null;
  const exactCoordinate =
    selectedSelection?.level === "coordinate" ? selectedSelection : null;
  const region = visibility.showRegionCoverage
    ? exactRegion ?? profile?.regions[0] ?? null
    : null;
  const city = visibility.showCityMark
    ? exactCity ?? profile?.cities[0] ?? null
    : null;
  const coordinateSource = exactCity ?? city ?? fallbackCountry ?? null;
  const coordinate =
    visibility.showCoordinateMark && exactCoordinate
      ? exactCoordinate
      : visibility.showCoordinateMark && coordinateSource
      ? {
          id: `${coordinateSource.id}-sample-coordinate`,
          name: `Репрезентативна координата — ${coordinateSource.name}`,
          level: "coordinate" as const,
          bounds: {
            west: coordinateSource.centroid.longitude,
            south: coordinateSource.centroid.latitude,
            east: coordinateSource.centroid.longitude,
            north: coordinateSource.centroid.latitude,
          },
          centroid: coordinateSource.centroid,
          breadcrumbs: [
            ...coordinateSource.breadcrumbs,
            {
              id: `${coordinateSource.id}-sample-coordinate`,
              name: "Репрезентативна координата",
              level: "coordinate" as const,
            },
          ],
        }
      : null;

  return {
    region,
    city,
    coordinate,
    disclosure:
      "Рівні регіону, міста й координати є репрезентативними, а не вичерпним адміністративним набором.",
  };
};

export type TouchPreviewTransition = {
  action: "preview" | "select" | "ignore";
  nextPreviewId: string | null;
};

const MAX_SELECTION_CLICK_DELTA = 6;

export const transitionTouchPreview = (
  currentPreviewId: string | null,
  targetId: string,
): TouchPreviewTransition =>
  currentPreviewId === targetId
    ? { action: "select", nextPreviewId: null }
    : { action: "preview", nextPreviewId: targetId };

export const selectionActivationForPointer = (
  currentPreviewId: string | null,
  targetId: string,
  pointerType: string,
  pointerDelta = 0,
): TouchPreviewTransition =>
  pointerDelta > MAX_SELECTION_CLICK_DELTA
    ? { action: "ignore", nextPreviewId: null }
    : pointerType === "touch"
    ? transitionTouchPreview(currentPreviewId, targetId)
    : { action: "select", nextPreviewId: null };

export const clearTouchPreview = (currentPreviewId: string | null) => {
  void currentPreviewId;
  return null;
};

export const shouldClearSelectionForKey = (key: string) => key === "Escape";

export type WebGLRecoveryState = {
  status: "active" | "failed";
  generation: number;
};

export type WebGLRecoveryEvent =
  | { type: "lost" }
  | { type: "restored" }
  | { type: "retry" };

export const INITIAL_WEBGL_RECOVERY_STATE: WebGLRecoveryState = {
  status: "active",
  generation: 0,
};

export const webGLRecoveryReducer = (
  state: WebGLRecoveryState,
  event: WebGLRecoveryEvent,
): WebGLRecoveryState => {
  if (event.type === "lost") return { ...state, status: "failed" };
  if (event.type === "retry") {
    return { status: "active", generation: state.generation + 1 };
  }
  return { ...state, status: "active" };
};

export const registerWebGLContextListeners = (
  canvas: HTMLCanvasElement,
  onLost: () => void,
  onRestored: () => void,
) => {
  const handleLost = (event: Event) => {
    event.preventDefault();
    onLost();
  };
  const handleRestored = () => onRestored();
  canvas.addEventListener("webglcontextlost", handleLost);
  canvas.addEventListener("webglcontextrestored", handleRestored);
  return () => {
    canvas.removeEventListener("webglcontextlost", handleLost);
    canvas.removeEventListener("webglcontextrestored", handleRestored);
  };
};
