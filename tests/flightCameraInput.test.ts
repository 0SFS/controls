// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadInputSensitivityPreference, type HudInputMode } from "foss-earth/input";
import { controlsParameterDefaults } from "../src/settings";
import { attachFlightCameraInput, type FlightCameraInputOptions } from "../src/flightCameraInput";
import { PINCH_RELEASE_GAP_MS } from "../src/cameraGlide";

const getTouchWheelCooldownMs = () => controlsParameterDefaults().get("osfs.input.touchWheelCooldown");

type Contact = Pick<Touch, "identifier" | "target" | "clientX" | "clientY">;
const contact = (identifier: number, target: EventTarget, clientX: number, clientY: number): Contact => ({ identifier, target, clientX, clientY });

// A TouchEvent includes contacts on other elements too. Only changedTouches
// tells the receiver which contacts began, moved, or ended in this event.
function dispatchTouch(target: EventTarget, name: string, touches: Contact[], changedTouches: Contact[]): Event {
  const event = new Event(name, { bubbles: true, cancelable: true });
  Object.assign(event, { touches, changedTouches, targetTouches: touches.filter(touch => touch.target === target) });
  target.dispatchEvent(event);
  return event;
}

function touchSequence(canvas: HTMLCanvasElement) {
  let previous: Contact[] = [];
  return (name: string, points: number[][]): Event => {
    const next = points.map(([x, y], index) => contact(index + 1, canvas, x, y));
    const changed = name === "touchstart" ? next.filter(touch => !previous.some(last => last.identifier === touch.identifier))
      : name === "touchend" || name === "touchcancel" ? previous.filter(last => !next.some(touch => touch.identifier === last.identifier))
        : next;
    previous = next;
    return dispatchTouch(canvas, name, next, changed);
  };
}

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(initial: HudInputMode = "mouse", options: Partial<FlightCameraInputOptions> = {}) {
  const canvas = document.createElement("canvas");
  let mode = initial;
  const orbit = vi.fn();
  const zoom = vi.fn();
  const onOrbitActive = vi.fn();
  const dispose = attachFlightCameraInput(canvas, { getMode: () => mode, getSensitivity: loadInputSensitivityPreference, orbit, zoom, onOrbitActive, getTouchWheelCooldownMs, ...options });
  disposers.push(dispose);
  const pointer = (target: EventTarget, name: string, button: number, x = 0, y = 0, buttons = button === 2 ? 2 : 1) => {
    const event = new MouseEvent(name, { button, buttons, clientX: x, clientY: y, cancelable: true });
    Object.defineProperty(event, "pointerId", { value: 1 });
    target.dispatchEvent(event);
    return event;
  };
  const wheel = (init: WheelEventInit) => {
    const event = new WheelEvent("wheel", { ...init, cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  };
  return { canvas, orbit, zoom, onOrbitActive, dispose, pointer, wheel, touches: touchSequence(canvas), setMode: (next: HudInputMode) => { mode = next; } };
}
describe("flight camera gestures", () => {
  it("orbits on right drag, ends on release and leaves left click untouched", () => {
    const s = setup();
    expect(s.pointer(s.canvas, "pointerdown", 0).defaultPrevented).toBe(false);
    s.pointer(window, "pointermove", 0, 10, 10);
    expect(s.orbit).not.toHaveBeenCalled();
    s.pointer(s.canvas, "pointerdown", 2);
    s.pointer(window, "pointermove", 2, 10, 20);
    expect(s.orbit).toHaveBeenCalledWith(0.05, 0.1);
    s.pointer(window, "pointerup", 2);
    s.pointer(window, "pointermove", 2, 20, 40);
    expect(s.orbit).toHaveBeenCalledTimes(1);
    const menu = new MouseEvent("contextmenu", { cancelable: true });
    s.canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });
  it("zooms mouse wheels, but trackpad swipes including shift-wheel only orbit", () => {
    const s = setup();
    expect(s.wheel({ deltaY: 100 }).defaultPrevented).toBe(true);
    expect(s.zoom.mock.calls[0][0]).toBeGreaterThan(1);
    s.zoom.mockClear();
    s.setMode("trackpad");
    s.wheel({ deltaX: 10, deltaY: 20 });
    s.wheel({ deltaY: 100, shiftKey: true });
    expect(s.orbit).toHaveBeenCalledWith(-0.05, -0.1);
    expect(s.zoom).not.toHaveBeenCalled();
    s.wheel({ deltaY: -10, ctrlKey: true });
    expect(s.zoom.mock.calls[0][0]).toBeLessThan(1);
  });
  it.each([false, true])("uses Option/Alt for swipe zoom while held Control keeps orbiting (Safari: %s)", (safari) => {
    if (safari) {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh Safari");
      vi.stubGlobal("GestureEvent", Event);
    }
    const s = setup("trackpad");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", code: "ControlLeft", ctrlKey: true }));
    s.wheel({ deltaX: 10, deltaY: 20, ctrlKey: true });
    expect(s.orbit.mock.calls).toEqual([[-0.05, -0.1]]);
    expect(s.zoom).not.toHaveBeenCalled();

    // Option/Alt still works while a flight control is held.
    s.wheel({ deltaY: -10, ctrlKey: true, altKey: true });
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", code: "ControlLeft" }));
    s.wheel({ deltaY: 10, altKey: true });
    expect(s.zoom.mock.calls).toEqual([[Math.exp(-0.1)], [Math.exp(0.1)]]);
    expect(s.orbit).toHaveBeenCalledTimes(1);
  });
  it.each(["keyup", "blur"])("recognizes native pinch again after Control is cleared by %s", (release) => {
    const s = setup("trackpad");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", code: "ControlRight", ctrlKey: true }));
    s.wheel({ deltaY: -10, ctrlKey: true });
    expect(s.zoom).not.toHaveBeenCalled();
    window.dispatchEvent(release === "keyup"
      ? new KeyboardEvent("keyup", { key: "Control", code: "ControlRight" })
      : new Event("blur"));
    s.wheel({ deltaY: -10, ctrlKey: true });
    expect(s.zoom).toHaveBeenCalledWith(Math.exp(-0.1));
    expect(s.orbit).toHaveBeenCalledTimes(1);
  });
  it("uses incremental native pinch scales without swipe orbit during pinch", () => {
    const s = setup("trackpad");
    const gesture = (name: string, scale: number) => {
      const event = new Event(name, { cancelable: true });
      Object.assign(event, { scale });
      s.canvas.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };
    gesture("gesturestart", 1);
    gesture("gesturechange", 2);
    s.wheel({ deltaY: 30 });
    gesture("gesturechange", 4);
    expect(s.zoom.mock.calls).toEqual([[0.5], [0.5]]);
    expect(s.orbit).not.toHaveBeenCalled();
    gesture("gestureend", 4);
    s.wheel({ deltaY: 30 });
    expect(s.orbit).toHaveBeenCalledTimes(1);
  });
  it("avoids duplicate Safari wheel pinch and supports two-touch swipe/pinch", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh Safari");
    vi.stubGlobal("GestureEvent", Event);
    const s = setup("trackpad");
    s.wheel({ ctrlKey: true, deltaY: -20 });
    expect(s.zoom).not.toHaveBeenCalled();
    const touches = s.touches;
    touches("touchstart", [[0, 0]]);
    touches("touchmove", [[10, 10]]);
    expect(s.orbit).toHaveBeenCalledWith(0.05, 0.05);
    expect(s.zoom).not.toHaveBeenCalled();
    s.orbit.mockClear();
    touches("touchstart", [[10, 10], [20, 10]]);
    touches("touchmove", [[20, 20], [30, 20]]);
    expect(s.orbit).toHaveBeenCalledWith(0.05, 0.05);
    touches("touchmove", [[5, 10], [25, 10]]);
    expect(s.zoom).toHaveBeenLastCalledWith(0.5);
    touches("touchcancel", []);
    s.orbit.mockClear();
    touches("touchmove", [[5, 10], [25, 10]]);
    expect(s.orbit).not.toHaveBeenCalled();
  });

  it("orbits and pinches with two fingers in mouse mode too, at touch sensitivity", () => {
    const canvas = document.createElement("canvas");
    const orbit = vi.fn();
    const zoom = vi.fn();
    const sensitivity = {
      mouse: { pan: 1, orbit: 1, zoom: 1 },
      trackpad: { pan: 1, orbit: 1, zoom: 1 },
      touch: { pan: 1, orbit: 2, zoom: 3 },
    };
    disposers.push(attachFlightCameraInput(canvas, { getMode: () => "mouse", getSensitivity: () => sensitivity, orbit, zoom, getTouchWheelCooldownMs }));
    const touches = touchSequence(canvas);

    touches("touchstart", [[0, 0], [10, 0]]);
    touches("touchmove", [[10, 10], [20, 10]]);
    expect(orbit).toHaveBeenCalledWith(0.1, 0.1);
    touches("touchmove", [[5, 10], [25, 10]]);
    expect(zoom).toHaveBeenLastCalledWith(0.125);
  });

  it("leaves a touchscreen pinch to the touch path when Safari also sends gesture events", () => {
    vi.stubGlobal("GestureEvent", Event);
    const s = setup("trackpad");
    const touches = s.touches;
    const gesture = (name: string, scale: number) => {
      const event = new Event(name, { cancelable: true });
      Object.assign(event, { scale });
      s.canvas.dispatchEvent(event);
    };

    touches("touchstart", [[0, 0], [10, 0]]);
    gesture("gesturestart", 1);
    gesture("gesturechange", 2);
    expect(s.zoom).not.toHaveBeenCalled();
    touches("touchmove", [[0, 0], [20, 0]]);
    expect(s.zoom).toHaveBeenLastCalledWith(0.5);
  });

  it("ignores synthesized wheel pans while two-finger touch is active", () => {
    const s = setup("trackpad");
    const touches = s.touches;
    touches("touchstart", [[0, 0], [20, 0]]);
    s.orbit.mockClear();
    s.wheel({ deltaX: 40, deltaY: 40 });
    expect(s.orbit).not.toHaveBeenCalled();
    touches("touchmove", [[10, 10], [30, 10]]);
    expect(s.orbit).toHaveBeenCalledWith(0.05, 0.05);
  });

  it.each(["joystick first", "camera first"])("orbits with one canvas finger while another holds the joystick: %s", order => {
    const s = setup("touch");
    const joystick = document.createElement("div");
    const stick = contact(11, joystick, 20, 40);
    const camera = contact(22, s.canvas, 300, 200);
    if (order === "joystick first") {
      dispatchTouch(joystick, "touchstart", [stick], [stick]);
      dispatchTouch(s.canvas, "touchstart", [stick, camera], [camera]);
    } else {
      dispatchTouch(s.canvas, "touchstart", [camera], [camera]);
      dispatchTouch(joystick, "touchstart", [camera, stick], [stick]);
    }
    const movedCamera = contact(22, s.canvas, 310, 220);
    dispatchTouch(s.canvas, "touchmove", [stick, movedCamera], [movedCamera]);
    expect(s.orbit.mock.calls).toEqual([[0.05, 0.1]]);
    expect(s.zoom).not.toHaveBeenCalled();

    const movedStick = contact(11, joystick, 100, 100);
    dispatchTouch(joystick, "touchmove", [movedStick, movedCamera], [movedStick]);
    expect(s.orbit).toHaveBeenCalledTimes(1);
    dispatchTouch(joystick, "touchend", [movedCamera], [movedStick]);
    const lastCamera = contact(22, s.canvas, 320, 240);
    dispatchTouch(s.canvas, "touchmove", [lastCamera], [lastCamera]);
    expect(s.orbit.mock.calls).toEqual([[0.05, 0.1], [0.05, 0.1]]);
    expect(s.zoom).not.toHaveBeenCalled();
  });

  it("rebaselines one/two-finger transitions without moving or zooming the camera", () => {
    const s = setup("touch");
    s.touches("touchstart", [[0, 0]]);
    s.touches("touchmove", [[10, 10]]);
    s.touches("touchstart", [[10, 10], [30, 10]]);
    expect(s.orbit.mock.calls).toEqual([[0.05, 0.05]]);
    expect(s.zoom).not.toHaveBeenCalled();
    s.touches("touchmove", [[20, 20], [40, 20]]);
    s.touches("touchend", [[20, 20]]);
    expect(s.orbit.mock.calls).toEqual([[0.05, 0.05], [0.05, 0.05]]);
    expect(s.zoom.mock.calls).toEqual([[1]]);
    s.touches("touchmove", [[30, 30]]);
    expect(s.orbit.mock.calls).toEqual([[0.05, 0.05], [0.05, 0.05], [0.05, 0.05]]);
    expect(s.zoom.mock.calls).toEqual([[1]]);
  });

  it("ignores foreign targets even when a canvas start batches their changed contacts", () => {
    const s = setup("touch");
    const ui = document.createElement("div");
    const foreign = contact(1, ui, 0, 0);
    const camera = contact(2, s.canvas, 200, 100);
    dispatchTouch(s.canvas, "touchstart", [foreign, camera], [foreign, camera]);
    const movedForeign = contact(1, ui, 100, 80);
    const movedCamera = contact(2, s.canvas, 210, 120);
    dispatchTouch(s.canvas, "touchmove", [movedForeign, movedCamera], [movedForeign, movedCamera]);
    expect(s.orbit.mock.calls).toEqual([[0.05, 0.1]]);
    expect(s.zoom).not.toHaveBeenCalled();
  });

  it("ignores a third canvas finger and resumes from the remaining pair without a jump", () => {
    const s = setup("touch");
    s.touches("touchstart", [[0, 0], [20, 0]]);
    s.touches("touchmove", [[10, 10], [30, 10]]);
    s.touches("touchstart", [[10, 10], [30, 10], [100, 100]]);
    s.touches("touchmove", [[20, 20], [40, 20], [120, 120]]);
    expect(s.orbit.mock.calls).toEqual([[0.05, 0.05]]);
    expect(s.onOrbitActive).toHaveBeenLastCalledWith(false);
    s.touches("touchend", [[20, 20], [40, 20]]);
    expect(s.orbit).toHaveBeenCalledTimes(1);
    s.touches("touchmove", [[30, 30], [50, 30]]);
    expect(s.orbit.mock.calls).toEqual([[0.05, 0.05], [0.05, 0.05]]);
    expect(s.zoom.mock.calls).toEqual([[1], [1]]);
  });

  it.each(["preventDefault", "stopPropagation"] as const)("leaves a consumed canvas touch with its click handler: %s", consume => {
    const s = setup("touch");
    const parent = document.createElement("div");
    parent.append(s.canvas);
    parent.addEventListener("touchstart", event => event[consume](), { capture: true });
    const first = contact(1, s.canvas, 0, 0);
    dispatchTouch(s.canvas, "touchstart", [first], [first]);
    const moved = contact(1, s.canvas, 20, 30);
    dispatchTouch(s.canvas, "touchmove", [moved], [moved]);
    expect(s.orbit).not.toHaveBeenCalled();
    expect(s.zoom).not.toHaveBeenCalled();
  });

  it("uses touch sensitivity and inversion for a single finger in any pointer mode", () => {
    const s = setup("mouse", {
      getSensitivity: () => ({
        mouse: { pan: 1, orbit: 7, zoom: 1 },
        trackpad: { pan: 1, orbit: 4, zoom: 1 },
        touch: { pan: 1, orbit: 2, zoom: 3 },
      }),
      getOrbitInvert: () => ({ invertYaw: true, invertPitch: true, recenterMode: "hold" }),
    });
    s.touches("touchstart", [[10, 20]]);
    s.touches("touchmove", [[20, 40]]);
    expect(s.orbit.mock.calls).toEqual([[-0.1, -0.2]]);
    expect(s.zoom).not.toHaveBeenCalled();
  });

  it("suppresses synthesized wheel pans during a one-finger gesture and its release cooldown", () => {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const s = setup("trackpad");
    s.touches("touchstart", [[0, 0]]);
    s.wheel({ deltaX: 20, deltaY: 30 });
    expect(s.orbit).not.toHaveBeenCalled();
    s.touches("touchend", []);
    s.wheel({ deltaX: 20, deltaY: 30 });
    expect(s.orbit).not.toHaveBeenCalled();
    now += getTouchWheelCooldownMs() + 1;
    s.wheel({ deltaX: 20, deltaY: 30 });
    expect(s.orbit).toHaveBeenCalledWith(-0.1, -0.15);
  });

  it("drops ended, cancelled, and blurred touch contacts until a new canvas touch begins", () => {
    const s = setup("touch");
    const first = contact(1, s.canvas, 0, 0);
    const moved = contact(1, s.canvas, 10, 10);
    dispatchTouch(s.canvas, "touchstart", [first], [first]);
    dispatchTouch(s.canvas, "touchmove", [moved], [moved]);
    dispatchTouch(s.canvas, "touchcancel", [], [moved]);
    dispatchTouch(s.canvas, "touchmove", [first], [first]);
    expect(s.orbit).toHaveBeenCalledTimes(1);
    expect(s.onOrbitActive).toHaveBeenLastCalledWith(false);

    dispatchTouch(s.canvas, "touchstart", [first], [first]);
    window.dispatchEvent(new Event("blur"));
    dispatchTouch(s.canvas, "touchmove", [moved], [moved]);
    expect(s.orbit).toHaveBeenCalledTimes(1);
    expect(s.onOrbitActive).toHaveBeenLastCalledWith(false);

    dispatchTouch(s.canvas, "touchstart", [first], [first]);
    dispatchTouch(s.canvas, "touchmove", [moved], [moved]);
    dispatchTouch(s.canvas, "touchend", [], [moved]);
    dispatchTouch(s.canvas, "touchmove", [first], [first]);
    expect(s.orbit.mock.calls).toEqual([[0.05, 0.05], [0.05, 0.05]]);
    expect(s.onOrbitActive).toHaveBeenLastCalledWith(false);
  });

  it("applies orbit invert settings", () => {
    const canvas = document.createElement("canvas");
    const orbit = vi.fn();
    const dispose = attachFlightCameraInput(canvas, {
      getMode: () => "mouse",
      getSensitivity: loadInputSensitivityPreference,
      getOrbitInvert: () => ({ invertYaw: true, invertPitch: true, recenterMode: "hold" }),
      orbit,
      zoom: vi.fn(),
      getTouchWheelCooldownMs,
    });
    disposers.push(dispose);
    const pointer = (target: EventTarget, name: string, button: number, x = 0, y = 0, buttons = button === 2 ? 2 : 1) => {
      const event = new MouseEvent(name, { button, buttons, clientX: x, clientY: y, cancelable: true });
      Object.defineProperty(event, "pointerId", { value: 1 });
      target.dispatchEvent(event);
    };
    pointer(canvas, "pointerdown", 2);
    pointer(window, "pointermove", 2, 10, 20);
    expect(orbit).toHaveBeenCalledWith(-0.05, -0.1);
  });

  it("cancels dragging on blur or mode change and disposes canvas/window listeners", () => {
    const s = setup();
    s.pointer(s.canvas, "pointerdown", 2);
    window.dispatchEvent(new Event("blur"));
    s.pointer(window, "pointermove", 2, 10, 10);
    s.pointer(s.canvas, "pointerdown", 2);
    s.setMode("trackpad");
    s.pointer(window, "pointermove", 2, 10, 10);
    expect(s.orbit).not.toHaveBeenCalled();
    s.dispose();
    expect(s.wheel({ deltaY: 20 }).defaultPrevented).toBe(false);
    expect(s.zoom).not.toHaveBeenCalled();
    expect(s.canvas.style.touchAction).not.toBe("none");
  });
});

describe("flight camera glide hooks", () => {
  const hooks = () => ({ arm: vi.fn(), release: vi.fn(), cancel: vi.fn() });
  const gesture = (canvas: HTMLCanvasElement, name: string, scale: number) => {
    const event = new Event(name, { cancelable: true });
    Object.assign(event, { scale });
    canvas.dispatchEvent(event);
  };

  it("arms a trackpad pinch to glide on once it goes quiet, but not a mouse wheel or a swipe", () => {
    const glide = hooks();
    const s = setup("mouse", { glide });
    s.wheel({ deltaY: 100 });
    s.wheel({ deltaY: 100, ctrlKey: true });
    expect(s.zoom).toHaveBeenCalledTimes(2);
    expect(glide.arm).not.toHaveBeenCalled();
    s.setMode("trackpad");
    s.wheel({ deltaY: -10, ctrlKey: true });
    expect(s.zoom).toHaveBeenCalledTimes(3);
    expect(glide.arm.mock.calls).toEqual([["zoom", PINCH_RELEASE_GAP_MS]]);
    s.wheel({ deltaX: 10, deltaY: 20 });
    expect(s.orbit).toHaveBeenCalledTimes(1);
    expect(glide.arm).toHaveBeenCalledTimes(1);
    expect(glide.release).not.toHaveBeenCalled();
    expect(glide.cancel).not.toHaveBeenCalled();
  });

  it("arms a Safari pinch while it zooms and releases it when the gesture ends", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh Safari");
    vi.stubGlobal("GestureEvent", Event);
    const glide = hooks();
    const s = setup("trackpad", { glide });
    s.wheel({ ctrlKey: true, deltaY: -20 });
    gesture(s.canvas, "gesturestart", 1);
    gesture(s.canvas, "gesturechange", 1);
    expect(glide.arm).not.toHaveBeenCalled();
    gesture(s.canvas, "gesturechange", 2);
    expect(s.zoom.mock.calls).toEqual([[1], [0.5]]);
    expect(glide.arm.mock.calls).toEqual([["zoom", PINCH_RELEASE_GAP_MS]]);
    expect(glide.release).not.toHaveBeenCalled();
    gesture(s.canvas, "gestureend", 2);
    expect(glide.release.mock.calls).toEqual([["zoom"]]);
  });

  it("stops the glide when a finger lands on the canvas, and glides a pinch on when one of its fingers lifts", () => {
    const glide = hooks();
    const s = setup("touch", { glide });
    s.touches("touchstart", [[0, 0]]);
    expect(glide.cancel).toHaveBeenCalledTimes(1);
    s.touches("touchmove", [[10, 10]]);
    expect(glide.arm).not.toHaveBeenCalled();
    s.touches("touchstart", [[10, 10], [30, 10]]);
    expect(glide.cancel).toHaveBeenCalledTimes(2);
    s.touches("touchmove", [[5, 10], [35, 10]]);
    expect(s.zoom).toHaveBeenLastCalledWith(20 / 30);
    expect(glide.arm.mock.calls).toEqual([["zoom", PINCH_RELEASE_GAP_MS]]);
    expect(glide.release).not.toHaveBeenCalled();
    s.touches("touchend", [[5, 10]]);
    expect(glide.release.mock.calls).toEqual([["zoom"]]);
    expect(glide.cancel).toHaveBeenCalledTimes(2);
  });

  it("leaves the glide alone for touches that are not the canvas's", () => {
    const glide = hooks();
    const s = setup("touch", { glide });
    const ui = document.createElement("div");
    const camera = contact(2, s.canvas, 200, 100);
    dispatchTouch(s.canvas, "touchstart", [camera], [camera]);
    expect(glide.cancel).toHaveBeenCalledTimes(1);
    const foreign = contact(1, ui, 0, 0);
    dispatchTouch(s.canvas, "touchstart", [camera, foreign], [foreign]);
    dispatchTouch(s.canvas, "touchend", [camera], [foreign]);
    expect(glide.cancel).toHaveBeenCalledTimes(1);
    expect(glide.release).not.toHaveBeenCalled();

    const parent = document.createElement("div");
    parent.append(s.canvas);
    parent.addEventListener("touchstart", event => event.preventDefault(), { capture: true });
    const reserved = contact(3, s.canvas, 50, 50);
    dispatchTouch(s.canvas, "touchstart", [camera, reserved], [reserved]);
    expect(glide.cancel).toHaveBeenCalledTimes(1);
  });
});
