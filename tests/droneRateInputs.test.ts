// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BindingRuntime } from "@felipegalind0/gamepad-tools/core";
import { createBrowserInputSource } from "@felipegalind0/gamepad-tools/browser";
import { createFlightInputManager } from "../src/flightInputManager";
import { createFlightGamepadAdapter, createStandardFlightProfile } from "../src/gamepadToolsAdapter";
import { readKeyboardStickSettings } from "../src/keyboardStickSettings";
import { controlsParameterDefaults } from "../src/settings";
import { withKeyboardAxes, readKeyboardAxes } from "../src/keyboardAxisBindings";
import { createClimbRateLever } from "../src/climbRateLever";

const cleanup: (() => void)[] = [];
beforeEach(() => Object.defineProperty(navigator, "getGamepads", { configurable: true, value: vi.fn(() => []) }));
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); document.body.replaceChildren(); vi.restoreAllMocks(); });
const key = (type: string, code: string) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));

function manager(profileDriven = false) {
  const parameters = controlsParameterDefaults({ "osfs.input.keys.roll": "qe", "osfs.input.keys.yaw": "ad", "osfs.input.keyboard.mode": "direct" });
  const input = createFlightInputManager({ parameters, initialThrottle: .7, keyboardStickSettings: readKeyboardStickSettings(parameters), verticalControl: "climb-rate" });
  cleanup.push(input.attach(window), () => input.dispose());
  let step = (dt = 1 / 60) => input.poll(dt);
  if (profileDriven) {
    const source = createBrowserInputSource({ target: window });
    const runtime = new BindingRuntime({ profile: withKeyboardAxes(createStandardFlightProfile(), readKeyboardAxes(parameters), true), adapter: createFlightGamepadAdapter(input) });
    input.setGamepadToolsActive(true);
    const detach = source.subscribe(frame => runtime.dispatch(frame));
    cleanup.push(detach, () => runtime.dispose(), () => source.dispose());
    step = (dt = 1 / 60) => { source.tick(); return input.poll(dt); };
  }
  step(); step();
  return { input, parameters, step };
}

describe("rate-controlled drone inputs", () => {
  it.each([false, true])("holds climb velocity then centers without changing throttle (profile %s)", profiled => {
    const { input, step } = manager(profiled);
    key("keydown", "ShiftLeft"); expect(step().climb).toBe(1);
    expect(step(10).throttle).toBe(.7);
    key("keyup", "ShiftLeft"); expect(step().climb).toBe(0);
    key("keydown", "ControlRight"); expect(step().climb).toBe(-1);
    window.dispatchEvent(new Event("blur")); step();
    expect(input.getClimbRateCommand()).toBe(0);
  });
  it.each([false, true])("A/D yaws and Q/E translates laterally (profile %s)", profiled => {
    const { step } = manager(profiled);
    key("keydown", "KeyD"); expect(step()).toMatchObject({ rudder: 1, aileron: 0 });
    key("keyup", "KeyD"); key("keydown", "KeyQ"); expect(step()).toMatchObject({ rudder: 0, aileron: -1 });
  });
  it("legacy path reads reassigned pairs live; opposite keys cancel", () => {
    const { step, parameters } = manager();
    parameters.set("osfs.input.keys.yaw", "left-right");
    key("keydown", "ArrowRight"); expect(step().rudder).toBe(1);
    key("keydown", "ArrowLeft"); expect(step().rudder).toBe(0);
  });
  it("adoption clears a held vertical command", () => {
    const { input, step } = manager(); input.setClimbRateCommand(.6); expect(step().climb).toBe(.6);
    input.adoptControls({ ...input.getControls(), climb: 1 }); expect(step().climb).toBe(0);
  });
  it("the vertical lever shows physical rates and springs to altitude hold", () => {
    const host = document.createElement("div"); document.body.append(host); let command = 0;
    const lever = createClimbRateLever(host, { onChange: value => { command = value; }, getCommand: () => command, climbMps: 5, descentMps: 3.5 }); cleanup.push(() => lever.destroy());
    const slider = host.querySelector("input")!;
    slider.value = "0.5"; slider.dispatchEvent(new Event("input")); expect(command).toBe(.5); expect(host.textContent).toContain("+2.5 m/s");
    slider.value = "-1"; slider.dispatchEvent(new Event("input")); expect(host.textContent).toContain("-3.5 m/s");
    slider.dispatchEvent(new Event("pointerup")); expect(command).toBe(0); expect(slider.getAttribute("aria-valuetext")).toBe("Hold altitude"); expect(host.textContent).not.toContain("THR");
  });
});
