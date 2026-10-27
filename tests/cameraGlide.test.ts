import { describe, expect, it, vi } from "vitest";
import { createCameraGlide, createTouchSurfaceGlide, DEFAULT_GLIDE_DECAY, PINCH_RELEASE_GAP_MS } from "../src/cameraGlide";

const FRAME = 1000 / 60;
/** What a release tail feeds in all, in ms of its release speed: ∫ exp(−3t / 1100 ms) over 1.1 s. */
const TAIL_MS = 1100 / 3 * (1 - Math.exp(-3));

function setup(decay = DEFAULT_GLIDE_DECAY) {
  let t = 0;
  let keep = decay;
  const turned = { yaw: 0, pitch: 0 };
  let logZoom = 0;
  const orbit = vi.fn((yaw: number, pitch: number) => { turned.yaw += yaw; turned.pitch += pitch; });
  const zoom = vi.fn((factor: number) => { logZoom += Math.log(factor); });
  const wake = vi.fn();
  const glide = createCameraGlide({ decay: () => keep, orbit, zoom, wake, now: () => t });
  return {
    glide, orbit, zoom, wake, turned,
    get logZoom() { return logZoom; },
    get now() { return t; },
    at(ms: number) { t = ms; },
    setDecay(value: number) { keep = value; },
    /** One frame: time moves on and the glide steps. */
    frame(ms = FRAME) { t += ms; return glide.step(t); },
    /** Frames until `untilMs`. */
    run(untilMs: number, ms = FRAME) { while (t + ms <= untilMs + 1e-9) { t += ms; glide.step(t); } },
  };
}

