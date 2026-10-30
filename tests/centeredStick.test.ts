// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountCenteredStick, stickResponse, inverseStickResponse } from "../src/centeredStick";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function pad() {
  const node = document.createElement("button");
  document.body.append(node);
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
  const captured = new Set<number>();
  node.setPointerCapture = id => { captured.add(id); };
  node.hasPointerCapture = id => captured.has(id);
  node.releasePointerCapture = id => {
    captured.delete(id);
    pointer(node, "lostpointercapture", id, 100, 100);
  };
  const change = vi.fn();
  const stick = mountCenteredStick(node, { onChange: change });
  return { node, change, stick };
}

function pointer(node: HTMLElement, type: string, pointerId: number, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId, clientX, clientY, button: 0 });
  node.dispatchEvent(event);
}

describe("centered flight sticks", () => {
  it("captures each thumb independently with full diagonal axis travel", () => {
    const left = pad(), right = pad();
    pointer(left.node, "pointerdown", 1, 200, 0);
    pointer(right.node, "pointerdown", 2, 0, 200);
    expect(left.change.mock.lastCall?.slice(0, 2)).toEqual([1, -1]);
    expect(right.change.mock.lastCall?.slice(0, 2)).toEqual([-1, 1]);
    pointer(left.node, "pointerup", 2, 100, 100);
    expect(left.stick.isHolding()).toBe(true);
    pointer(left.node, "pointerup", 1, 100, 100);
    expect(left.change.mock.lastCall?.slice(0, 2)).toEqual([0, 0]);
    expect(right.stick.isHolding()).toBe(true);
    left.stick.destroy(); right.stick.destroy();
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture"])("neutralizes once on %s, including synchronous capture loss", type => {
    const t = pad();
    pointer(t.node, "pointerdown", 1, 200, 0);
    pointer(t.node, type, 1, 200, 0);
    expect(t.change.mock.calls.map(call => call.slice(0, 2))).toEqual([[1, -1], [0, 0]]);
    t.stick.destroy();
    expect(t.change).toHaveBeenCalledTimes(2);
  });

  it.each(["blur", "resize", "orientationchange"])("releases on window %s without generating idle pilot input", type => {
    const t = pad();
    window.dispatchEvent(new Event(type));
    expect(t.change).not.toHaveBeenCalled();
    pointer(t.node, "pointerdown", 1, 200, 0);
    window.dispatchEvent(new Event(type));
    expect(t.stick.getPosition()).toEqual({ x: 0, y: 0, held: false });
    t.stick.destroy();
  });

  it("centers keyboard axes on release and teardown", () => {
    const t = pad();
    for (const key of ["ArrowUp", "ArrowRight"]) t.node.dispatchEvent(new KeyboardEvent("keydown", { key }));
    expect(t.change.mock.lastCall?.slice(0, 2)).toEqual([1, -1]);
    t.node.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" }));
    expect(t.change.mock.lastCall?.slice(0, 2)).toEqual([1, 0]);
    t.stick.destroy();
    expect(t.change.mock.lastCall?.slice(0, 2)).toEqual([0, 0]);
    t.change.mockClear();
    t.node.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(t.change).not.toHaveBeenCalled();
  });

  it("uses the same deadzone for both instruments", () => {
    expect(stickResponse(.035)).toBe(0);
    for (const value of [-1, -.5, 0, .5, 1]) expect(stickResponse(inverseStickResponse(value))).toBeCloseTo(value);
  });

  it("ignores unmatched and delayed key releases after blur", () => {
    const t = pad();
    t.node.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" }));
    expect(t.change).not.toHaveBeenCalled();
    t.node.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    window.dispatchEvent(new Event("blur"));
    t.change.mockClear();
    t.node.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" }));
    expect(t.change).not.toHaveBeenCalled();
    t.stick.destroy();
  });
});
