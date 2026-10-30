/**
 * FOSS Earth's camera glide (engine `input/inertialCameraController.ts`) for
 * the chase camera: input moves the camera over the next few frames instead
 * of in one, and a gesture that nothing continues after the fingers lift (a
 * pinch, a phone swipe) goes on at its release speed and slows to a stop.
 *
 * FOSS Earth adds each input to a velocity that every frame applies in full
 * and then keeps `camera.inertiaDecay` of, per 60 Hz frame. An input moves
 * its camera 1 / (1 − decay) times as far, 5.6 times at the default and more
 * on a faster display, and its input rates were tuned with that gain. The
 * chase camera's rates move it once, by exactly the input. So each channel
 * here holds the motion still owed, and a step moves the share of it that a
 * 60 Hz frame of FOSS Earth's would: its curve at 60 Hz, one to one, and the
 * same curve at any frame rate.
 */

export type GlideChannel = "orbit" | "zoom";

/** FOSS Earth's decay, caps and rests are per 60 Hz frame. */
const FRAME_MS = 1000 / 60;
/** `camera.inertiaDecay`'s default: the share of its speed a 60 Hz frame keeps. */
export const DEFAULT_GLIDE_DECAY = 0.82;
/** The input a release's speed is measured over. */
const RELEASE_WINDOW_MS = 120;
/** The longest frame FOSS Earth steps by: a release's tail starts being fed no further back than this. */
const MAX_FRAME_MS = 100;
/** An armed pinch this quiet has ended: shorter than a trackpad's event gap, so a live pinch is not cut in two. */
export const PINCH_RELEASE_GAP_MS = 48;
/**
 * How long a release goes on being fed, its speed fading as exp(−3t / 1.1 s):
 * the momentum a trackpad gives a swipe of its own.
 */
const RELEASE_TAIL_MS = 1100;
/** The most a 60 Hz frame of glide turns (12°) or zooms (a natural log of 0.14). */
const MAX_STEP: Record<GlideChannel, number> = { orbit: 12 * Math.PI / 180, zoom: 0.14 };
/** A channel moving less than this a 60 Hz frame has settled: 0.002° of turn, 0.00005 of log zoom. */
const REST_STEP: Record<GlideChannel, number> = { orbit: 0.002 * Math.PI / 180, zoom: 0.00005 };
const CHANNELS: readonly GlideChannel[] = ["orbit", "zoom"];

export interface CameraGlideOptions {
  /** `camera.inertiaDecay`, read on every input and step. 0 moves the camera at once, with no glide. */
  decay(): number;
  /** Turns the camera by `yaw` and `pitch`, radians. */
  orbit(yaw: number, pitch: number): void;
  /** Multiplies the camera's distance by `factor`. */
  zoom(factor: number): void;
  /** Input arrived: draw a frame, so that the camera of a paused flight moves too. */
  wake?(): void;
  /** Monotonic milliseconds. `performance.now` by default. */
  now?(): number;
}

export interface CameraGlide {
  /** Input turned the camera by `yaw` and `pitch`, radians. */
  orbit(yaw: number, pitch: number): void;
  /** Input multiplied the camera's distance by `factor`. */
  zoom(factor: number): void;
  /**
   * The input on `channel` will not go on by itself after the fingers lift:
   * keep its recent speed for `release`. With `gapMs`, it is also released
   * once its input has been quiet that long, for a gesture whose lift nothing
   * reports.
   */
  arm(channel: GlideChannel, gapMs?: number): void;
  /** The armed gesture's fingers lifted: it glides on at its speed. */
  release(channel: GlideChannel): void;
  /** A finger landed: the camera stops where it is. */
  cancel(): void;
  /**
   * A finger joined those already down: what glides on from an earlier lift
   * stops where it is, and what the fingers down are moving goes on.
   */
  hold(): void;
  /**
   * Moves the camera for the time since the last step. True while it has more
   * to move, or a release to watch for.
   */
  step(now?: number): boolean;
  /** Something still to move on `channel`, or on either. */
  isActive(channel?: GlideChannel): boolean;
}

interface Sample { t: number; a: number; b: number }
/** Orbit is `a` yaw and `b` pitch; zoom is `a`, the natural log of the distance factor. */
interface ChannelState {
  owedA: number;
  owedB: number;
  armed: boolean;
  gapMs: number | null;
  recent: Sample[];
  last: Sample | null;
  /** The release speed per ms, and how much of the tail has been fed. */
  tail: { a: number; b: number; startedAt: number; fedMs: number } | null;
}

const idle = (): ChannelState => ({ owedA: 0, owedB: 0, armed: false, gapMs: null, recent: [], last: null, tail: null });

/** How much of a tail's speed has been fed by `ms` into it, in ms of release speed. */
const tailShare = (ms: number): number => RELEASE_TAIL_MS / 3 * (1 - Math.exp(-3 * ms / RELEASE_TAIL_MS));