describe("camera glide", () => {
  it("moves the camera exactly as far as the input, over a few frames", () => {
    const s = setup();
    s.glide.orbit(0.3, -0.1);
    s.glide.zoom(2);
    expect(s.orbit).not.toHaveBeenCalled();
    s.frame();
    expect(s.turned.yaw).toBeGreaterThan(0);
    expect(s.turned.yaw).toBeLessThan(0.3);
    s.run(3000);
    expect(s.turned.yaw).toBeCloseTo(0.3, 12);
    expect(s.turned.pitch).toBeCloseTo(-0.1, 12);
    expect(s.logZoom).toBeCloseTo(Math.log(2), 12);
    expect(s.glide.isActive()).toBe(false);
  });

  it("follows FOSS Earth's curve at 60 Hz, scaled to one to one", () => {
    const s = setup();
    s.glide.orbit(1, 0);
    // FOSS Earth applies a velocity of 1, then 0.82, then 0.82², …; here each is (1 − 0.82) of that.
    const moves: number[] = [];
    let before = 0;
    for (let index = 0; index < 4; index++) { s.frame(); moves.push(s.turned.yaw - before); before = s.turned.yaw; }
    moves.forEach((move, index) => expect(move).toBeCloseTo((1 - DEFAULT_GLIDE_DECAY) * DEFAULT_GLIDE_DECAY ** index, 12));
  });

  it("draws the same motion at 120 Hz as at 60 Hz", () => {
    const at60 = setup();
    const at120 = setup();
    // Frames running, and the input between two of them.
    at60.run(100, FRAME);
    at120.run(100, FRAME / 2);
    at60.glide.orbit(0.5, 0.2);
    at120.glide.orbit(0.5, 0.2);
    for (const ms of [150, 200, 350]) {
      at60.run(ms, FRAME);
      at120.run(ms, FRAME / 2);
      expect(at120.turned.yaw).toBeCloseTo(at60.turned.yaw, 9);
      expect(at120.turned.pitch).toBeCloseTo(at60.turned.pitch, 9);
    }
  });

  it("glides a wheel notch, which is not armed, but never past it", () => {
    const s = setup();
    s.glide.zoom(1.25);
    s.glide.release("zoom");
    s.run(3000);
    expect(s.logZoom).toBeCloseTo(Math.log(1.25), 12);
  });

  it("carries a released pinch on at its speed, fading over 1.1 s", () => {
    const s = setup();
    for (let index = 0; index <= 12; index++) {
      if (index > 0) s.frame();
      s.glide.zoom(Math.exp(0.01));
      s.glide.arm("zoom");
    }
    s.glide.release("zoom");
    expect(s.glide.isActive("zoom")).toBe(true);
    s.run(s.now + 3000);
    // The last 120 ms held 8 of the 0.01 steps, 7 frames apart.
    const speed = 0.08 / (7 * FRAME);
    expect(s.logZoom).toBeCloseTo(0.13 + speed * TAIL_MS, 9);
    expect(s.glide.isActive()).toBe(false);
  });

  it("ends an armed pinch whose events stop for the pinch gap, as on a trackpad", () => {
    const s = setup();
    for (let index = 0; index <= 12; index++) {
      if (index > 0) s.frame();
      s.glide.zoom(Math.exp(0.01));
      s.glide.arm("zoom", PINCH_RELEASE_GAP_MS);
    }
    const lastInput = s.now;
    // Waiting for the gap keeps frames coming, as it does in FOSS Earth.
    while (s.now - lastInput < PINCH_RELEASE_GAP_MS - FRAME) expect(s.frame()).toBe(true);
    s.run(s.now + 3000);
    expect(s.logZoom).toBeCloseTo(0.13 + 0.08 / (7 * FRAME) * TAIL_MS, 9);
  });

  it("leaves no glide when the finger rested before it lifted", () => {
    const s = setup();
    for (let index = 0; index <= 6; index++) {
      if (index > 0) s.frame();
      s.glide.orbit(0.01, 0);
      s.glide.arm("orbit");
    }
    s.run(s.now + 150);
    s.glide.release("orbit");
    s.run(s.now + 3000);
    expect(s.turned.yaw).toBeCloseTo(0.07, 12);
  });

  it("glides less the longer the finger rested", () => {
    const glideAfter = (restMs: number) => {
      const s = setup();
      for (let index = 0; index <= 12; index++) {
        if (index > 0) s.frame();
        s.glide.orbit(0.01, 0);
        s.glide.arm("orbit");
      }
      s.run(s.now + restMs);
      s.glide.release("orbit");
      s.run(s.now + 3000);
      return s.turned.yaw - 0.13;
    };
    const [none, some, most] = [glideAfter(0), glideAfter(50), glideAfter(100)];
    expect(none).toBeGreaterThan(some);
    expect(some).toBeGreaterThan(most);
    expect(most).toBeGreaterThan(0);
  });

  it("stops where it is when a finger lands", () => {
    const s = setup();
    s.glide.orbit(0.05, 0);
    s.glide.arm("orbit");
    s.glide.release("orbit");
    s.run(s.now + 100);
    const stopped = s.turned.yaw;
    s.glide.cancel();
    expect(s.glide.isActive()).toBe(false);
    s.run(s.now + 1000);
    expect(s.turned.yaw).toBe(stopped);
  });

  it("ends a release's tail when new input arrives on its channel", () => {
    const s = setup();
    s.glide.orbit(0.05, 0);
    s.glide.arm("orbit");
    s.glide.release("orbit");
    s.run(s.now + 50);
    // An unarmed push, like a wheel notch: what is owed still moves, and nothing feeds it.
    s.glide.orbit(0.01, 0);
    const moves: number[] = [];
    let before = s.turned.yaw;
    for (let index = 0; index < 3; index++) { s.frame(); moves.push(s.turned.yaw - before); before = s.turned.yaw; }
    expect(moves[1] / moves[0]).toBeCloseTo(DEFAULT_GLIDE_DECAY, 12);
    expect(moves[2] / moves[1]).toBeCloseTo(DEFAULT_GLIDE_DECAY, 12);
  });

  it("moves at once with no glide at decay 0, read live", () => {
    const s = setup(0);
    s.glide.orbit(0.2, 0.1);
    expect(s.orbit).toHaveBeenCalledWith(0.2, 0.1);
    s.glide.arm("orbit");
    s.glide.release("orbit");
    expect(s.frame()).toBe(false);
    expect(s.orbit).toHaveBeenCalledTimes(1);
    s.setDecay(0.5);
    s.glide.orbit(0.1, 0);
    s.frame();
    expect(s.turned.yaw).toBeCloseTo(0.2 + 0.05, 12);
  });

  it("moves a new input's first frame in full however late in the frame it came, as FOSS Earth does", () => {
    const s = setup();
    s.run(100);
    s.at(115);
    s.glide.orbit(1, 0);
    s.frame(100 + FRAME - 115);
    expect(s.turned.yaw).toBeCloseTo(1 - DEFAULT_GLIDE_DECAY, 12);
  });

  it("after a pause, moves a new input's first frame by a 60 Hz frame's share, however soon it comes", () => {
    const s = setup();
    s.run(100);
    s.at(10_000);
    s.glide.orbit(1, 0);
    s.frame(5);
    expect(s.turned.yaw).toBeCloseTo(1 - DEFAULT_GLIDE_DECAY, 12);
    // And from there on its own timeline: no frame is counted twice.
    s.frame(FRAME);
    expect(s.turned.yaw).toBeCloseTo(1 - DEFAULT_GLIDE_DECAY ** 2, 12);
  });

  it("glides a swipe on from a lift read a frame after its last movement, without slowing first", () => {
    const s = setup();
    const moves: number[] = [];
    let before = 0;
    // As the flight does: the frame's input, then its step.
    const frame = (input: () => void) => {
      s.at(s.now + FRAME);
      input();
      s.glide.step(s.now);
      moves.push(s.turned.yaw - before);
      before = s.turned.yaw;
    };
    for (let index = 0; index < 30; index++) frame(() => { s.glide.orbit(0.01, 0); s.glide.arm("orbit"); });
    frame(() => s.glide.release("orbit"));
    const lifted = moves.length - 1;
    // FOSS Earth feeds the release's first frame in full, so the speed carries straight on.
    expect(moves[lifted]).toBeGreaterThan(moves[lifted - 1] * 0.97);
    expect(moves[lifted + 0]).toBeLessThan(moves[lifted - 1] * 1.03);
  });

  it("ends a long Glide without a jump, dropping a remainder below a pixel as FOSS Earth does", () => {
    const s = setup(0.99);
    s.glide.orbit(1, 0);
    let last = 0;
    let before = 0;
    while (s.frame()) { last = s.turned.yaw - before; before = s.turned.yaw; }
    last = s.turned.yaw - before || last;
    // Without the cap it is 0.2°, a hundred times the speed before it.
    expect(Math.abs(last)).toBeLessThan(0.02 * Math.PI / 180);
    expect(s.turned.yaw).toBeCloseTo(1, 2);
    expect(s.turned.yaw).toBeLessThanOrEqual(1);
  });

  it("caps a frame's turn at FOSS Earth's 12°", () => {
    const s = setup();
    s.glide.orbit(10, 0);
    s.frame();
    expect(s.turned.yaw).toBeCloseTo(12 * Math.PI / 180, 12);
    s.run(3000);
    expect(s.turned.yaw).toBeCloseTo(12 * Math.PI / 180 / (1 - DEFAULT_GLIDE_DECAY), 12);
  });

  it("asks for frames while it moves or waits for a pinch gap, and not at rest", () => {
    const s = setup();
    expect(s.frame()).toBe(false);
    s.glide.zoom(1.1);
    expect(s.wake).toHaveBeenCalledTimes(1);
    s.glide.arm("zoom", PINCH_RELEASE_GAP_MS);
    expect(s.wake).toHaveBeenCalledTimes(2);
    expect(s.frame()).toBe(true);
    s.run(s.now + 3000);
    expect(s.frame()).toBe(false);
    // An arm without a gap waits for its release, which a frame does not watch for.
    s.glide.arm("orbit");
    expect(s.glide.isActive()).toBe(false);
  });

  it("ignores input that is not a number, and a zoom that is not a factor", () => {
    const s = setup();
    s.glide.orbit(Number.NaN, 0);
    s.glide.zoom(0);
    s.glide.zoom(-2);
    s.glide.zoom(Number.POSITIVE_INFINITY);
    expect(s.glide.isActive()).toBe(false);
    expect(s.wake).not.toHaveBeenCalled();
  });
});

