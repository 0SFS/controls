import { describe, expect, it, vi } from "vitest";
import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import { applyFlightControls } from "../src/applyFlightControls";

describe("applyFlightControls", () => {
  it.each([["auto", 0], ["manual", 1], ["fly-by-wire", 2]] as const)("selects native %s without injecting pilot input", (mode, value) => {
    const setPropertyValue = vi.fn();
    applyFlightControls({ setPropertyValue } as unknown as JSBSimSdk, {
      elevator: 0, aileron: 0, rudder: 0, throttle: 0.5, pitchTrim: 0, rollTrim: 0, flaps: 0, brake: 0,
    }, 0, -1, undefined, { commandProperty: "fcs/control-law-mode", mode });
    expect(setPropertyValue).toHaveBeenCalledWith("fcs/control-law-mode", value);
    expect(setPropertyValue).toHaveBeenCalledWith("fcs/rudder-cmd-norm", -0);
    expect(setPropertyValue).not.toHaveBeenCalledWith("fcs/fbw-enabled", expect.anything());
  });
  it("applies all normalized controls directly, converting yaw exactly once", () => {
    const setPropertyValue = vi.fn();
    applyFlightControls({ setPropertyValue } as unknown as JSBSimSdk, {
      elevator: -0.32, aileron: 0.45, rudder: 0.6,
      throttle: 0.83, pitchTrim: -0.16, rollTrim: 0.22, flaps: 0.33, brake: 0.8,
    });
    expect(setPropertyValue.mock.calls).toEqual([
      ["fcs/elevator-cmd-norm", -0.32],
      ["fcs/aileron-cmd-norm", 0.45],
      ["fcs/rudder-cmd-norm", -0.6],
      ["fcs/throttle-cmd-norm", 0.83],
      ["fcs/pitch-trim-cmd-norm", -0.16],
      ["fcs/roll-trim-cmd-norm", 0.22],
      ["fcs/flap-cmd-norm", 0.33],
      ["fcs/brake-cmd-norm", 0.8],
      ["fcs/left-brake-cmd-norm", 0.8],
      ["fcs/right-brake-cmd-norm", 0.8],
      ["gear/gear-cmd-norm", 1],
    ]);
  });

  it("asks of full roll trim a share of full stick, the roll trim range, and refuses a range outside (0, 1]", () => {
    const setPropertyValue = vi.fn();
    const sdk = { setPropertyValue } as unknown as JSBSimSdk;
    const controls = { elevator: 0, aileron: 0, rudder: 0, throttle: 0, pitchTrim: 0.5, rollTrim: 0.5, flaps: 0, brake: 0 };
    applyFlightControls(sdk, controls, 1, -1, undefined, undefined, undefined, undefined, 0.2);
    expect(setPropertyValue).toHaveBeenCalledWith("fcs/roll-trim-cmd-norm", 0.1);
    // Pitch trim keeps its own range.
    expect(setPropertyValue).toHaveBeenCalledWith("fcs/pitch-trim-cmd-norm", 0.5);
    for (const range of [0, -0.5, 1.5, Number.NaN]) {
      setPropertyValue.mockClear();
      expect(() => applyFlightControls(sdk, controls, 1, -1, undefined, undefined, undefined, undefined, range)).toThrow(RangeError);
      expect(setPropertyValue).not.toHaveBeenCalled();
    }
  });

  it("defaults the gear lever to down, and writes it up when told to", () => {
    const setPropertyValue = vi.fn();
    const controls = {
      elevator: 0, aileron: 0, rudder: 0,
      throttle: 0, pitchTrim: 0, rollTrim: 0, flaps: 0, brake: 0,
    };
    applyFlightControls({ setPropertyValue } as unknown as JSBSimSdk, controls, 0);
    expect(setPropertyValue).toHaveBeenLastCalledWith("gear/gear-cmd-norm", 0);
  });

  it("commands conversion without overwriting the physical actuator", () => {
    const setPropertyValue = vi.fn();
    const controls = { elevator: 0, aileron: 0, rudder: 0, throttle: 0.8,
      pitchTrim: 0, rollTrim: 0, flaps: 0, brake: 0 };
    const sdk = { setPropertyValue } as unknown as JSBSimSdk;
    applyFlightControls(sdk, controls, 0, 1, { commandProperty: "fcs/stovl-cmd-norm", commandNorm: 0.7 });
    expect(setPropertyValue).toHaveBeenCalledWith("fcs/stovl-cmd-norm", 0.7);
    expect(setPropertyValue).not.toHaveBeenCalledWith("fcs/stovl-pos-norm", expect.anything());
    setPropertyValue.mockClear();
    expect(() => applyFlightControls(sdk, controls, 0, 1,
      { commandProperty: "fcs/stovl-cmd-norm", commandNorm: NaN })).toThrow(RangeError);
    expect(setPropertyValue).not.toHaveBeenCalled();
  });

  it("writes the full-stick roll rate beside an unscaled aileron command, and refuses one that is not a positive rate", () => {
    const setPropertyValue = vi.fn();
    const controls = { elevator: 0, aileron: 0.6, rudder: 0, throttle: 0.8,
      pitchTrim: 0, rollTrim: 0, flaps: 0, brake: 0 };
    const sdk = { setPropertyValue } as unknown as JSBSimSdk;
    applyFlightControls(sdk, controls, 0, 1, undefined, undefined, undefined, { property: "fcs/full-stick-roll-rate-deg_sec", degPerSec: 30 });
    expect(setPropertyValue).toHaveBeenCalledWith("fcs/full-stick-roll-rate-deg_sec", 30);
    expect(setPropertyValue).toHaveBeenCalledWith("fcs/aileron-cmd-norm", 0.6);
    setPropertyValue.mockClear();
    for (const degPerSec of [0, -30, NaN, Infinity]) {
      expect(() => applyFlightControls(sdk, controls, 0, 1, undefined, undefined, undefined,
        { property: "fcs/full-stick-roll-rate-deg_sec", degPerSec })).toThrow(RangeError);
    }
    expect(setPropertyValue).not.toHaveBeenCalled();
  });

  /** An SDK with batches: every single set and every batch write, in order, and each batch made. */
  function batchedSdk() {
    const log: unknown[][] = [];
    const batches: { paths: readonly string[]; options: unknown; disposed: boolean; write: (values: ArrayLike<number>) => void; dispose: () => void }[] = [];
    const sdk = {
      setPropertyValue: vi.fn((path: string, value: number) => { log.push(["set", path, value]); }),
      createPropertyBatch: vi.fn((paths: readonly string[], options?: unknown) => {
        const batch = {
          paths, options, disposed: false,
          write(values: ArrayLike<number>) {
            if (batch.disposed) throw new Error("PropertyBatch has been disposed.");
            log.push(["write", ...paths.map((path, index) => [path, values[index]])]);
          },
          dispose() { batch.disposed = true; },
        };
        batches.push(batch);
        return batch;
      }),
    };
    return { sdk: sdk as unknown as JSBSimSdk, log, batches, createPropertyBatch: sdk.createPropertyBatch };
  }
  const flying = { elevator: -0.32, aileron: 0.45, rudder: 0.6, throttle: 0.83, pitchTrim: -0.16, rollTrim: 0.22, flaps: 0.33, brake: 0.8 };

  it("writes the eleven commands with one batch, in the order they were set one at a time, between the conditional sets", () => {
    const { sdk, log, createPropertyBatch } = batchedSdk();
    applyFlightControls(sdk, flying, 0, -1, { commandProperty: "fcs/stovl-cmd-norm", commandNorm: 0.5 },
      { commandProperty: "fcs/control-law-mode", mode: "manual" }, { commandProperty: "fcs/auto-flaps", enabled: true },
      { property: "fcs/full-stick-roll-rate-deg_sec", degPerSec: 30 }, 0.5);
    expect(log).toEqual([
      ["set", "fcs/control-law-mode", 1],
      ["set", "fcs/auto-flaps", 1],
      ["set", "fcs/full-stick-roll-rate-deg_sec", 30],
      ["write",
        ["fcs/elevator-cmd-norm", -0.32],
        ["fcs/aileron-cmd-norm", 0.45],
        ["fcs/rudder-cmd-norm", -0.6],
        ["fcs/throttle-cmd-norm", 0.83],
        ["fcs/pitch-trim-cmd-norm", -0.16],
        ["fcs/roll-trim-cmd-norm", 0.11],
        ["fcs/flap-cmd-norm", 0.33],
        ["fcs/brake-cmd-norm", 0.8],
        ["fcs/left-brake-cmd-norm", 0.8],
        ["fcs/right-brake-cmd-norm", 0.8],
        ["gear/gear-cmd-norm", 0]],
      ["set", "fcs/stovl-cmd-norm", 0.5],
    ]);
    // A single set creates a property the model lacks; the batch must too.
    expect(createPropertyBatch).toHaveBeenCalledTimes(1);
    expect(createPropertyBatch.mock.calls[0]![1]).toEqual({ create: true });
    log.length = 0;
    applyFlightControls(sdk, { ...flying, elevator: 0.1 });
    expect(createPropertyBatch).toHaveBeenCalledTimes(1);
    expect(log).toHaveLength(1);
    expect(log[0]![1]).toEqual(["fcs/elevator-cmd-norm", 0.1]);
  });

  it("keeps one batch per SDK", () => {
    const first = batchedSdk(), second = batchedSdk();
    applyFlightControls(first.sdk, flying);
    applyFlightControls(second.sdk, { ...flying, throttle: 0.2 });
    applyFlightControls(first.sdk, flying);
    expect(first.createPropertyBatch).toHaveBeenCalledTimes(1);
    expect(second.createPropertyBatch).toHaveBeenCalledTimes(1);
    expect(second.log[0]![4]).toEqual(["fcs/throttle-cmd-norm", 0.2]);
    expect(first.log).toHaveLength(2);
  });

  it("resolves the paths again once a model load has disposed the batch, and writes the commands once", () => {
    const { sdk, log, batches, createPropertyBatch } = batchedSdk();
    applyFlightControls(sdk, flying);
    batches[0]!.disposed = true;
    log.length = 0;
    applyFlightControls(sdk, { ...flying, aileron: -0.7 });
    expect(createPropertyBatch).toHaveBeenCalledTimes(2);
    expect(log).toHaveLength(1);
    expect(log[0]![2]).toEqual(["fcs/aileron-cmd-norm", -0.7]);
    applyFlightControls(sdk, flying);
    expect(createPropertyBatch).toHaveBeenCalledTimes(2);
    expect(batches[1]!.disposed).toBe(false);
  });

  it("sets each command on its own, in the same order, on an SDK that cannot make a batch", () => {
    const { sdk, log, createPropertyBatch } = batchedSdk();
    createPropertyBatch.mockImplementation(() => { throw new Error("This JSBSim wasm build does not include PropertyBatch bindings."); });
    applyFlightControls(sdk, flying, 0);
    applyFlightControls(sdk, flying, 1);
    expect(createPropertyBatch).toHaveBeenCalledTimes(1);
    expect(log.slice(0, 11).map(entry => entry[1])).toEqual(["fcs/elevator-cmd-norm", "fcs/aileron-cmd-norm", "fcs/rudder-cmd-norm",
      "fcs/throttle-cmd-norm", "fcs/pitch-trim-cmd-norm", "fcs/roll-trim-cmd-norm", "fcs/flap-cmd-norm", "fcs/brake-cmd-norm",
      "fcs/left-brake-cmd-norm", "fcs/right-brake-cmd-norm", "gear/gear-cmd-norm"]);
    expect(log.slice(11).map(entry => entry[2])).toEqual([-0.32, 0.45, -0.6, 0.83, -0.16, 0.22, 0.33, 0.8, 0.8, 0.8, 1]);
  });
});
