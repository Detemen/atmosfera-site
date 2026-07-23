import { render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";

import { CameraRig } from "../components/globe/AirQualityGlobe";

const cameraPositions = vi.hoisted(() => [] as unknown[]);
const controlsStarts = vi.hoisted(() => [] as Array<() => void>);
const dampingValues = vi.hoisted(() => [] as boolean[]);
const camera = new Vector3(4, 2, 5);

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
  useThree: () => ({
    camera: {
      position: camera,
      lookAt: vi.fn(),
    },
    invalidate: vi.fn(),
  }),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: ({
    enableDamping,
    onStart,
  }: {
    enableDamping: boolean;
    onStart: () => void;
  }) => {
    dampingValues.push(enableDamping);
    controlsStarts.push(onStart);
    return null;
  },
  PerspectiveCamera: ({ position }: { position: unknown }) => {
    cameraPositions.push(position);
    return null;
  },
}));

describe("globe camera rig", () => {
  beforeEach(() => {
    cameraPositions.length = 0;
    controlsStarts.length = 0;
    dampingValues.length = 0;
  });

  it("keeps its declarative initial position stable across parent rerenders", () => {
    const actionsRef = createRef<never>();
    const onLevelChange = vi.fn();
    const { rerender } = render(
      <CameraRig
        actionsRef={actionsRef}
        reducedMotion={false}
        onLevelChange={onLevelChange}
        onInteractionStart={vi.fn()}
      />,
    );

    rerender(
      <CameraRig
        actionsRef={actionsRef}
        reducedMotion={false}
        onLevelChange={onLevelChange}
        onInteractionStart={vi.fn()}
      />,
    );

    expect(cameraPositions).toHaveLength(2);
    expect(cameraPositions[1]).toBe(cameraPositions[0]);
  });

  it("reports manual orbit interaction so transient hover can be cleared", () => {
    const onInteractionStart = vi.fn();
    render(
      <CameraRig
        actionsRef={createRef<never>()}
        reducedMotion={false}
        onLevelChange={vi.fn()}
        onInteractionStart={onInteractionStart}
      />,
    );

    controlsStarts[0]();

    expect(onInteractionStart).toHaveBeenCalledOnce();
  });

  it("stops manual rotation with the pointer instead of adding camera inertia", () => {
    render(
      <CameraRig
        actionsRef={createRef<never>()}
        reducedMotion={false}
        onLevelChange={vi.fn()}
        onInteractionStart={vi.fn()}
      />,
    );

    expect(dampingValues).toEqual([false]);
  });
});
