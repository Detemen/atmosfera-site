import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  MathUtils,
  Path,
  Shape,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { CountryGeometry, GeoBounds } from "../../lib/geography";

export const GLOBE_RADIUS = 1.75;
export const BASE_PLATE_ELEVATION = 0.018;
export const HOVERED_PLATE_ELEVATION = 0.055;
export const SELECTED_PLATE_ELEVATION = 0.075;

const MAX_SURFACE_EDGE_RADIANS = MathUtils.degToRad(3);
const MAX_SUBDIVISION_DEPTH = 20;
const ELEVATION_EPSILON = 1e-7;

type PlateVertex = {
  longitude: number;
  latitude: number;
  elevation: number;
};

const unwrapRing = (
  ring: readonly (readonly [longitude: number, latitude: number])[],
  referenceLongitude?: number,
) => {
  if (ring.length === 0) return [];

  const unwrapped: Array<[number, number]> = [[ring[0][0], ring[0][1]]];
  for (const [longitude, latitude] of ring.slice(1)) {
    const previousLongitude = unwrapped.at(-1)![0];
    let candidate = longitude;
    while (candidate - previousLongitude > 180) candidate -= 360;
    while (candidate - previousLongitude < -180) candidate += 360;
    unwrapped.push([candidate, latitude]);
  }

  if (referenceLongitude !== undefined) {
    const mean =
      unwrapped.reduce((total, [longitude]) => total + longitude, 0) /
      unwrapped.length;
    const shift = Math.round((referenceLongitude - mean) / 360) * 360;
    return unwrapped.map(
      ([longitude, latitude]) => [longitude + shift, latitude] as [number, number],
    );
  }

  return unwrapped;
};

const pathFromRing = (ring: readonly (readonly [number, number])[]) => {
  const path = new Path();
  ring.forEach(([longitude, latitude], index) => {
    if (index === 0) path.moveTo(longitude, latitude);
    else path.lineTo(longitude, latitude);
  });
  path.closePath();
  return path;
};

const closePolarCap = (ring: Array<[number, number]>) => {
  if (ring.length < 4) return ring;
  const west = Math.min(...ring.map(([longitude]) => longitude));
  const east = Math.max(...ring.map(([longitude]) => longitude));
  if (east - west < 359) return ring;

  const latitudes = ring.map(([, latitude]) => latitude);
  const north = Math.max(...latitudes);
  const south = Math.min(...latitudes);
  const pole = north < -60 ? -90 : south > 60 ? 90 : null;
  if (pole === null) return ring;

  const coastline = ring.slice(0, -1);
  const start = coastline[0];
  const end = coastline.at(-1)!;
  return [
    ...coastline,
    [end[0], pole],
    [start[0], pole],
    start,
  ];
};

const shapeFromPolygon = (
  polygon: readonly (readonly (readonly [number, number])[])[],
) => {
  const outer = closePolarCap(unwrapRing(polygon[0]));
  if (outer.length < 4) return null;

  const outerMean =
    outer.reduce((total, [longitude]) => total + longitude, 0) / outer.length;
  const shape = new Shape();
  outer.forEach(([longitude, latitude], index) => {
    if (index === 0) shape.moveTo(longitude, latitude);
    else shape.lineTo(longitude, latitude);
  });
  shape.closePath();
  shape.holes = polygon
    .slice(1)
    .map((ring) => unwrapRing(ring, outerMean))
    .filter((ring) => ring.length >= 4)
    .map(pathFromRing);
  return shape;
};

const unitDirection = ({ longitude, latitude }: PlateVertex) => {
  const longitudeRadians = MathUtils.degToRad(longitude);
  const latitudeRadians = MathUtils.degToRad(latitude);
  const latitudeRadius = Math.cos(latitudeRadians);
  return new Vector3(
    latitudeRadius * Math.cos(longitudeRadians),
    Math.sin(latitudeRadians),
    -latitudeRadius * Math.sin(longitudeRadians),
  );
};

const angularDistance = (start: PlateVertex, end: PlateVertex) =>
  Math.acos(MathUtils.clamp(unitDirection(start).dot(unitDirection(end)), -1, 1));

