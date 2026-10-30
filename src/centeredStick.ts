/** A centered flight pad. Coordinates are screen axes: right and down positive. */
export const INSTRUMENT_STICK_HALF_SHARE = 96 / 220;

export interface CenteredStickInput {
  at: number;
  coalesced(): number;
}

export interface CenteredStickOptions {
  halfShare?: number;
  onChange(x: number, y: number, input?: CenteredStickInput): void;
  onPosition?(x: number, y: number, held: boolean): void;
  disabled?(): boolean;
  /** Instrument pads use independent axis travel; plain pads may use a circle. */
  square?(): boolean;
  horizontal?: boolean;
}

export function stickResponse(value: number): number {
  return Math.abs(value) <= .035 ? 0 : Math.sign(value) * (Math.abs(value) - .035) / .965;
}

export function inverseStickResponse(value: number): number {
  return value === 0 ? 0 : Math.sign(value) * (Math.abs(value) * .965 + .035);
}

/** One captured pointer per pad, so two pads can be flown simultaneously. */
export function mountCenteredStick(surface: HTMLElement, options: CenteredStickOptions) {
  const doc = surface.ownerDocument;
  const view = doc.defaultView;
  let pointer: number | null = null;
  let x = 0;
  let y = 0;
  const keys = new Set<string>();
  const isHolding = () => pointer !== null || keys.size > 0;
  const bound = (nextX: number, nextY: number) => {
    if (options.horizontal) nextY = 0;
    if (options.square?.() !== false) return {
      x: Math.max(-1, Math.min(1, nextX)), y: Math.max(-1, Math.min(1, nextY)),
    };
    const magnitude = Math.max(1, Math.hypot(nextX, nextY));
    return { x: nextX / magnitude, y: nextY / magnitude };
  };
  const apply = (nextX: number, nextY: number, input?: CenteredStickInput) => {
    ({ x, y } = bound(nextX, nextY));
    options.onPosition?.(x, y, isHolding());
    options.onChange(x, y, input);
  };
  const release = () => {
    const held = isHolding() || x !== 0 || y !== 0;
    const captured = pointer;
    // Clear first: releasePointerCapture can synchronously dispatch lost capture.
    pointer = null;
    keys.clear();
    surface.removeAttribute("data-active");
    if (captured !== null && surface.hasPointerCapture?.(captured)) surface.releasePointerCapture(captured);
    if (held) apply(0, 0);
  };
  const move = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    if (options.disabled?.()) { release(); return; }
    event.preventDefault();
    const rect = surface.getBoundingClientRect();
    const half = Math.max(1, Math.min(rect.width, options.horizontal ? rect.width : rect.height) * (options.halfShare ?? .5));
    apply((event.clientX - rect.left - rect.width / 2) / half,
      (event.clientY - rect.top - rect.height / 2) / half,
      { at: event.timeStamp, coalesced: () => event.getCoalescedEvents?.().length || 1 });
  };
  const down = (event: PointerEvent) => {
    if (pointer !== null || event.button !== 0 || options.disabled?.()) return;
    event.preventDefault();
    keys.clear();
    pointer = event.pointerId;
    surface.setPointerCapture?.(pointer);
    surface.setAttribute("data-active", "");
    move(event);
  };
  const end = (event: PointerEvent) => { if (pointer === event.pointerId) release(); };
  const key = (event: KeyboardEvent, pressed: boolean) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      || pointer !== null || options.disabled?.()) return;
    // A delayed keyup after blur/resize must not claim local input ownership.
    if (!pressed && !keys.has(event.key)) return;
    event.preventDefault();
    if (pressed) keys.add(event.key);
    else keys.delete(event.key);
    surface.toggleAttribute("data-active", keys.size > 0);
    apply(Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft")),
      Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp")));
  };
  const keyDown = (event: KeyboardEvent) => key(event, true);
  const keyUp = (event: KeyboardEvent) => key(event, false);
  const hide = () => { if (doc.hidden) release(); };
  const context = (event: Event) => event.preventDefault();
  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerup", end);
  surface.addEventListener("pointercancel", end);
  surface.addEventListener("lostpointercapture", end);
  surface.addEventListener("keydown", keyDown);
  surface.addEventListener("keyup", keyUp);
  surface.addEventListener("blur", release);
  surface.addEventListener("contextmenu", context);
  view?.addEventListener("blur", release);
  view?.addEventListener("resize", release);
  view?.addEventListener("orientationchange", release);
  doc.addEventListener("visibilitychange", hide);
  return {
    release,
    isHolding,
    getPosition: () => ({ x, y, held: isHolding() }),
    destroy() {
      release();
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", end);
      surface.removeEventListener("pointercancel", end);
      surface.removeEventListener("lostpointercapture", end);
      surface.removeEventListener("keydown", keyDown);
      surface.removeEventListener("keyup", keyUp);
      surface.removeEventListener("blur", release);
      surface.removeEventListener("contextmenu", context);
      view?.removeEventListener("blur", release);
      view?.removeEventListener("resize", release);
      view?.removeEventListener("orientationchange", release);
      doc.removeEventListener("visibilitychange", hide);
    },
  };
}
