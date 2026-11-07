import { createCameraGlide, DEFAULT_GLIDE_DECAY, type GlideChannel } from "./cameraGlide";
import { attachFlightCameraInput, type FlightCameraInputOptions } from "./flightCameraInput";

/** FOSS Earth's Controls → Camera → Glide: how much of its speed the camera keeps each 60 Hz frame. */
export const GLIDE_DECAY_SETTING = "camera.inertiaDecay";

/** The Glide setting where an app has registered it, and FOSS Earth's default where it has not. */
export function glideDecayFrom(settings: { has(id: string): boolean; get(id: string): unknown }): () => number {
  return () => {
    const value = settings.has(GLIDE_DECAY_SETTING) ? settings.get(GLIDE_DECAY_SETTING) : undefined;
    return typeof value === "number" ? value : DEFAULT_GLIDE_DECAY;
  };
}

export interface ChaseCameraInputOptions extends Omit<FlightCameraInputOptions, "zoom" | "glide"> {
  /** Multiplies the camera's distance by `factor`. The glide calls it over the frames after each input. */
  zoom(factor: number): void;
  /** The Glide setting, read on every input and step: `glideDecayFrom(settings)`. */
  decay(): number;
  /** The glide has something to move: draw a frame, so that the camera of a paused view moves too. */
  wake(): void;
  /** Monotonic milliseconds. `performance.now` by default. */
  now?(): number;
}

export interface ChaseCameraInput {
  /**
   * Moves the camera for the time since the last step. Call it from the
   * host's frame tick, before the frame draws. True while it has more to move.
   */
  step(now?: number): boolean;
  isActive(channel?: GlideChannel): boolean;
  /** Stops the camera where it is, as a finger landing does. */
  cancel(): void;
  detach(): void;
}

/**
 * A chase camera's gestures with FOSS Earth's glide, which every camera a
 * person steers has (FOSS Earth's docs/camera-motion.md): zoom eases in over
 * the next frames, and a pinch or a touch swipe glides on after the fingers
 * lift. Mouse drag and trackpad swipe orbit stay direct, as on /fly: the
 * trackpad's own momentum carries a swipe on. This is the input for a host
 * that has one camera and one glide. /fly, with a second glide for the phone's
 * camera pad, wires the same pieces itself.
 */
export function attachChaseCameraInput(canvas: HTMLCanvasElement, options: ChaseCameraInputOptions): ChaseCameraInput {
  const { decay, wake, now, zoom, ...input } = options;
  const glide = createCameraGlide({ decay, orbit: input.orbit, zoom, wake, ...(now ? { now } : {}) });
  const detachInput = attachFlightCameraInput(canvas, { ...input, zoom: factor => glide.zoom(factor), glide });
  return {
    step: at => glide.step(at),
    isActive: channel => glide.isActive(channel),
    cancel: () => glide.cancel(),
    detach() {
      glide.cancel();
      detachInput();
    },
  };
}