export function createCameraGlide(options: CameraGlideOptions): CameraGlide {
  const clock = options.now ?? (() => performance.now());
  const channels: Record<GlideChannel, ChannelState> = { orbit: idle(), zoom: idle() };
  let steppedAt: number | null = null;
  /** Input from rest after a pause: its first step moves at least a 60 Hz frame's share. */
  let fresh = false;

  const decay = (): number => {
    const value = options.decay();
    return Number.isFinite(value) ? Math.min(0.999, Math.max(0, value)) : DEFAULT_GLIDE_DECAY;
  };
  const apply = (channel: GlideChannel, a: number, b: number): void => {
    if (channel === "orbit") { if (a !== 0 || b !== 0) options.orbit(a, b); } else if (a !== 0) options.zoom(Math.exp(a));
  };
  const busy = (state: ChannelState): boolean => state.owedA !== 0 || state.owedB !== 0 || state.tail !== null
    || (state.armed && state.gapMs !== null);
  const isActive = (channel?: GlideChannel): boolean => channel ? busy(channels[channel]) : busy(channels.orbit) || busy(channels.zoom);
  /**
   * FOSS Earth caps the velocity a frame applies; here that is the motion
   * owed of which a 60 Hz frame applies that much.
   */
  const bound = (channel: GlideChannel, value: number, keep: number): number => {
    const most = MAX_STEP[channel] / (1 - keep);
    return Math.max(-most, Math.min(most, value));
  };
  const remember = (samples: Sample[], sample: Sample): Sample[] => {
    const kept = samples.filter(item => item.t >= sample.t - RELEASE_WINDOW_MS);
    kept.push(sample);
    return kept;
  };

  /**
   * The armed gesture ended at `endedAt`: its speed is what it moved in the
   * window before then, so a finger that rested before lifting has little or
   * none. The tail starts being fed at `startedAt`.
   */
  const beginTail = (state: ChannelState, endedAt: number, startedAt: number): void => {
    const kept = state.recent.filter(sample => sample.t >= endedAt - RELEASE_WINDOW_MS);
    state.armed = false;
    state.gapMs = null;
    state.recent = [];
    if (kept.length === 0) return;
    let a = 0;
    let b = 0;
    for (const sample of kept) { a += sample.a; b += sample.b; }
    if (a === 0 && b === 0) return;
    const span = Math.max(FRAME_MS, endedAt - kept[0].t);
    state.tail = { a: a / span, b: b / span, startedAt, fedMs: 0 };
  };

  const push = (channel: GlideChannel, a: number, b: number): void => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return;
    const keep = decay();
    if (keep === 0) { apply(channel, a, b); return; }
    const at = clock();
    // FOSS Earth moves a new input's first frame in full in the frame after it, however late
    // in that frame it came: so from rest it counts from the frame before it. After a pause
    // there is none, and it counts from itself, its first step moving a 60 Hz frame's share.
    if (!isActive() && (steppedAt === null || at - steppedAt > FRAME_MS * 2)) { steppedAt = at; fresh = true; }
    const state = channels[channel];
    state.tail = null;
    const sample = { t: at, a, b };
    state.last = sample;
    if (state.armed) state.recent = remember(state.recent, sample);
    state.owedA = bound(channel, state.owedA + a, keep);
    state.owedB = bound(channel, state.owedB + b, keep);
    options.wake?.();
  };

  const feedTail = (channel: GlideChannel, state: ChannelState, now: number, keep: number): void => {
    const tail = state.tail!;
    const elapsed = Math.min(RELEASE_TAIL_MS, Math.max(0, now - tail.startedAt));
    if (elapsed > tail.fedMs) {
      const share = tailShare(elapsed) - tailShare(tail.fedMs);
      state.owedA = bound(channel, state.owedA + tail.a * share, keep);
      state.owedB = bound(channel, state.owedB + tail.b * share, keep);
      tail.fedMs = elapsed;
    }
    if (elapsed >= RELEASE_TAIL_MS) state.tail = null;
  };

  return {
    orbit: (yaw, pitch) => push("orbit", yaw, pitch),
    zoom: factor => { if (Number.isFinite(factor) && factor > 0) push("zoom", Math.log(factor), 0); },
    arm(channel, gapMs) {
      if (decay() === 0) return;
      const state = channels[channel];
      const at = clock();
      // The input that set it moving arrives just before it is armed.
      if (!state.armed && state.last && at - state.last.t <= FRAME_MS * 2) state.recent = remember(state.recent, state.last);
      state.armed = true;
      state.gapMs = gapMs !== undefined && gapMs >= 0 ? gapMs : null;
      if (state.gapMs !== null) options.wake?.();
    },
    release(channel) {
      const state = channels[channel];
      if (!state.armed) return;
      const at = clock();
      // Fed from the last frame, as FOSS Earth feeds a release's first frame in full, or from
      // the last movement if that came since, whose own share already fills the frame up to it.
      const from = Math.max(at - MAX_FRAME_MS, steppedAt ?? at, state.last?.t ?? at);
      beginTail(state, at, Math.min(at, from));
      if (state.tail) options.wake?.();
    },
    cancel() {
      for (const channel of CHANNELS) channels[channel] = idle();
      fresh = false;
    },
    hold() {
      for (const channel of CHANNELS) if (!channels[channel].armed) channels[channel] = idle();
    },
    step(now = clock()) {
      const previous = steppedAt ?? now - FRAME_MS;
      let elapsed = steppedAt === null ? FRAME_MS : Math.max(0, now - steppedAt);
      if (fresh) { elapsed = Math.max(elapsed, FRAME_MS); fresh = false; }
      steppedAt = now;
      const keep = decay();
      const kept = Math.pow(keep, elapsed / FRAME_MS);
      for (const channel of CHANNELS) {
        const state = channels[channel];
        // A gesture whose lift nothing reports ended with its last input.
        if (state.armed && state.gapMs !== null && state.last && now - state.last.t >= state.gapMs) {
          beginTail(state, state.last.t, Math.min(now, Math.max(now - MAX_FRAME_MS, previous, state.last.t)));
        }
        if (state.tail) feedTail(channel, state, now, keep);
        if (state.owedA === 0 && state.owedB === 0) continue;
        let a = state.owedA * (1 - kept);
        let b = state.owedB * (1 - kept);
        state.owedA -= a;
        state.owedB -= b;
        // Settled: the rest goes now, so the camera ends exactly where the input took it. A long
        // Glide owes more at that point; past what the default would, it is dropped, as FOSS Earth
        // drops it, rather than jumping.
        if (!state.tail && Math.max(Math.abs(state.owedA), Math.abs(state.owedB)) * (1 - keep) < REST_STEP[channel]) {
          const most = REST_STEP[channel] / (1 - DEFAULT_GLIDE_DECAY);
          a += Math.max(-most, Math.min(most, state.owedA));
          b += Math.max(-most, Math.min(most, state.owedB));
          state.owedA = 0;
          state.owedB = 0;
        }
        apply(channel, a, b);
      }
      return isActive();
    },
    isActive,
  };
}