describe("touch surface glide", () => {
  const still = { yaw: 0, pitch: 0, zoom: 1 };
  function surface() {
    const s = setup();
    const pad = createTouchSurfaceGlide(s.glide);
    /** One rendered frame of the pad, then the glide's step. */
    const touch = (fingers: number | null, move: Partial<typeof still> = {}) => {
      pad.frame({ fingers, ...still, ...move });
      s.frame();
    };
    return Object.assign(s, { pad, touch });
  }

  it("glides a swipe on when the finger lifts, counting the movement of that same frame", () => {
    const s = surface();
    s.touch(0);
    for (let index = 0; index < 8; index++) s.touch(1, { yaw: 0.01 });
    s.touch(0, { yaw: 0.01 });
    s.run(s.now + 3000);
    expect(s.turned.yaw).toBeGreaterThan(0.09 + 0.01);
  });

  it("stops the glide when a finger lands, as FOSS Earth's touchstart does", () => {
    const s = surface();
    s.touch(1, { yaw: 0.05 });
    s.touch(0);
    expect(s.glide.isActive("orbit")).toBe(true);
    s.touch(1);
    expect(s.glide.isActive()).toBe(false);
  });

  it("stops the swipe for a pinch, and glides the pinch on when a finger of it lifts", () => {
    const s = surface();
    s.touch(1, { yaw: 0.05 });
    s.touch(2);
    expect(s.glide.isActive("orbit")).toBe(false);
    for (let index = 0; index < 6; index++) s.touch(2, { zoom: 1.02 });
    s.touch(1);
    expect(s.glide.isActive("zoom")).toBe(true);
    s.run(s.now + 3000);
    expect(s.logZoom).toBeGreaterThan(6 * Math.log(1.02));
  });

  it("only glides movement with no finger down, such as an arrow key", () => {
    const s = surface();
    s.touch(0);
    s.touch(0, { yaw: 0.05 });
    s.run(s.now + 3000);
    expect(s.turned.yaw).toBeCloseTo(0.05, 12);
  });

  it("ends a gesture from a pad that does not count its fingers after the pinch gap", () => {
    const s = surface();
    for (let index = 0; index < 8; index++) s.touch(null, { yaw: 0.01 });
    s.run(s.now + PINCH_RELEASE_GAP_MS + FRAME);
    s.run(s.now + 3000);
    expect(s.turned.yaw).toBeGreaterThan(0.08 + 0.01);
    expect(s.glide.isActive()).toBe(false);
  });

  it("glides a swipe on when the surface stops counting with a finger down, as when another pilot takes over", () => {
    const s = surface();
    s.touch(1);
    for (let index = 0; index < 6; index++) s.touch(1, { yaw: 0.01 });
    s.touch(null);
    s.run(s.now + 3000);
    expect(s.turned.yaw).toBeGreaterThan(0.06 + 0.01);
    expect(s.glide.isActive()).toBe(false);
  });
});