const midpoint = (start: PlateVertex, end: PlateVertex): PlateVertex => ({
  longitude: (start.longitude + end.longitude) / 2,
  latitude: (start.latitude + end.latitude) / 2,
  elevation: (start.elevation + end.elevation) / 2,
});

const appendAdaptiveTriangle = (
  vertices: PlateVertex[],
  start: PlateVertex,
  middle: PlateVertex,
  end: PlateVertex,
  depth = 0,
) => {
  const edges = [
    angularDistance(start, middle),
    angularDistance(middle, end),
    angularDistance(end, start),
  ] as const;
  const longest = Math.max(...edges);
  if (longest <= MAX_SURFACE_EDGE_RADIANS || depth >= MAX_SUBDIVISION_DEPTH) {
    vertices.push(start, middle, end);
    return;
  }

  if (longest === edges[0]) {
    const split = midpoint(start, middle);
    appendAdaptiveTriangle(vertices, start, split, end, depth + 1);
    appendAdaptiveTriangle(vertices, split, middle, end, depth + 1);
  } else if (longest === edges[1]) {
    const split = midpoint(middle, end);
    appendAdaptiveTriangle(vertices, start, middle, split, depth + 1);
    appendAdaptiveTriangle(vertices, start, split, end, depth + 1);
  } else {
    const split = midpoint(end, start);
    appendAdaptiveTriangle(vertices, start, middle, split, depth + 1);
    appendAdaptiveTriangle(vertices, split, middle, end, depth + 1);
  }
};

const projectVertex = ({ longitude, latitude, elevation }: PlateVertex) =>
  unitDirection({ longitude, latitude, elevation }).multiplyScalar(
    GLOBE_RADIUS + Math.max(0, elevation),
  );

const orientFrontTrianglesOutward = (vertices: PlateVertex[]) => {
  for (let index = 0; index < vertices.length; index += 3) {
    const first = projectVertex(vertices[index]);
    const second = projectVertex(vertices[index + 1]);
    const third = projectVertex(vertices[index + 2]);
    const outward = first.clone().add(second).add(third).normalize();
    const winding = second
      .clone()
      .sub(first)
      .cross(third.clone().sub(first))
      .dot(outward);
    if (winding < 0) {
      [vertices[index + 1], vertices[index + 2]] = [
        vertices[index + 2],
        vertices[index + 1],
      ];
    }
  }
};

