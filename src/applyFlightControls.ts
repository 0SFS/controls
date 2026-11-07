import type { JSBSimSdk, PropertyBatch } from "@felipegalind0/jsbsim";
import type { ControlSurfaceState } from "./flightInputManager";

export type FlightControlLawMode = "auto" | "manual" | "fly-by-wire";
export const CONTROL_LAW_MODE_VALUES: Readonly<Record<FlightControlLawMode, number>> = {
  auto: 0, manual: 1, "fly-by-wire": 2,
};

/**
 * The commands written every step, in the order they were once written one
 * at a time: JSBSim runs a tied property's setter as the value is written, and
 * a batch writes its slots in order, so the order stays.
 */
const COMMAND_PATHS = [
  "fcs/elevator-cmd-norm", "fcs/aileron-cmd-norm", "fcs/rudder-cmd-norm", "fcs/throttle-cmd-norm",
  "fcs/pitch-trim-cmd-norm", "fcs/roll-trim-cmd-norm", "fcs/flap-cmd-norm", "fcs/brake-cmd-norm",
  "fcs/left-brake-cmd-norm", "fcs/right-brake-cmd-norm", "gear/gear-cmd-norm",
] as const;
const commandValues = new Float64Array(COMMAND_PATHS.length);
/** Per SDK: the batch, or null where batches are not available and each command is set on its own. */
const commandBatches = new WeakMap<object, PropertyBatch | null>();

function commandBatch(sdk: JSBSimSdk): PropertyBatch | null {
  let batch: PropertyBatch | null = null;
  if (typeof sdk.createPropertyBatch === "function") {
    // `create`, as a single set does: a model without one of these properties gets it, as it did.
    try { batch = sdk.createPropertyBatch(COMMAND_PATHS, { create: true }); }
    catch { /* A build without batches: each command is set on its own. */ }
  }
  commandBatches.set(sdk, batch);
  return batch;
}

function writeCommands(sdk: JSBSimSdk, values: Float64Array): void {
  let batch = commandBatches.has(sdk) ? commandBatches.get(sdk)! : commandBatch(sdk);
  if (batch) {
    try {
      batch.write(values);
      return;
    } catch {
      // Loading a model disposes the SDK's batches, and a disposed batch writes nothing: resolve the paths again.
    }
    batch.dispose();
    batch = commandBatch(sdk);
  }
  if (batch) { batch.write(values); return; }
  for (let i = 0; i < COMMAND_PATHS.length; i++) sdk.setPropertyValue(COMMAND_PATHS[i]!, values[i]!);
}

/**
 * The sole normalized control-to-physics boundary, shared by every input owner.
 *
 * `gearDownNorm` (1 down, 0 up) is a separate argument rather than a member of
 * `ControlSurfaceState` because that record is the smoothed continuous axes -
 * every field of it is gamepad-mapped, phone-synced and range-checked on the
 * wire. The gear is a latching switch, like the pause key, and it is owned the
 * same way.
 */
export function applyFlightControls(
  sdk: JSBSimSdk,
  controls: ControlSurfaceState,
  gearDownNorm = 1,
  rudderSign: 1 | -1 = -1,
  stovl?: { commandProperty: string; commandNorm: number },
  controlLaw?: { commandProperty: string; mode: FlightControlLawMode },
  automaticFlaps?: { commandProperty: string; enabled: boolean },
  fullStickRollRate?: { property: string; degPerSec: number },
  /** osfs.aircraft.rollTrimRange: what full roll trim asks for, as a share of full stick. */
  rollTrimRange = 1,
): void {
  if (stovl && (!Number.isFinite(stovl.commandNorm) || stovl.commandNorm < 0 || stovl.commandNorm > 1)) {
    throw new RangeError("STOVL conversion must be between 0 and 1.");
  }
  if (controlLaw && !Object.hasOwn(CONTROL_LAW_MODE_VALUES, controlLaw.mode)) {
    throw new RangeError("Unknown aircraft control law.");
  }
  if (fullStickRollRate && (!Number.isFinite(fullStickRollRate.degPerSec) || fullStickRollRate.degPerSec <= 0)) {
    throw new RangeError("Full-stick roll rate must be a positive number of degrees per second.");
  }
  if (!Number.isFinite(rollTrimRange) || rollTrimRange <= 0 || rollTrimRange > 1) {
    throw new RangeError("Roll trim range must be above 0 and at most 1.");
  }
  if (controlLaw) sdk.setPropertyValue(controlLaw.commandProperty, CONTROL_LAW_MODE_VALUES[controlLaw.mode]);
  if (automaticFlaps) sdk.setPropertyValue(automaticFlaps.commandProperty, Number(automaticFlaps.enabled));
  if (fullStickRollRate) sdk.setPropertyValue(fullStickRollRate.property, fullStickRollRate.degPerSec);
  // In COMMAND_PATHS order, written with one batch.
  const values = commandValues;
  values[0] = controls.elevator;
  values[1] = controls.aileron;
  // Controls use positive yaw-right. Each FDM profile declares whether its
  // native yaw-surface convention needs conversion at this boundary.
  values[2] = controls.rudder * rudderSign;
  values[3] = controls.throttle;
  values[4] = controls.pitchTrim;
  // Each aircraft takes roll trim in its stick's units, so this is a share of full stick.
  values[5] = controls.rollTrim * rollTrimRange;
  values[6] = controls.flaps;
  values[7] = controls.brake;
  values[8] = controls.brake;
  values[9] = controls.brake;
  // The SF50 FCS drives its physical actuator from this lever. The fixed-gear
  // C172 ignores it; presentation reads the resulting physical position.
  values[10] = gearDownNorm;
  writeCommands(sdk, values);
  if (stovl) sdk.setPropertyValue(stovl.commandProperty, stovl.commandNorm);
}
