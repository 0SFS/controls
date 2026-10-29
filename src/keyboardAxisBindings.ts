import { DEFAULT_BINDING_TRANSFORM, parseProfile, type BindingProfile, type BindingSpec } from "@felipegalind0/gamepad-tools/core";
import type { ControlsParameters } from "./settings";

export const KEY_PAIRS = {
  ws: { label: "W/S", positive: ["KeyW"], negative: ["KeyS"] },
  ad: { label: "A/D", positive: ["KeyD"], negative: ["KeyA"] },
  qe: { label: "Q/E", positive: ["KeyE"], negative: ["KeyQ"] },
  "shift-ctrl": { label: "Shift/Ctrl", positive: ["ShiftLeft", "ShiftRight"], negative: ["ControlLeft", "ControlRight"] },
  "up-down": { label: "↑/↓", positive: ["ArrowUp"], negative: ["ArrowDown"] },
  "left-right": { label: "←/→", positive: ["ArrowRight"], negative: ["ArrowLeft"] },
  none: { label: "None", positive: [], negative: [] },
} as const;
export type KeyPair = keyof typeof KEY_PAIRS;
export interface KeyboardAxisBindings { pitch: KeyPair; roll: KeyPair; yaw: KeyPair; power: KeyPair }
export const DEFAULT_KEYBOARD_AXES: KeyboardAxisBindings = { pitch: "ws", roll: "ad", yaw: "qe", power: "shift-ctrl" };
export const KEYBOARD_AXES = ["pitch", "roll", "yaw", "power"] as const;
export const keyboardAxisParameterId = (axis: keyof KeyboardAxisBindings) => `osfs.input.keys.${axis}` as const;
export function readKeyboardAxes(parameters: ControlsParameters): KeyboardAxisBindings {
  return Object.fromEntries(KEYBOARD_AXES.map(axis => [axis, parameters.get(keyboardAxisParameterId(axis))])) as unknown as KeyboardAxisBindings;
}

/** Keyboard held commands; opposite keys cancel, either Ctrl/Shift works. */
export function keyboardAxisValue(pair: KeyPair, keys: ReadonlySet<string>): number {
  const p = KEY_PAIRS[pair];
  return Number(p.positive.some(key => keys.has(key))) - Number(p.negative.some(key => keys.has(key)));
}

/** Only the four named keyboard pairs are rewritten; custom bindings remain editable. */
export function withKeyboardAxes(profile: BindingProfile, axes: KeyboardAxisBindings, climbRate = false): BindingProfile {
  const actions = { pitch: "flight.elevator", roll: "flight.aileron", yaw: "flight.rudder", power: climbRate ? "flight.climbRate" : "flight.throttleRate" };
  const ids = { pitch: "key-elevator", roll: "key-aileron", yaw: "key-rudder", power: "key-throttle" };
  const rewritten = new Set<string>(Object.values(ids).flatMap(id => [id, `${id}-right`]));
  const bindings: BindingSpec[] = profile.bindings.filter(binding => !rewritten.has(binding.id)).map(binding => {
    if (!climbRate || !["standard-throttle", "legacy-throttle"].includes(binding.id)) return binding;
    return { ...binding, actionId: "flight.climbRate", semantics: "axis", transform: { ...binding.transform, outputRange: [-1, 1] } };
  });
  for (const axis of KEYBOARD_AXES) {
    const pair = KEY_PAIRS[axes[axis]];
    for (let i = 0; i < pair.positive.length; i++) bindings.push({
      id: ids[axis] + (i ? "-right" : ""), actionId: actions[axis], kind: "paired",
      semantics: axis === "power" && !climbRate ? "rate" : "axis", contexts: ["flight"], enabled: true, precedence: 0,
      transform: { ...DEFAULT_BINDING_TRANSFORM, inputRange: [0, 1], outputRange: [-1, 1] },
      positiveSource: { selector: { kind: "keyboard", code: pair.positive[i] } },
      negativeSource: { selector: { kind: "keyboard", code: pair.negative[i] } },
    });
  }
  return parseProfile({ ...profile, bindings });
}
