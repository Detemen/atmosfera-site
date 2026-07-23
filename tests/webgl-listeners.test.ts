import { describe, expect, it, vi } from "vitest";

import { registerWebGLContextListeners } from "../components/globe/globeModel";

describe("WebGL context listener lifecycle", () => {
  it("keeps restoration active after loss and removes both listeners on cleanup", () => {
    const canvas = document.createElement("canvas");
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const cleanup = registerWebGLContextListeners(canvas, onLost, onRestored);
    const lost = new Event("webglcontextlost", { cancelable: true });

    canvas.dispatchEvent(lost);
    canvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(lost.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledTimes(1);

    cleanup();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledTimes(1);
  });
});
