"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import {
  Component,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { MathUtils, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import {
  levelForDistance,
  COUNTRY_PROFILES,
  type CountryProfile,
  type GeoLevel,
  type GeoSelection,
} from "../../lib/geography";
import type { AirAggregate, Coordinate } from "../../lib/types";
import {
  CountryLayer,
  type GlobeCountry,
  type PollutantKey,
} from "./CountryLayer";
import { GLOBE_RADIUS } from "./sphericalGeometry";
import { ProgressiveDetailLayer } from "./ProgressiveDetailLayer";
import {
  continentInteractionModel,
  normalizeCountries,
} from "./globeCountries";
import {
  INITIAL_WEBGL_RECOVERY_STATE,
  clearTouchPreview,
  detailSelectionsForLevel,
  registerWebGLContextListeners,
  sceneVisibilityForLevel,
  selectionActivationForPointer,
  shouldClearSelectionForKey,
  webGLRecoveryReducer,
} from "./globeModel";

const EMPTY_AGGREGATES: Readonly<Record<string, AirAggregate>> = Object.freeze({});
const DEFAULT_FOCUS: Coordinate = { longitude: 20, latitude: 20 };
const INITIAL_DISTANCE = 8;
// Below ~4.6 the flat-shaded low-poly country plates and base sphere show
// their facets up close (looks like shattered glass). Levels past "country"
// used to zoom to 3.8/2.7/2.04, well inside that broken zone — pulled back
// so every level stays on the good side of that threshold.
const MIN_DISTANCE = 4.6;
const MAX_DISTANCE = 13.5;

const CAMERA_DISTANCE_BY_LEVEL: Record<GeoLevel, number> = {
  world: 12.6,
  continent: 8,
  country: 5.25,
  region: 4.9,
  city: 4.75,
  coordinate: 4.6,
};

export const cameraTargetForSelection = (selection: GeoSelection) => ({
  coordinate: selection.centroid,
  distance: CAMERA_DISTANCE_BY_LEVEL[selection.level],
  level: selection.level,
});

const LEVEL_LABELS: Record<GeoLevel, string> = {
  world: "світ",
  continent: "континент",
  country: "країна",
  region: "регіон",
  city: "місто",
  coordinate: "координата",
};

type CountryTopology = Topology<{
  countries: GeometryCollection<{ name?: string }>;
}>;

type AirQualityGlobeProps = {
  hoveredSelection?: GeoSelection | null;
  selectedSelection?: GeoSelection | null;
  selectedPollutant?: PollutantKey;
  aggregatesBySelection?: Readonly<Record<string, AirAggregate>>;
  onHover: (selection: GeoSelection | null) => void;
  onSelect: (selection: GeoSelection | null) => void;
  onLevelChange?: (level: GeoLevel) => void;
  onGeographyReady?: (selections: readonly GeoSelection[]) => void;
};

export type AirQualityGlobeHandle = {
  focusSelection: (selection: GeoSelection) => void;
  focusCoordinate: (coordinate: Coordinate, level?: GeoLevel) => void;
  reset: () => void;
};

type CameraActions = AirQualityGlobeHandle & {
  zoomBy: (factor: number) => void;
};

const coordinateDirection = ({ longitude, latitude }: Coordinate) => {
  const safeLatitude = MathUtils.clamp(latitude, -90, 90);
  const wrappedLongitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  const longitudeRadians = MathUtils.degToRad(wrappedLongitude);
  const latitudeRadians = MathUtils.degToRad(safeLatitude);
  const latitudeRadius = Math.cos(latitudeRadians);
  return new Vector3(
    latitudeRadius * Math.cos(longitudeRadians),
    Math.sin(latitudeRadians),
    -latitudeRadius * Math.sin(longitudeRadians),
  ).normalize();
};

const INITIAL_CAMERA_POSITION = coordinateDirection(DEFAULT_FOCUS)
  .multiplyScalar(INITIAL_DISTANCE)
  .toArray() as [number, number, number];

const slerpDirection = (start: Vector3, end: Vector3, amount: number) => {
  const dot = MathUtils.clamp(start.dot(end), -1, 1);
  const angle = Math.acos(dot);
  if (angle < 0.00001) return start.clone();
  if (Math.PI - angle < 0.00001) {
    const reference =
      Math.abs(start.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const perpendicular = new Vector3().crossVectors(start, reference).normalize();
    return start
      .clone()
      .multiplyScalar(Math.cos(Math.PI * amount))
      .add(perpendicular.multiplyScalar(Math.sin(Math.PI * amount)))
      .normalize();
  }
  const denominator = Math.sin(angle);
  return start
    .clone()
    .multiplyScalar(Math.sin((1 - amount) * angle) / denominator)
    .add(end.clone().multiplyScalar(Math.sin(amount * angle) / denominator))
    .normalize();
};

const useReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reducedMotion;
};

const useConstrainedDevice = () => {
  const [constrained, setConstrained] = useState(false);

  useEffect(() => {
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory;
    const reducedData =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-data: reduce)")
        : null;
    const update = () =>
      setConstrained(
        Boolean(reducedData?.matches) || Boolean(deviceMemory && deviceMemory <= 4),
      );

    update();
    reducedData?.addEventListener("change", update);
    return () => reducedData?.removeEventListener("change", update);
  }, []);

  return constrained;
};

