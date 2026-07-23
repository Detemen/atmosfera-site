"use client";

import { Edges } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { MathUtils, Mesh, MeshStandardMaterial } from "three";

import { aqiCategory } from "../../lib/air-quality";
import {
  selectionAggregateKey,
  type CountryGeometry,
  type GeoSelection,
} from "../../lib/geography";
import type { AirAggregate } from "../../lib/types";
import {
  BASE_PLATE_ELEVATION,
  GLOBE_RADIUS,
  HOVERED_PLATE_ELEVATION,
  SELECTED_PLATE_ELEVATION,
  createSphericalPlateGeometry,
} from "./sphericalGeometry";

export type PollutantKey = "aqi" | "pm25" | "pm10" | "no2" | "o3";

export type GlobeCountry = {
  id: string;
  name: string;
  sourceNumericId: string | null;
  geometry: CountryGeometry;
  selection: GeoSelection;
};

type CountryLayerProps = {
  countries: readonly GlobeCountry[];
  hoveredId: string | null;
  selectedId: string | null;
  aggregatesBySelection: Readonly<Record<string, AirAggregate>>;
  selectedPollutant: PollutantKey;
  reducedMotion: boolean;
  interactive: boolean;
  interactionSelectionsByCountry?: Readonly<Record<string, GeoSelection>>;
  onHover: (selection: GeoSelection | null) => void;
  onActivate: (
    selection: GeoSelection,
    pointerType: string,
    pointerDelta: number,
  ) => void;
};

type CountryPlateProps = {
  country: GlobeCountry;
  aggregate?: AirAggregate;
  selectedPollutant: PollutantKey;
  selected: boolean;
  interactive: boolean;
  registerMesh: (id: string, mesh: Mesh | null) => void;
  onHover: (selection: GeoSelection | null) => void;
  onActivate: (
    selection: GeoSelection,
    pointerType: string,
    pointerDelta: number,
  ) => void;
};

const CountryPlate = memo(function CountryPlate({
  country,
  aggregate,
  selectedPollutant,
  selected,
  interactive,
  registerMesh,
  onHover,
  onActivate,
}: CountryPlateProps) {
  const geometry = useMemo(
    () => createSphericalPlateGeometry(country.geometry),
    [country.geometry],
  );
  const hasAggregate = Boolean(aggregate);
  const accent = aggregate ? aqiCategory(aggregate.aqi).color : "#111617";
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#77766f",
        roughness: 0.86,
        metalness: 0.04,
        emissive: accent,
        emissiveIntensity: hasAggregate ? 0.18 : 0.035,
      }),
    [accent, hasAggregate],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const handleActivate = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const pointerType = (event.nativeEvent as PointerEvent).pointerType;
    onActivate(country.selection, pointerType, event.delta);
  };

  return (
    <mesh
      ref={(mesh) => registerMesh(country.id, mesh)}
      geometry={geometry}
      material={material}
      userData={{
        countryId: country.id,
        pollutant: selectedPollutant,
        value: aggregate?.[selectedPollutant] ?? null,
      }}
      onClick={interactive ? handleActivate : undefined}
      onPointerOver={
        interactive
          ? (event) => {
              event.stopPropagation();
              onHover(country.selection);
            }
          : undefined
      }
      onPointerOut={
        interactive
          ? (event) => {
              event.stopPropagation();
              onHover(null);
            }
          : undefined
      }
    >
      {selected ? <Edges color="#eef2e9" threshold={38} /> : null}
    </mesh>
  );
});

const applyMeshElevation = (mesh: Mesh, elevation: number) => {
  mesh.scale.setScalar(
    (GLOBE_RADIUS + elevation) / (GLOBE_RADIUS + BASE_PLATE_ELEVATION),
  );
};

export function CountryLayer({
  countries,
  hoveredId,
  selectedId,
  aggregatesBySelection,
  selectedPollutant,
  reducedMotion,
  interactive,
  interactionSelectionsByCountry,
  onHover,
  onActivate,
}: CountryLayerProps) {
  const meshes = useRef(new Map<string, Mesh>());
  const elevations = useRef(new Map<string, number>());
  const interaction = useRef({
    hoveredId,
    selectedId,
    reducedMotion,
    interactionSelectionsByCountry,
  });
  const { invalidate } = useThree();

  useEffect(() => {
    interaction.current = {
      hoveredId,
      selectedId,
      reducedMotion,
      interactionSelectionsByCountry,
    };
    invalidate();
  }, [
    hoveredId,
    interactionSelectionsByCountry,
    invalidate,
    reducedMotion,
    selectedId,
  ]);

  const registerMesh = useCallback((id: string, mesh: Mesh | null) => {
    if (mesh) {
      meshes.current.set(id, mesh);
      elevations.current.set(id, BASE_PLATE_ELEVATION);
    } else {
      meshes.current.delete(id);
      elevations.current.delete(id);
    }
  }, []);

  useFrame((_, delta) => {
    const state = interaction.current;
    let needsAnotherFrame = false;
    for (const [id, mesh] of meshes.current) {
      const interactionId =
        state.interactionSelectionsByCountry?.[id]?.id ?? id;
      const target =
        interactionId === state.selectedId
          ? SELECTED_PLATE_ELEVATION
          : interactionId === state.hoveredId
            ? HOVERED_PLATE_ELEVATION
            : BASE_PLATE_ELEVATION;
      const current = elevations.current.get(id) ?? BASE_PLATE_ELEVATION;
      const next = state.reducedMotion
        ? target
        : MathUtils.damp(current, target, 14, Math.min(delta, 0.05));
      elevations.current.set(id, next);
      applyMeshElevation(mesh, next);
      if (Math.abs(next - target) > 0.0002) needsAnotherFrame = true;
    }
    if (needsAnotherFrame) invalidate();
  });

  return (
    <group>
      {countries.map((country) => {
        const interactionSelection = interactionSelectionsByCountry
          ? interactionSelectionsByCountry[country.id]
          : country.selection;
        const active =
          hoveredId === interactionSelection?.id ||
          selectedId === interactionSelection?.id;
        const renderedCountry = interactionSelection
          ? { ...country, selection: interactionSelection }
          : country;
        return (
          <CountryPlate
            key={country.id}
            country={renderedCountry}
            aggregate={aggregateForCountryPlate(
              country.selection,
              interactionSelectionsByCountry?.[country.id],
              aggregatesBySelection,
              active,
            )}
            selectedPollutant={selectedPollutant}
            selected={selectedId === interactionSelection?.id}
            interactive={interactive && Boolean(interactionSelection)}
            registerMesh={registerMesh}
            onHover={onHover}
            onActivate={onActivate}
          />
        );
      })}
    </group>
  );
}

export const aggregateForCountryPlate = (
  countrySelection: GeoSelection,
  interactionSelection: GeoSelection | undefined,
  aggregatesBySelection: Readonly<Record<string, AirAggregate>>,
  active = true,
) => {
  if (!active) return undefined;
  const semanticSelection = interactionSelection ?? countrySelection;
  if (
    semanticSelection.level !== "country" &&
    semanticSelection.level !== "continent"
  ) {
    return undefined;
  }
  return aggregatesBySelection[selectionAggregateKey(semanticSelection)];
};
