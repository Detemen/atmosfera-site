"use client";

import { Edges } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { MathUtils, Vector3 } from "three";

import { aqiCategory } from "../../lib/air-quality";
import {
  selectionAggregateKey,
  type GeoSelection,
} from "../../lib/geography";
import type { AirAggregate } from "../../lib/types";
import { DETAIL_MARKER_CONFIG, type SceneVisibility } from "./globeModel";
import {
  BASE_PLATE_ELEVATION,
  GLOBE_RADIUS,
  createRepresentativeBoundsGeometry,
} from "./sphericalGeometry";

type ProgressiveDetailLayerProps = {
  reducedDetail?: boolean;
  visibility: SceneVisibility;
  region: GeoSelection | null;
  city: GeoSelection | null;
  coordinate: GeoSelection | null;
  hoveredId: string | null;
  selectedId: string | null;
  aggregatesBySelection?: Readonly<Record<string, AirAggregate>>;
  onHover: (selection: GeoSelection | null) => void;
  onActivate: (
    selection: GeoSelection,
    pointerType: string,
    pointerDelta: number,
  ) => void;
};

const positionForSelection = (selection: GeoSelection, radius: number) => {
  const longitude = MathUtils.degToRad(selection.centroid.longitude);
  const latitude = MathUtils.degToRad(selection.centroid.latitude);
  const latitudeRadius = Math.cos(latitude) * radius;
  return new Vector3(
    latitudeRadius * Math.cos(longitude),
    Math.sin(latitude) * radius,
    -latitudeRadius * Math.sin(longitude),
  );
};

function RegionCoverage({
  selection,
  selected,
  reducedDetail,
  hovered,
  onHover,
  onActivate,
  color,
}: {
  selection: GeoSelection;
  selected: boolean;
  reducedDetail: boolean;
  hovered: boolean;
  onHover: (selection: GeoSelection | null) => void;
  onActivate: (
    selection: GeoSelection,
    pointerType: string,
    pointerDelta: number,
  ) => void;
  color: string;
}) {
  const geometry = useMemo(
    () => createRepresentativeBoundsGeometry(selection.bounds),
    [selection.bounds],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const elevation = selected ? 0.105 : hovered ? 0.092 : 0.082;

  return (
    <mesh
      name={`detail-${selection.id}`}
      geometry={geometry}
      scale={(GLOBE_RADIUS + elevation) / (GLOBE_RADIUS + BASE_PLATE_ELEVATION)}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(selection);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        onHover(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onActivate(
          selection,
          (event.nativeEvent as PointerEvent).pointerType,
          event.delta,
        );
      }}
    >
      <meshBasicMaterial
        color={color}
        transparent
        opacity={selected ? 0.3 : 0.16}
        depthWrite={false}
      />
      {!reducedDetail ? <Edges color="#d8f1e6" threshold={26} /> : null}
    </mesh>
  );
}

function DetailMarker({
  selection,
  color,
  radialOffset,
  size,
  selected,
  reducedDetail,
  onHover,
  onActivate,
}: {
  selection: GeoSelection;
  color: string;
  radialOffset: number;
  size: number;
  selected: boolean;
  reducedDetail: boolean;
  onHover: (selection: GeoSelection | null) => void;
  onActivate: (
    selection: GeoSelection,
    pointerType: string,
    pointerDelta: number,
  ) => void;
}) {
  const handlePointer = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(selection);
  };

  return (
    <mesh
      name={`detail-${selection.id}`}
      position={positionForSelection(selection, GLOBE_RADIUS + radialOffset)}
      scale={selected ? 1.35 : 1}
      onPointerOver={handlePointer}
      onPointerOut={(event) => {
        event.stopPropagation();
        onHover(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onActivate(
          selection,
          (event.nativeEvent as PointerEvent).pointerType,
          event.delta,
        );
      }}
    >
      <sphereGeometry args={[size, reducedDetail ? 10 : 18, reducedDetail ? 8 : 12]} />
      <meshStandardMaterial
        color="#d7d8d2"
        emissive={color}
        emissiveIntensity={selected ? 1.2 : 0.7}
        roughness={0.45}
      />
    </mesh>
  );
}

export function ProgressiveDetailLayer({
  reducedDetail = false,
  visibility,
  region,
  city,
  coordinate,
  hoveredId,
  selectedId,
  aggregatesBySelection = {},
  onHover,
  onActivate,
}: ProgressiveDetailLayerProps) {
  return (
    <group data-detail={reducedDetail ? "reduced" : "full"}>
      {visibility.showRegionCoverage && region ? (
        <RegionCoverage
          selection={region}
          hovered={hoveredId === region.id}
          selected={selectedId === region.id}
          reducedDetail={reducedDetail}
          onHover={onHover}
          onActivate={onActivate}
          color={detailAccentForSelection(region, aggregatesBySelection, "#9ed8c2")}
        />
      ) : null}
      {visibility.showCityMark && city ? (
        <DetailMarker
          selection={city}
          color={detailAccentForSelection(city, aggregatesBySelection, "#8ee2c1")}
          radialOffset={DETAIL_MARKER_CONFIG.city.radialOffset}
          size={DETAIL_MARKER_CONFIG.city.size}
          selected={selectedId === city.id}
          reducedDetail={reducedDetail}
          onHover={onHover}
          onActivate={onActivate}
        />
      ) : null}
      {visibility.showCoordinateMark && coordinate ? (
        <DetailMarker
          selection={coordinate}
          color={detailAccentForSelection(coordinate, aggregatesBySelection, "#f2cf5b")}
          radialOffset={DETAIL_MARKER_CONFIG.coordinate.radialOffset}
          size={DETAIL_MARKER_CONFIG.coordinate.size}
          selected={selectedId === coordinate.id}
          reducedDetail={reducedDetail}
          onHover={onHover}
          onActivate={onActivate}
        />
      ) : null}
    </group>
  );
}

export const detailAccentForSelection = (
  selection: GeoSelection,
  aggregatesBySelection: Readonly<Record<string, AirAggregate>>,
  fallback = "#111617",
) => {
  const aggregate = aggregatesBySelection[selectionAggregateKey(selection)];
  return aggregate ? aqiCategory(aggregate.aqi).color : fallback;
};
