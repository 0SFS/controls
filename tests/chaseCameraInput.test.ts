// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadInputSensitivityPreference } from "foss-earth/input";
import { attachChaseCameraInput, glideDecayFrom, GLIDE_DECAY_SETTING } from "../src/chaseCameraInput";
import { DEFAULT_GLIDE_DECAY } from "../src/cameraGlide";

const FRAME_MS = 1000 / 60;
const detachers: Array<() => void> = [];
afterEach(() => { detachers.splice(0).forEach(detach => detach()); });

function setup(decay = DEFAULT_GLIDE_DECAY) {
  const canvas = document.createElement("canvas");
  let now = 0;
  let logZoom = 0;
  const orbit = vi.fn();
  const zoom = vi.fn((factor: number) => { logZoom += Math.log(factor); });
  const wake = vi.fn();
  const input = attachChaseCameraInput(canvas, {
    getMode: () => "mouse", getSensitivity: loadInputSensitivityPreference, getTouchWheelCooldownMs: () => 250,
    orbit, zoom, decay: () => decay, wake, now: () => now,
  });
  detachers.push(() => input.detach());
  const frames = (count: number) => { for (let i = 0; i < count; i++) { now += FRAME_MS; input.step(now); } };
  const wheel = (deltaY: number) => canvas.dispatchEvent(new WheelEvent("wheel", { deltaY, cancelable: true }));
  const drag = (dx: number, dy: number) => {
    const pointer = (target: EventTarget, name: string, x: number, y: number) => {
      const event = new MouseEvent(name, { button: 2, buttons: 2, clientX: x, clientY: y, cancelable: true });
      Object.defineProperty(event, "pointerId", { value: 1 });
      target.dispatchEvent(event);
    };
    pointer(canvas, "pointerdown", 0, 0);
    pointer(window, "pointermove", dx, dy);
    pointer(window, "pointerup", dx, dy);
  };
  return { input, orbit, zoom, wake, frames, wheel, drag, get logZoom() { return logZoom; } };
}

describe("attachChaseCameraInput", () => {
  it("eases a wheel zoom in over the frames after it, to exactly what the wheel asked for", () => {
    const s = setup();
    s.wheel(100);
    // Nothing moves until a frame steps, and then only part of the way.
    expect(s.zoom).not.toHaveBeenCalled();
    expect(s.wake).toHaveBeenCalled();
    s.frames(1);
    expect(s.logZoom).toBeGreaterThan(0);
    expect(s.logZoom).toBeLessThan(0.2 * 0.5);
    s.frames(120);
    expect(s.logZoom).toBeCloseTo(0.2, 6);
    expect(s.input.isActive()).toBe(false);
  });

  it("moves at once with Glide at 0", () => {
    const s = setup(0);
    s.wheel(100);
    expect(s.logZoom).toBeCloseTo(0.2, 12);
  });

  it("keeps a mouse drag's orbit direct, as /fly does", () => {
    const s = setup();
    s.drag(10, 20);
    expect(s.orbit).toHaveBeenCalledWith(0.05, 0.1);
  });

  it("stops listening and drops what it still owed once detached", () => {
    const s = setup();
    s.wheel(100);
    s.input.detach();
    s.frames(60);
    s.wheel(100);
    expect(s.zoom).not.toHaveBeenCalled();
  });
});

describe("glideDecayFrom", () => {
  it("reads the Glide setting where it is registered, and FOSS Earth's default where not", () => {
    const values = new Map<string, unknown>([[GLIDE_DECAY_SETTING, 0.9]]);
    const settings = { has: (id: string) => values.has(id), get: (id: string) => values.get(id) };
    expect(glideDecayFrom(settings)()).toBe(0.9);
    values.clear();
    expect(glideDecayFrom(settings)()).toBe(DEFAULT_GLIDE_DECAY);
  });
});
