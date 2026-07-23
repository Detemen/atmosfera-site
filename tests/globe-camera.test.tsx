import { render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";

import { CameraRig } from "../components/globe/AirQualityGlobe";

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
}));

describe("globe camera rig", () => {
  beforeEach(() => {
    controlsStarts.length = 0;
    dampingValues.length = 0;
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