const tessellateExtrusion = (extrusion: ExtrudeGeometry) => {
  const source = extrusion.getAttribute("position");
  const frontVertices: PlateVertex[] = [];
  const sideVertices: PlateVertex[] = [];

  for (let index = 0; index < source.count; index += 3) {
    const triangle: [PlateVertex, PlateVertex, PlateVertex] = [0, 1, 2].map(
      (offset) => ({
        longitude: source.getX(index + offset),
        latitude: source.getY(index + offset),
        elevation: source.getZ(index + offset),
      }),
    ) as [PlateVertex, PlateVertex, PlateVertex];
    const isBack = triangle.every(
      ({ elevation }) => Math.abs(elevation) <= ELEVATION_EPSILON,
    );
    if (isBack) continue;
    const isFront = triangle.every(
      ({ elevation }) =>
        Math.abs(elevation - BASE_PLATE_ELEVATION) <= ELEVATION_EPSILON,
    );
    appendAdaptiveTriangle(
      isFront ? frontVertices : sideVertices,
      triangle[0],
      triangle[1],
      triangle[2],
    );
  }

  orientFrontTrianglesOutward(frontVertices);
  const orderedVertices = [...frontVertices, ...sideVertices];
  const positions = orderedVertices.flatMap((vertex) => {
    const projected = projectVertex(vertex);
    return [projected.x, projected.y, projected.z];
  });
  const surfaceKind = orderedVertices.map((_, index) =>
    index < frontVertices.length ? 1 : 0,
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("surfaceKind", new Float32BufferAttribute(surfaceKind, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  extrusion.dispose();
  return geometry;
};

/** Builds curved front triangles and radial side walls without flat-face ocean clipping. */
export const createSphericalPlateGeometry = (countryGeometry: CountryGeometry) => {
  const polygons =
    countryGeometry.type === "Polygon"
      ? [countryGeometry.coordinates]
      : countryGeometry.coordinates;
  const geometries = polygons.flatMap((polygon) => {
    const shape = shapeFromPolygon(polygon);
    if (!shape) return [];
    return [
      tessellateExtrusion(
        new ExtrudeGeometry(shape, {
          bevelEnabled: false,
          curveSegments: 1,
          depth: BASE_PLATE_ELEVATION,
          steps: 1,
        }),
      ),
    ];
  });

  if (geometries.length === 0) return new BufferGeometry();
  const merged = mergeGeometries(geometries, false) ?? geometries[0];
  for (const geometry of geometries) {
    if (geometry !== merged) geometry.dispose();
  }
  return merged;
};

export const createRepresentativeBoundsGeometry = (bounds: GeoBounds) =>
  createSphericalPlateGeometry({
    type: "Polygon",
    coordinates: [[
      [bounds.west, bounds.south],
      [bounds.east, bounds.south],
      [bounds.east, bounds.north],
      [bounds.west, bounds.north],
      [bounds.west, bounds.south],
    ]],
  });

export type SphericalGeometryDiagnostic = {
  frontTriangleCount: number;
  invertedFrontTriangleCount: number;
  maxFrontEdgeRadians: number;
  minFrontSampleRadius: number;
  positionsFinite: boolean;
  normalsFinite: boolean;
};

export const diagnoseSphericalPlateGeometry = (
  geometry: BufferGeometry,
): SphericalGeometryDiagnostic => {
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const surfaceKind = geometry.getAttribute("surfaceKind");
  let frontTriangleCount = 0;
  let invertedFrontTriangleCount = 0;
  let maxFrontEdgeRadians = 0;
  let minFrontSampleRadius = Infinity;
  let positionsFinite = true;
  let normalsFinite = true;

  for (let index = 0; index < positions.count; index += 1) {
    positionsFinite &&= [
      positions.getX(index),
      positions.getY(index),
      positions.getZ(index),
    ].every(Number.isFinite);
    normalsFinite &&= [
      normals?.getX(index),
      normals?.getY(index),
      normals?.getZ(index),
    ].every(Number.isFinite);
  }

  for (let index = 0; index < positions.count; index += 3) {
    if (
      !surfaceKind ||
      [0, 1, 2].some((offset) => surfaceKind.getX(index + offset) < 0.5)
    ) {
      continue;
    }
    frontTriangleCount += 1;
    const [first, second, third] = [0, 1, 2].map(
      (offset) =>
        new Vector3(
          positions.getX(index + offset),
          positions.getY(index + offset),
          positions.getZ(index + offset),
        ),
    );
    const samples = [
      first,
      second,
      third,
      first.clone().add(second).multiplyScalar(0.5),
      second.clone().add(third).multiplyScalar(0.5),
      third.clone().add(first).multiplyScalar(0.5),
      first.clone().add(second).add(third).multiplyScalar(1 / 3),
    ];
    const outward = first
      .clone()
      .add(second)
      .add(third)
      .normalize();
    const winding = second
      .clone()
      .sub(first)
      .cross(third.clone().sub(first))
      .dot(outward);
    if (winding < -1e-10) invertedFrontTriangleCount += 1;
    for (const [start, end] of [
      [first, second],
      [second, third],
      [third, first],
    ] as const) {
      maxFrontEdgeRadians = Math.max(
        maxFrontEdgeRadians,
        Math.acos(
          MathUtils.clamp(
            start.clone().normalize().dot(end.clone().normalize()),
            -1,
            1,
          ),
        ),
      );
    }
    for (const sample of samples) {
      minFrontSampleRadius = Math.min(minFrontSampleRadius, sample.length());
    }
  }

  return {
    frontTriangleCount,
    invertedFrontTriangleCount,
    maxFrontEdgeRadians,
    minFrontSampleRadius,
    positionsFinite,
    normalsFinite,
  };
};
