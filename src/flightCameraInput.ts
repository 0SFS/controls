import {
  DEFAULT_ORBIT_INVERT_SETTINGS, isSafariGestureSupported,
  type HudInputMode, type InputSensitivitySettings, type OrbitInvertSettings,
} from "foss-earth/input";
import { PINCH_RELEASE_GAP_MS, type CameraGlide } from "./cameraGlide";

export interface FlightCameraInputOptions {
  getMode(): HudInputMode;
  getSensitivity(): InputSensitivitySettings;
  getOrbitInvert?(): OrbitInvertSettings;
  orbit(dx: number, dy: number): void;
  zoom(factor: number): void;
  onOrbitActive?(active: boolean): void;
  /**
   * osfs.input.touchWheelCooldown: how long to ignore the late wheel pans a
   * browser synthesises after a touch gesture ends, in ms.
   */
  getTouchWheelCooldownMs(): number;
  /**
   * FOSS Earth's glide hooks, which the host's `zoom` feeds: a pinch arms the
   * zoom's release, its fingers lifting release it, and a finger landing on
   * the canvas stops the glide. A trackpad pinch that no event ends is
   * released once it has been quiet for `PINCH_RELEASE_GAP_MS`.
   */
  glide?: Pick<CameraGlide, "arm" | "release" | "cancel">;
}