/** One rendered frame of a touch surface: the fingers on it now, and what it moved since the last. */
export interface TouchSurfaceFrame {
  /** Null from a surface that does not say. */
  fingers: number | null;
  /** Radians. */
  yaw: number;
  pitch: number;
  /** Distance factor; 1 for none. */
  zoom: number;
}

/**
 * Drives a glide from a touch surface that counts its fingers, as FOSS Earth's
 * touchscreen does: the first finger landing stops the glide, and one joining
 * it stops only what glides on from an earlier lift. Movement while a finger
 * is down is armed, and a finger lifting lets it glide on: a pinch's zoom when
 * either of its two lifts, a swipe's turn once the last has. Movement with none
 * down, such as an arrow key, only glides. A surface that does not count
 * (`fingers` null, one that predates it) ends a gesture when its movement has
 * been quiet for `PINCH_RELEASE_GAP_MS`, and one that stops counting with a
 * finger down (another pilot took over) ends it as a lift would.
 */
export function createTouchSurfaceGlide(glide: Pick<CameraGlide, "orbit" | "zoom" | "arm" | "release" | "cancel" | "hold">): { frame(frame: TouchSurfaceFrame): void } {
  let before: number | null = null;
  return {
    frame({ fingers, yaw, pitch, zoom }) {
      // A second finger joining a swipe leaves its turn going, so the swipe carries on into the pinch.
      if (fingers !== null && before !== null && fingers > before) { if (before === 0) glide.cancel(); else glide.hold(); }
      // Movement that ends with a lift in this same frame was still the fingers'.
      const held = fingers === null ? null : Math.max(fingers, before ?? 0) > 0;
      const gap = held === null ? PINCH_RELEASE_GAP_MS : undefined;
      if (yaw !== 0 || pitch !== 0) {
        glide.orbit(yaw, pitch);
        if (held !== false) glide.arm("orbit", gap);
      }
      if (zoom !== 1 && Number.isFinite(zoom) && zoom > 0) {
        glide.zoom(zoom);
        if (held !== false) glide.arm("zoom", gap);
      }
      // Two fingers that turn the view as they pinch leave one that goes on turning it.
      const left = fingers ?? 0;
      if (before !== null && left < before) {
        if (left < 2) glide.release("zoom");
        if (left === 0) glide.release("orbit");
      }
      before = fingers;
    },
  };
}