type CameraAnimation = {
  elapsed: number;
  duration: number;
  startDirection: Vector3;
  targetDirection: Vector3;
  startDistance: number;
  targetDistance: number;
};

export function CameraRig({
  actionsRef,
  reducedMotion,
  onLevelChange,
  onInteractionStart,
}: {
  actionsRef: MutableRefObject<CameraActions | null>;
  reducedMotion: boolean;
  onLevelChange: (level: GeoLevel) => void;
  onInteractionStart: () => void;
}) {
  const { camera, invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const animation = useRef<CameraAnimation | null>(null);
  const lastLevel = useRef<GeoLevel | null>(null);

  const reportLevel = useCallback(() => {
    const nextLevel = levelForDistance(camera.position.length());
    if (lastLevel.current !== nextLevel) {
      lastLevel.current = nextLevel;
      onLevelChange(nextLevel);
    }
  }, [camera, onLevelChange]);

  const moveTo = useCallback(
    (direction: Vector3, distance: number) => {
      const targetDistance = MathUtils.clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
      if (reducedMotion) {
        camera.position.copy(direction.clone().multiplyScalar(targetDistance));
        camera.lookAt(0, 0, 0);
        controlsRef.current?.update();
        reportLevel();
        invalidate();
        return;
      }

      animation.current = {
        elapsed: 0,
        duration: 0.72,
        startDirection: camera.position.clone().normalize(),
        targetDirection: direction.clone().normalize(),
        startDistance: camera.position.length(),
        targetDistance,
      };
      invalidate();
    },
    [camera, invalidate, reducedMotion, reportLevel],
  );

  useEffect(() => {
    actionsRef.current = {
      focusCoordinate: (coordinate, targetLevel = "city") =>
        moveTo(
          coordinateDirection(coordinate),
          CAMERA_DISTANCE_BY_LEVEL[targetLevel],
        ),
      focusSelection: (selection) => {
        const target = cameraTargetForSelection(selection);
        moveTo(coordinateDirection(target.coordinate), target.distance);
      },
      reset: () => moveTo(coordinateDirection(DEFAULT_FOCUS), INITIAL_DISTANCE),
      zoomBy: (factor) =>
        moveTo(
          camera.position.clone().normalize(),
          camera.position.length() * factor,
        ),
    };
    reportLevel();
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, camera, moveTo, reportLevel]);

  useFrame((_, delta) => {
    const current = animation.current;
    if (!current) return;
    current.elapsed += Math.min(delta, 0.05);
    const progress = Math.min(1, current.elapsed / current.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const direction = slerpDirection(
      current.startDirection,
      current.targetDirection,
      eased,
    );
    const distance = MathUtils.lerp(
      current.startDistance,
      current.targetDistance,
      eased,
    );
    camera.position.copy(direction.multiplyScalar(distance));
    camera.lookAt(0, 0, 0);
    controlsRef.current?.update();
    reportLevel();
    if (progress >= 1) animation.current = null;
    else invalidate();
  });

  return (
    <>
      <PerspectiveCamera
        makeDefault
        fov={34}
        near={0.1}
        far={60}
        position={INITIAL_CAMERA_POSITION}
      />
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableDamping={false}
        minDistance={MIN_DISTANCE}
        maxDistance={MAX_DISTANCE}
        rotateSpeed={0.52}
        zoomSpeed={0.72}
        onStart={() => {
          animation.current = null;
          onInteractionStart();
        }}
        onChange={reportLevel}
      />
    </>
  );
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const reported = useRef(false);
  useFrame(() => {
    if (!reported.current) {
      reported.current = true;
      onReady();
    }
  });
  return null;
}

function WebGLContextLifecycle({
  onLost,
  onRestored,
}: {
  onLost: () => void;
  onRestored: () => void;
}) {
  const { gl } = useThree();
  useEffect(
    () => registerWebGLContextListeners(gl.domElement, onLost, onRestored),
    [gl, onLost, onRestored],
  );
  return null;
}

class WebGLBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const ContextFallback = ({ onRetry }: { onRetry: () => void }) => (
  <div
    className="absolute inset-0 z-10 grid place-items-center bg-[#111413] px-8 text-center text-sm text-stone-300"
  >
    <div>
      <p>3D-відображення недоступне. Скористайтеся списком територій нижче.</p>
      <button
        type="button"
        className="mt-4 rounded-full border border-white/20 px-4 py-2 text-white focus-visible:outline-2 focus-visible:outline-lime-300"
        onClick={onRetry}
      >
        Спробувати 3D знову
      </button>
    </div>
  </div>
);

export const globeLiveMessage = ({
  renderReady,
  recoveryStatus,
  rendererFailed = false,
}: {
  renderReady: boolean;
  recoveryStatus: "active" | "failed";
  rendererFailed?: boolean;
}) => {
  if (recoveryStatus === "failed" || rendererFailed) {
    return "3D-відображення недоступне. Скористайтеся списком територій нижче.";
  }
  return renderReady
    ? "3D-глобус готовий до взаємодії"
    : "3D-глобус завантажується";
};

export const AirQualityGlobe = forwardRef<
  AirQualityGlobeHandle,
  AirQualityGlobeProps
>(function AirQualityGlobe(
  {
    hoveredSelection = null,
    selectedSelection = null,
    selectedPollutant = "aqi",
    aggregatesBySelection = EMPTY_AGGREGATES,
    onHover,
    onSelect,
    onLevelChange,
    onGeographyReady,
  },
  ref,
) {
  const [countries, setCountries] = useState<GlobeCountry[]>([]);
  const [level, setLevel] = useState<GeoLevel>("continent");
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const [geographyStatus, setGeographyStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [geographyAttempt, setGeographyAttempt] = useState(0);
  const [recovery, dispatchRecovery] = useReducer(
    webGLRecoveryReducer,
    INITIAL_WEBGL_RECOVERY_STATE,
  );
  const [renderReady, setRenderReady] = useState(false);
  const [rendererFailed, setRendererFailed] = useState(false);
  const reducedMotion = useReducedMotion();
  const constrainedDevice = useConstrainedDevice();
  const actionsRef = useRef<CameraActions | null>(null);
  const touchPreviewId = useRef<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      focusCoordinate: (coordinate, targetLevel) =>
        actionsRef.current?.focusCoordinate(coordinate, targetLevel),
      focusSelection: (selection) =>
        actionsRef.current?.focusSelection(selection),
      reset: () => actionsRef.current?.reset(),
    }),
    [],
  );

  useEffect(() => {
    const abortController = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/countries-110m.json`, {
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Country geography is unavailable");
        return response.json() as Promise<CountryTopology>;
      })
      .then((topology) => {
        if (!topology?.objects?.countries) {
          throw new Error("Country geography has an invalid shape");
        }
        const decoded = feature(
          topology,
          topology.objects.countries,
        ) as unknown as FeatureCollection<Geometry, { name?: string }>;
        const normalized = normalizeCountries(decoded);
        if (normalized.length === 0) {
          throw new Error("Country geography is empty");
        }
        setCountries(normalized);
        setGeographyStatus("ready");
        onGeographyReady?.(normalized.map(({ selection }) => selection));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setCountries([]);
          setGeographyStatus("error");
        }
      });
    return () => abortController.abort();
  }, [geographyAttempt, onGeographyReady]);

  const clearSharedTouchPreview = useCallback(() => {
    touchPreviewId.current = clearTouchPreview(touchPreviewId.current);
  }, []);

  const clearTransientInteraction = useCallback(() => {
    clearSharedTouchPreview();
    onHover(null);
  }, [clearSharedTouchPreview, onHover]);

  const handleSceneActivation = useCallback(
    (selection: GeoSelection, pointerType: string, pointerDelta: number) => {
      const transition = selectionActivationForPointer(
        touchPreviewId.current,
        selection.id,
        pointerType,
        pointerDelta,
      );
      touchPreviewId.current = transition.nextPreviewId;
      if (transition.action === "preview") onHover(selection);
      else if (transition.action === "select") onSelect(selection);
    },
    [onHover, onSelect],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldClearSelectionForKey(event.key)) return;
      clearSharedTouchPreview();
      onHover(null);
      onSelect(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSharedTouchPreview, onHover, onSelect]);

  const handleLevelChange = useCallback(
    (nextLevel: GeoLevel) => {
      setLevel(nextLevel);
      onLevelChange?.(nextLevel);
    },
    [onLevelChange],
  );

  const visibility = sceneVisibilityForLevel(level);
  const selectedProfile = useMemo<CountryProfile | undefined>(() => {
    if (!selectedSelection) return undefined;
    return Object.values(COUNTRY_PROFILES).find(({ selection }) =>
      selectedSelection.breadcrumbs.some(({ id }) => id === selection.id),
    );
  }, [selectedSelection]);
  const selectedCountry = useMemo(
    () =>
      countries.find(({ selection }) =>
        selectedSelection
          ? selectedSelection.id === selection.id ||
            selectedSelection.breadcrumbs.some(({ id }) => id === selection.id)
          : false,
      )?.selection,
    [countries, selectedSelection],
  );
  const details = detailSelectionsForLevel(
    level,
    selectedProfile,
    selectedCountry,
    selectedSelection,
  );
  const continentModel = useMemo(
    () => continentInteractionModel(countries),
    [countries],
  );

  const retryWebGL = useCallback(() => {
    setRenderReady(false);
    setRendererFailed(false);
    dispatchRecovery({ type: "retry" });
  }, []);
  const handleWebGLContextLost = useCallback(
    () => {
      setRenderReady(false);
      dispatchRecovery({ type: "lost" });
    },
    [],
  );
  const handleWebGLContextRestored = useCallback(
    () => {
      setRenderReady(false);
      dispatchRecovery({ type: "retry" });
    },
    [],
  );

  const activeCountry = countries[keyboardIndex] ?? null;
  const moveTerritory = (direction: -1 | 1) => {
    if (countries.length === 0) return;
    const nextIndex =
      (keyboardIndex + direction + countries.length) % countries.length;
    const nextCountry = countries[nextIndex];
    setKeyboardIndex(nextIndex);
    onHover(nextCountry.selection);
    actionsRef.current?.focusSelection(nextCountry.selection);
  };

  const activateCountry = (country: GlobeCountry) => {
    const nextIndex = countries.findIndex(({ id }) => id === country.id);
    if (nextIndex >= 0) setKeyboardIndex(nextIndex);
    clearSharedTouchPreview();
    onHover(country.selection);
    onSelect(country.selection);
    actionsRef.current?.focusSelection(country.selection);
  };

  const activateSelection = (selection: GeoSelection) => {
    clearSharedTouchPreview();
    onHover(selection);
    onSelect(selection);
    actionsRef.current?.focusSelection(selection);
  };

  const fallback = <ContextFallback onRetry={retryWebGL} />;
  const liveMessage = globeLiveMessage({
    renderReady,
    recoveryStatus: recovery.status,
    rendererFailed,
  });

  return (
    <section
      role="region"
      aria-label="Інтерактивний глобус"
      data-motion={reducedMotion ? "reduced" : "full"}
      data-detail={constrainedDevice ? "constrained" : "full"}
      className="relative isolate min-h-[62vh] overflow-hidden bg-[#111413] text-stone-100 sm:min-h-[78vh] lg:min-h-screen"
    >
      <h2 className="sr-only">Інтерактивний глобус</h2>
      <p className="absolute left-4 top-20 z-20 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-stone-300 backdrop-blur">
        {`Рівень: ${LEVEL_LABELS[level]}`}
      </p>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Стан 3D-глобуса"
      >
        {liveMessage}
      </p>

      <div className="absolute inset-0">
        <WebGLBoundary
          key={recovery.generation}
          fallback={fallback}
          onError={() => {
            setRenderReady(false);
            setRendererFailed(true);
          }}
        >
          <Canvas
            dpr={constrainedDevice ? [1, 1] : [1, 1.5]}
            frameloop="demand"
            gl={{
              alpha: false,
              antialias: !constrainedDevice,
              powerPreference: "high-performance",
            }}
            style={{ touchAction: "none" }}
            fallback={fallback}
            onPointerLeave={clearTransientInteraction}
            onPointerMissed={clearTransientInteraction}
          >
            <WebGLContextLifecycle
              onLost={handleWebGLContextLost}
              onRestored={handleWebGLContextRestored}
            />
            <color attach="background" args={["#111413"]} />
            <ambientLight intensity={0.72} />
            <directionalLight position={[4.5, 5.5, 6]} intensity={2.15} />
            <directionalLight
              position={[-5, -2, -3]}
              intensity={0.42}
              color="#80988c"
            />
            <mesh>
              <sphereGeometry
                args={[
                  GLOBE_RADIUS,
                  constrainedDevice ? 48 : 72,
                  constrainedDevice ? 32 : 48,
                ]}
              />
              <meshStandardMaterial
                color="#18201f"
                roughness={0.5}
                metalness={0.14}
              />
            </mesh>
            <CountryLayer
              countries={countries}
              hoveredId={hoveredSelection?.id ?? null}
              selectedId={selectedSelection?.id ?? null}
              aggregatesBySelection={aggregatesBySelection}
              selectedPollutant={selectedPollutant}
              reducedMotion={reducedMotion}
              interactive={
                visibility.interactionLevel === "continent" ||
                visibility.interactionLevel === "country"
              }
              interactionSelectionsByCountry={
                visibility.showContinentGroups
                  ? continentModel.interactionSelectionsByCountry
                  : undefined
              }
              onHover={onHover}
              onActivate={handleSceneActivation}
            />
            <ProgressiveDetailLayer
              reducedDetail={constrainedDevice}
              visibility={visibility}
              region={details.region}
              city={details.city}
              coordinate={details.coordinate}
              hoveredId={hoveredSelection?.id ?? null}
              selectedId={selectedSelection?.id ?? null}
              aggregatesBySelection={aggregatesBySelection}
              onHover={onHover}
              onActivate={handleSceneActivation}
            />
            <CameraRig
              actionsRef={actionsRef}
              reducedMotion={reducedMotion}
              onLevelChange={handleLevelChange}
              onInteractionStart={clearTransientInteraction}
            />
            <FirstFrame onReady={() => setRenderReady(true)} />
          </Canvas>
        </WebGLBoundary>
        {recovery.status === "failed" ? fallback : null}
      </div>

      <div
        className="absolute right-4 top-4 z-20 flex flex-col gap-2"
        aria-label="Керування масштабом"
      >
        <button
          type="button"
          className="grid size-10 place-items-center rounded-full border border-white/15 bg-black/45 text-xl backdrop-blur transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
          aria-label="Збільшити масштаб"
          onClick={() => actionsRef.current?.zoomBy(0.78)}
        >
          +
        </button>
        <button
          type="button"
          className="grid size-10 place-items-center rounded-full border border-white/15 bg-black/45 text-xl backdrop-blur transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
          aria-label="Зменшити масштаб"
          onClick={() => actionsRef.current?.zoomBy(1.28)}
        >
          −
        </button>
        <button
          type="button"
          className="grid size-10 place-items-center rounded-full border border-white/15 bg-black/45 text-[10px] font-semibold uppercase tracking-wider backdrop-blur transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300"
          aria-label="Повернути початковий вигляд"
          onClick={() => actionsRef.current?.reset()}
        >
          0°
        </button>
      </div>

      <aside className="absolute inset-x-3 bottom-3 z-20 rounded-2xl border border-white/10 bg-black/55 p-3 backdrop-blur-md sm:inset-x-auto sm:left-4 sm:w-80">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-lime-300"
            onClick={() => moveTerritory(-1)}
            disabled={countries.length === 0}
          >
            ← Попередня
          </button>
          <span className="min-w-0 truncate text-xs text-stone-300">
            {activeCountry?.name ?? "Завантаження територій…"}
          </span>
          <button
            type="button"
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-lime-300"
            onClick={() => moveTerritory(1)}
            disabled={countries.length === 0}
          >
            Наступна →
          </button>
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-[0.15em] text-stone-500">
          Території — активуйте для вибору
        </p>
        {visibility.showContinentGroups ? (
          <div className="mt-2 border-t border-white/10 pt-2">
            <p className="text-[11px] text-stone-400">
              Усі сім континентальних груп доступні для вибору.
            </p>
            <ul
              aria-label="Репрезентативні континентальні групи"
              className="mt-1 flex flex-wrap gap-1"
            >
              {continentModel.choices.map((selection) => (
                <li key={selection.id}>
                  <button
                    type="button"
                    className="rounded-full border border-white/10 px-2 py-1 text-xs text-stone-300 focus-visible:outline-2 focus-visible:outline-lime-300"
                    onFocus={() => onHover(selection)}
                    onClick={() => activateSelection(selection)}
                  >
                    {selection.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {details.region || details.city || details.coordinate ? (
          <div
            className="mt-2 border-t border-white/10 pt-2"
            aria-label="Репрезентативні детальні рівні"
          >
            <p className="text-[11px] text-stone-400">{details.disclosure}</p>
            <ul className="mt-1 space-y-1">
              {[details.region, details.city, details.coordinate]
                .filter((selection): selection is GeoSelection => Boolean(selection))
                .map((selection) => (
                  <li key={selection.id}>
                    <button
                      type="button"
                      className="w-full rounded border border-white/10 px-2 py-1 text-left text-xs text-stone-300 focus-visible:outline-2 focus-visible:outline-lime-300"
                      onFocus={() => onHover(selection)}
                      onClick={() => activateSelection(selection)}
                    >
                      {selection.level === "region"
                        ? `Репрезентативне покриття (межі): ${selection.name}`
                        : selection.name}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
        <ul
          aria-label="Доступні території"
          className="mt-1.5 max-h-24 space-y-0.5 overflow-y-auto pr-1 text-sm [scrollbar-color:#666_transparent]"
        >
          {geographyStatus === "loading" ? (
            <li className="py-2 text-stone-400">Географія завантажується…</li>
          ) : geographyStatus === "error" ? (
            <li className="py-2 text-stone-300">
              <p>Не вдалося завантажити географію.</p>
              <button
                type="button"
                className="mt-2 rounded-full border border-white/15 px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-lime-300"
                onClick={() => {
                  setGeographyStatus("loading");
                  setGeographyAttempt((attempt) => attempt + 1);
                }}
              >
                Повторити завантаження географії
              </button>
            </li>
          ) : (
            countries.map((country, index) => (
              <li key={country.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-stone-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-lime-300"
                  aria-current={
                    selectedSelection?.id === country.id ? "true" : undefined
                  }
                  onFocus={() => setKeyboardIndex(index)}
                  onClick={() => activateCountry(country)}
                >
                  {country.name}
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>
    </section>
  );
});