/** Canvas gestures only; keyboard/gamepad physics input remains independent. */
export function attachFlightCameraInput(canvas: HTMLCanvasElement, options: FlightCameraInputOptions): () => void {
  const owner = canvas.ownerDocument.defaultView!;
  const safari = isSafariGestureSupported();
  const previousTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";
  let drag: { id: number; x: number; y: number } | null = null;
  let gestureScale: number | null = null;
  // Browsers also mark native trackpad pinches as ctrl+wheel. Only a keyboard
  // event tells us that Control is physically held for a flight control.
  let controlHeld = false;
  // TouchEvent.touches includes fingers on the HUD and other windows too.
  // Only contacts whose unconsumed press reached this canvas belong to it.
  const ownedTouches = new Set<number>();
  let touch: { ids: number[]; x: number; y: number; distance: number } | null = null;
  let touchWheelCooldownUntil = 0;
  const setOrbitActive = (active: boolean): void => {
    options.onOrbitActive?.(active);
  };
  const listeners: Array<() => void> = [];
  function listen<E extends Event>(target: EventTarget, name: string, handler: (event: E) => void): void {
    const listener = handler as EventListener;
    target.addEventListener(name, listener, { passive: false });
    listeners.push(() => target.removeEventListener(name, listener));
  }
  const invert = (): OrbitInvertSettings => options.getOrbitInvert?.() ?? DEFAULT_ORBIT_INVERT_SETTINGS;
  // Touch is not a pointer mode: touch gestures pass "touch" for their own
  // sensitivity, and everything else reads the chosen mouse or trackpad.
  const orbit = (x: number, y: number, mode: HudInputMode = options.getMode()) => {
    setOrbitActive(true);
    const sensitivity = options.getSensitivity()[mode].orbit;
    const signs = invert();
    const dx = x * 0.005 * sensitivity * (signs.invertYaw ? -1 : 1);
    const dy = y * 0.005 * sensitivity * (signs.invertPitch ? -1 : 1);
    options.orbit(dx, dy);
  };
  const zoom = (factor: number, mode: HudInputMode = options.getMode()) =>
    options.zoom(Math.pow(factor, options.getSensitivity()[mode].zoom));
  // A pinch does not go on by itself once the fingers stop, as a trackpad's
  // swipe does, so its zoom glides on from its release. A mouse notch only glides.
  const pinch = (factor: number, mode?: HudInputMode) => {
    zoom(factor, mode);
    if (factor !== 1) options.glide?.arm("zoom", PINCH_RELEASE_GAP_MS);
  };
  const clearDrag = () => {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    setOrbitActive(false);
  };
  const touchBlocksWheel = (): boolean => (
    ownedTouches.size > 0 || owner.performance.now() < touchWheelCooldownUntil
  );
  listen(canvas, "pointerdown", (event: PointerEvent) => {
    if (options.getMode() !== "mouse" || event.button !== 2) return;
    event.preventDefault();
    setOrbitActive(true);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId);
  });
  listen(owner, "pointermove", (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (options.getMode() !== "mouse" || !(event.buttons & 2)) { clearDrag(); return; }
    event.preventDefault();
    orbit(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    listen(owner, name, (event: PointerEvent) => { if (event.pointerId === drag?.id) clearDrag(); });
  }
  listen(owner, "keydown", (event: KeyboardEvent) => { controlHeld = event.ctrlKey || event.key === "Control"; });
  listen(owner, "keyup", (event: KeyboardEvent) => { controlHeld = event.ctrlKey; });
  listen(owner, "blur", () => { clearDrag(); ownedTouches.clear(); touch = null; gestureScale = null; controlHeld = false; });
  // Suppress the native right-button menu, including platforms firing it after pointerup.
  listen(canvas, "contextmenu", (event: MouseEvent) => { event.preventDefault(); });
  listen(canvas, "wheel", (event: WheelEvent) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight || 800 : 1;
    if (options.getMode() === "mouse") zoom(Math.exp(Math.max(-1, Math.min(1, event.deltaY * unit * 0.002))));
    else if (event.altKey) {
      // Option/Alt turns a two-finger swipe into zoom, including in Safari.
      zoom(Math.exp(Math.max(-1, Math.min(1, event.deltaY * unit * 0.01))));
    } else if (event.ctrlKey && !controlHeld) {
      // Safari emits native GestureEvents for the same pinch; never apply both streams.
      if (!safari) pinch(Math.exp(Math.max(-1, Math.min(1, event.deltaY * unit * 0.01))));
    } else if (gestureScale === null && !touchBlocksWheel()) {
      // Android Firefox often synthesizes wheel pans alongside touchmove with the
      // opposite delta sign. Prefer the touch path while fingers are down.
      orbit(-event.deltaX * unit, -event.deltaY * unit);
    }
  });
  listen(canvas, "gesturestart", (event: Event & { scale?: number }) => {
    event.preventDefault();
    // Safari fires these for a touchscreen pinch too; with fingers down the
    // touch path owns it, so only a trackpad pinch comes this way.
    gestureScale = options.getMode() === "trackpad" && ownedTouches.size === 0 ? event.scale ?? 1 : null;
  });
  listen(canvas, "gesturechange", (event: Event & { scale?: number }) => {
    event.preventDefault();
    const scale = event.scale;
    if (options.getMode() === "trackpad" && gestureScale !== null && scale && Number.isFinite(scale) && scale > 0) {
      pinch(gestureScale / scale);
      gestureScale = scale;
    }
  });
  listen(canvas, "gestureend", (event: Event) => {
    event.preventDefault();
    gestureScale = null;
    options.glide?.release("zoom");
  });
  const readTouch = (event: TouchEvent) => {
    const contacts = Array.from(event.touches)
      .filter(contact => ownedTouches.has(contact.identifier))
      .sort((a, b) => a.identifier - b.identifier);
    if (contacts.length === 0 || contacts.length > 2) return null;
    const [a, b = a] = contacts;
    return {
      ids: contacts.map(contact => contact.identifier),
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    };
  };
  listen(canvas, "touchstart", (event: TouchEvent) => {
    // A world interaction can reserve its press before camera navigation.
    if (event.defaultPrevented) return;
    let landed = false;
    for (const contact of Array.from(event.changedTouches)) {
      if (contact.target !== canvas || ownedTouches.has(contact.identifier)) continue;
      ownedTouches.add(contact.identifier);
      landed = true;
    }
    if (ownedTouches.size === 0) return;
    event.preventDefault();
    // A finger landing on the canvas stops the glide where it is.
    if (landed) options.glide?.cancel();
    gestureScale = null;
    touch = readTouch(event);
    setOrbitActive(touch !== null);
    touchWheelCooldownUntil = 0;
  });
  listen(canvas, "touchmove", (event: TouchEvent) => {
    if (ownedTouches.size === 0) return;
    event.preventDefault();
    const next = readTouch(event);
    // One or two canvas fingers orbit at the same rate in either pointer mode.
    // Contact changes establish a new baseline rather than moving the camera.
    if (touch && next && touch.ids.length === next.ids.length
      && touch.ids.every((id, index) => id === next.ids[index]) && gestureScale === null) {
      // Match mouse/trackpad grab direction: finger right → positive yaw.
      // Older code used (prev - next), which felt inverted on Android touch
      // relative to desktop Firefox trackpad wheel pans.
      orbit(next.x - touch.x, next.y - touch.y, "touch");
      if (touch.ids.length === 2 && touch.distance > 0 && next.distance > 0) pinch(touch.distance / next.distance, "touch");
    }
    setOrbitActive(next !== null && gestureScale === null);
    touch = next;
  });
  for (const name of ["touchend", "touchcancel"]) {
    listen(canvas, name, (event: TouchEvent) => {
      if (ownedTouches.size === 0) return;
      event.preventDefault();
      let lifted = false;
      for (const contact of Array.from(event.changedTouches)) lifted = ownedTouches.delete(contact.identifier) || lifted;
      // A pinch's finger lifted: its zoom glides on.
      if (lifted) options.glide?.release("zoom");
      const nextTouch = readTouch(event);
      touch = nextTouch;
      setOrbitActive(nextTouch !== null);
      touchWheelCooldownUntil = owner.performance.now() + options.getTouchWheelCooldownMs();
    });
  }
  return () => {
    ownedTouches.clear();
    touch = null;
    clearDrag();
    listeners.forEach((remove) => remove());
    canvas.style.touchAction = previousTouchAction;
  };
}
