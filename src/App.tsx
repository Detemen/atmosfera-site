import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import type { AirQualityGlobeHandle } from "../components/globe/AirQualityGlobe";
import type { PollutantKey } from "../components/globe/CountryLayer";
import { AirPanel } from "../components/ui/AirPanel";
import { fetchAirQuality } from "../lib/air-quality";
import { demoAggregateFor } from "../lib/demo-data";
import {
  GeographyRepository,
  WORLD_SAMPLE_POINTS,
  sampleSelection,
  searchSelectionForGeocoding,
  selectionAggregateKey,
  WORLD_SELECTION,
  type GeocodingIdentity,
  type GeoBreadcrumb,
  type GeoLevel,
  type GeoSelection,
} from "../lib/geography";
import type { AirAggregate } from "../lib/types";

const AirQualityGlobe = lazy(() =>
  import("../components/globe/AirQualityGlobe").then((module) => ({
    default: module.AirQualityGlobe,
  })),
);

const WORLD_POINTS = WORLD_SAMPLE_POINTS.map(({ latitude, longitude }) => ({
  latitude,
  longitude,
}));

type SelectionState = {
  hovered: GeoSelection | null;
  pinned: GeoSelection | null;
};

type SelectionAction =
  | { type: "hover"; selection: GeoSelection | null }
  | { type: "select"; selection: GeoSelection | null }
  | { type: "toggle-pin"; selection: GeoSelection };

export const reduceSelectionState = (
  state: SelectionState,
  action: SelectionAction,
): SelectionState => {
  if (action.type === "hover") {
    return { ...state, hovered: action.selection };
  }
  if (action.type === "select") {
    return { hovered: action.selection, pinned: action.selection };
  }
  return {
    hovered: state.hovered,
    pinned:
      state.pinned?.id === action.selection.id ? null : action.selection,
  };
};

export default function Home() {
  const globeRef = useRef<AirQualityGlobeHandle>(null);
  const [geographyRepository] = useState(() => new GeographyRepository());
  const [{ hovered: hoveredSelection, pinned: pinnedSelection }, dispatchSelection] =
    useReducer(reduceSelectionState, { hovered: null, pinned: null });
  const [level, setLevel] = useState<GeoLevel>("continent");
  const [pollutant, setPollutant] = useState<PollutantKey>("aqi");
  const [aggregateState, setAggregateState] = useState<{
    selectionId: string;
    aggregate: AirAggregate;
  }>(() => ({
    selectionId: WORLD_SELECTION.id,
    aggregate: demoAggregateFor(WORLD_POINTS),
  }));
  const [worldAggregate, setWorldAggregate] = useState<AirAggregate>(() =>
    demoAggregateFor(WORLD_POINTS),
  );
  const [aggregatesBySelection, setAggregatesBySelection] = useState<
    Record<string, AirAggregate>
  >(() => ({
    [selectionAggregateKey(WORLD_SELECTION)]: demoAggregateFor(WORLD_POINTS),
  }));

  const activeSelection =
    hoveredSelection ?? pinnedSelection ?? WORLD_SELECTION;
  const samplePoints = useMemo(
    () =>
      activeSelection.id === WORLD_SELECTION.id
        ? WORLD_POINTS
        : activeSelection.level === "coordinate"
          ? [activeSelection.centroid]
          : sampleSelection(activeSelection, 6),
    [activeSelection],
  );
  const loading = aggregateState.selectionId !== activeSelection.id;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      const nextAggregate = await fetchAirQuality(
        samplePoints,
        (input, init) =>
          fetch(input, { ...init, signal: controller.signal }),
      );
      if (cancelled) return;

      setAggregateState({
        selectionId: activeSelection.id,
        aggregate: nextAggregate,
      });
      if (activeSelection.id === WORLD_SELECTION.id) {
        setWorldAggregate(nextAggregate);
      }

      setAggregatesBySelection((current) => ({
        ...current,
        [selectionAggregateKey(activeSelection)]: nextAggregate,
      }));
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeSelection, samplePoints]);

  const handleHover = useCallback((selection: GeoSelection | null) => {
    dispatchSelection({ type: "hover", selection });
  }, []);

  const handleSelect = useCallback((selection: GeoSelection | null) => {
    dispatchSelection({ type: "select", selection });
  }, []);

  const handlePin = useCallback(() => {
    if (activeSelection.id === WORLD_SELECTION.id) return;
    dispatchSelection({ type: "toggle-pin", selection: activeSelection });
  }, [activeSelection]);

  const handleSearchResult = useCallback(
    (result: GeocodingIdentity) => {
      const hierarchy = searchSelectionForGeocoding(
        result,
        geographyRepository,
      );
      geographyRepository.registerSelections(hierarchy.selections);
      dispatchSelection({ type: "select", selection: hierarchy.selection });
      globeRef.current?.focusSelection(hierarchy.selection);
    },
    [geographyRepository],
  );

  const handleGeographyReady = useCallback(
    (selections: readonly GeoSelection[]) => {
      geographyRepository.registerSelections(selections);
    },
    [geographyRepository],
  );

  const handleBreadcrumbSelect = useCallback(
    (breadcrumb: GeoBreadcrumb) => {
      const selection = geographyRepository.resolveBreadcrumb(
        breadcrumb,
        activeSelection,
      );
      if (!selection) return;
      if (selection.id === WORLD_SELECTION.id) {
        dispatchSelection({ type: "select", selection: null });
        globeRef.current?.focusSelection(WORLD_SELECTION);
        return;
      }

      dispatchSelection({ type: "select", selection });
      globeRef.current?.focusSelection(selection);
    },
    [activeSelection, geographyRepository],
  );

  return (
    <main className="air-shell">
      <Suspense
        fallback={
          <div role="status" className="air-globe-loading">
            3D-глобус завантажується…
          </div>
        }
      >
        <AirQualityGlobe
          ref={globeRef}
          hoveredSelection={hoveredSelection}
          selectedSelection={pinnedSelection}
          selectedPollutant={pollutant}
          aggregatesBySelection={aggregatesBySelection}
          onHover={handleHover}
          onSelect={handleSelect}
          onLevelChange={setLevel}
          onGeographyReady={handleGeographyReady}
        />
      </Suspense>
      <AirPanel
        aggregate={aggregateState.aggregate}
        aggregateSelectionId={aggregateState.selectionId}
        worldAggregate={worldAggregate}
        selection={
          activeSelection.id === WORLD_SELECTION.id ? null : activeSelection
        }
        level={level}
        pollutant={pollutant}
        loading={loading}
        pinned={pinnedSelection?.id === activeSelection.id}
        requestedSampleCount={samplePoints.length}
        onBreadcrumbSelect={handleBreadcrumbSelect}
        onPin={handlePin}
        onPollutantChange={setPollutant}
        onSearchResult={handleSearchResult}
      />
    </main>
  );
}
