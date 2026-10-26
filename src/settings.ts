import type { ParameterSpec } from "foss-earth/settings";
import {
  catalogueDefaults,
  catalogueSpec,
  catalogueStore,
  type CatalogueParameters,
  type CatalogueRegistry,
  type CatalogueStore,
  type CatalogueValues,
} from "@0sfs/engines/parameterCatalogue";

/**
 * The flight controls' flight parameters: their part of the flight's settings, with
 * their homes, section titles and defaults. The host composes the parts into
 * its catalogue in this order and registers them. Spec:
 * docs/proposals/flight-settings.md.
 */

const PSF = { id: "psf", text: "psf" } as const;
const FEET_PER_SECOND = { id: "ft/s", text: "ft/s" } as const;
const NEWTON_SECONDS = { id: "N·s", text: "N·s" } as const;
const JOULES = { id: "J", text: "J" } as const;
const RADIANS_PER_SECOND_SQUARED = { id: "rad/s²", text: "rad/s²" } as const;

const START = { tab: "aircraft", section: "start" } as const;
const ASSISTS = { tab: "aircraft", section: "assists" } as const;
const FLIGHT_CONTROLS = { tab: "aircraft", section: "flight-controls" } as const;
const GAMEPAD = { tab: "controls", section: "gamepad" } as const;
const KEYBOARD = { tab: "controls", section: "keyboard" } as const;
const ORBIT = { tab: "controls", section: "orbit" } as const;
const FEEDBACK = { tab: "controls", section: "feedback" } as const;
const STOVL = { tab: "controls", section: "stovl" } as const;
const BRAKING = { tab: "controls", section: "braking" } as const;
const AFTERBURNER = { tab: "controls", section: "afterburner" } as const;
/** The pre-registry defaults of the keyboard stick, which the migration and the Reset button share. */
const KEYBOARD_STICK_SOURCE = "controls/src/keyboardStickResponse.ts";

/** Section titles for the sections only the flight controls' parameters are in, by tab and section id. */
export const CONTROLS_SECTION_TITLES_1: readonly (readonly [tab: string, section: string, title: string])[] = [
  ["aircraft", "assists", "Assists"],
  ["aircraft", "flight-controls", "Flight controls"],
];

/** Section titles for the sections only the flight controls' parameters are in, by tab and section id. */
export const CONTROLS_SECTION_TITLES_2: readonly (readonly [tab: string, section: string, title: string])[] = [
  ["controls", "gamepad", "Gamepad"],
  ["controls", "keyboard", "Keyboard response"],
  ["controls", "feedback", "Feedback"],
  ["controls", "stovl", "F-35B STOVL"],
  ["controls", "braking", "F-35B braking"],
  ["controls", "afterburner", "Afterburner"],
];

const main = <T extends { tab: string; section: string }>(home: T) => ({ ...home, level: "main" as const });
const all = <T extends { tab: string; section: string }>(home: T) => ({ ...home, level: "all" as const });
const within = (min: number, max: number) => () => ({ min, max });

export const CONTROLS_PARAMETERS_1 = [
  {
    id: "osfs.start.throttle",
    label: "Start throttle",
    description: "The throttle a new flight starts with.",
    unit: "fraction",
    kind: "number",
    step: 0.01,
    bounds: within(0, 1),
    default: 0.65,
    defaultReason: "The Cessna 172 profile's start throttle; each aircraft sets its own when it loads (the SF50's is 0.35).",
    home: all(START),
    appliesLive: false,
    source: "src/flight/jsbsim/bootstrapC172.ts",
  },
] as const satisfies readonly ParameterSpec[];

export const CONTROLS_PARAMETERS_2 = [
  // Aircraft → Assists.
  {
    id: "osfs.assist.autoFlaps",
    label: "Auto flaps",
    description: "Uses the aircraft's automatic flap controls, or a speed-based pilot assist where none is fitted. Moving a flap control takes over manually.",
    unit: "none",
    kind: "boolean",
    default: true,
    defaultReason: "Automatic flaps on every aircraft by default; the HUD Auto button edits this same setting.",
    home: main(ASSISTS),
    appliesLive: true,
    source: "controls/src/autoFlaps.ts",
  },
  {
    id: "osfs.assist.autoTrim",
    label: "Auto pitch trim",
    description: "Moves pitch trim to cancel the elevator force the pilot is holding.",
    unit: "none",
    kind: "boolean",
    default: true,
    defaultReason: "On, as it has been since the assist was added.",
    home: main(ASSISTS),
    appliesLive: true,
    source: "controls/src/autoTrim.ts",
  },
  {
    id: "osfs.assist.autoRollTrim",
    label: "Auto roll trim",
    description: "Moves roll trim to cancel the aileron force the pilot is holding. Waits while the F-35B's fly-by-wire holds bank itself.",
    unit: "none",
    kind: "boolean",
    default: true,
    defaultReason: "On, as it has been since the assist was added.",
    home: main(ASSISTS),
    appliesLive: true,
    source: "controls/src/autoTrim.ts",
  },
  {
    id: "osfs.assist.trimMaxRate",
    label: "Trim rate",
    description: "The fastest the auto trim moves, in full trim travel per second.",
    unit: "per-s",
    kind: "number",
    step: 0.01,
    bounds: within(0.01, 2),
    default: 0.35,
    defaultReason: "The original value: full-scale trim travel in about three seconds.",
    home: all(ASSISTS),
    appliesLive: true,
    source: "controls/src/autoTrim.ts",
  },
  {
    id: "osfs.assist.trimDeadband",
    label: "Trim deadband",
    description: "The auto trim leaves a leftover angular acceleration smaller than this alone.",
    unit: RADIANS_PER_SECOND_SQUARED,
    kind: "number",
    step: 0.005,
    bounds: within(0, 0.5),
    default: 0.04,
    defaultReason: "The original value.",
    home: all(ASSISTS),
    appliesLive: true,
    source: "controls/src/autoTrim.ts",
  },
  {
    id: "osfs.assist.trimFilter",
    label: "Trim filter",
    description: "The time constant that smooths the leftover acceleration the auto trim cancels.",
    unit: "s",
    kind: "number",
    step: 0.01,
    bounds: within(0.01, 2),
    default: 0.08,
    defaultReason: "The original value.",
    home: all(ASSISTS),
    appliesLive: true,
    source: "controls/src/autoTrim.ts",
  },
  {
    id: "osfs.assist.trimGain",
    label: "Trim gain",
    description: "The fraction of the leftover angular acceleration the auto trim cancels per second, before the rate limit.",
    unit: "per-s",
    kind: "number",
    step: 0.05,
    bounds: within(0.05, 10),
    default: 1.25,
    defaultReason: "The original value.",
    home: all(ASSISTS),
    appliesLive: true,
    source: "controls/src/autoTrim.ts",
  },
  {
    id: "osfs.assist.trimAuthority",
    label: "Trim authority",
    description: "The dynamic pressure at which the auto trim reaches full authority; below it, its corrections shrink in proportion.",
    unit: PSF,
    kind: "number",
    step: 1,
    bounds: within(1, 200),
    default: 20,
    defaultReason: "The original value, about 77 kt at sea level.",
    home: all(ASSISTS),
    appliesLive: true,
    source: "controls/src/autoTrim.ts",
  },
  {
    id: "osfs.assist.trimMinAirspeed",
    label: "Trim damping airspeed floor",
    description: "The lowest true airspeed the auto trim assumes when it estimates aerodynamic damping, so the estimate stays bounded at low speed.",
    unit: FEET_PER_SECOND,
    kind: "number",
    step: 1,
    bounds: within(0, 400),
    default: 80,
    defaultReason: "The original value, about 47 kt.",
    home: all(ASSISTS),
    appliesLive: true,
    source: "controls/src/autoTrim.ts",
  },
] as const satisfies readonly ParameterSpec[];

export const CONTROLS_PARAMETERS_3 = [
  {
    id: "osfs.input.keepSliderBrakes",
    label: "Keep slider brakes applied",
    description: "Keeps wheel brakes applied after releasing the F-35B throttle/brake slider, on this screen and the phone. Off, releasing the slider returns it to idle and releases its brakes. Yaw controls apply differential braking while the main wheels are on the ground.",
    unit: "none",
    kind: "boolean",
    default: false,
    defaultReason: "Braking requires holding the slider unless the pilot chooses to keep it applied.",
    home: main(BRAKING),
    appliesLive: true,
    source: "engines/src/throttleLever.ts",
  },
  {
    id: "osfs.input.afterburnerOneMotion",
    label: "Enter afterburner in one push",
    description: "Lets one held throttle key or button, or one drag of the throttle lever on this screen or the phone, carry the throttle straight into afterburner. Off, it stops at the afterburner detent; let go and push again to light the afterburner. Leaving the afterburner is the same either way, and a controller's throttle axis is never stopped.",
    unit: "none",
    kind: "boolean",
    default: false,
    defaultReason: "Lighting the afterburner takes a deliberate second push, so going to full dry power does not light it by accident.",
    home: main(AFTERBURNER),
    appliesLive: true,
    source: "controls/src/flightInputManager.ts",
  },
  {
    id: "osfs.aircraft.stovlConversion",
    label: "STOVL conversion",
    description: "F-35B only: 0% is conventional flight; 100% opens the lift fan and turns the rear nozzle downward. Conversion takes time. Throttle controls lift; the stick and rudder control attitude. Experimental flight model.",
    unit: "fraction",
    kind: "number",
    step: 0.01,
    bounds: within(0, 1),
    default: 0,
    defaultReason: "Start in conventional flight with the lift fan closed.",
    home: all(STOVL),
    appliesLive: true,
    source: "controls/src/applyFlightControls.ts",
  },

  {
    id: "osfs.aircraft.controlLaw",
    label: "Aircraft control law",
    description: "Auto uses the aircraft's default law. Manual sends stick, rudder and trim through the actuators without aircraft stabilization. Fly-by-wire enables the aircraft's native stabilization. Available on the F-35B; autopilot and input assists have their own settings.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "auto", label: "Auto" },
      { id: "manual", label: "Manual" },
      { id: "fly-by-wire", label: "Fly-by-wire" },
    ],
    default: "auto",
    defaultReason: "Use each aircraft's standard control law; the F-35B defaults to fly-by-wire.",
    home: main(FLIGHT_CONTROLS),
    appliesLive: true,
    source: "controls/src/applyFlightControls.ts",
  },
  {
    id: "osfs.aircraft.fullStickRollRate",
    label: "Full-stick roll rate",
    description: "F-35B fly-by-wire: the roll rate full stick asks for, and half stick half of it. The jet flies it to within about 10% between 200 and 600 kt, until the ailerons run out near 150°/s at 200 kt. With the stick centred the law holds bank. Manual, the autopilot and the hover roll posts do not use it.",
    unit: "deg/s",
    kind: "number",
    step: 1,
    bounds: within(15, 165),
    default: 30,
    defaultReason: "Chosen in flight. At 300 kt the earlier stick gains of 0.05, 0.1 and 0.5 flew about 16, 33 and 165°/s at full stick; the source asks for 637°/s, far past what the ailerons give.",
    home: main(FLIGHT_CONTROLS),
    appliesLive: true,
    source: "controls/src/applyFlightControls.ts",
  },
  {
    id: "osfs.aircraft.rollTrimRange",
    label: "Roll trim range",
    description: "How far full roll trim reaches, as a share of what full stick asks for: at 1, 100% trim asks what holding A or D, or a controller's stick full over, asks; at 0.2, a fifth of it. Under the F-35B's fly-by-wire that is a share of the full-stick roll rate; under Manual and on the other aircraft, of full aileron.",
    unit: "ratio",
    kind: "number",
    step: 0.05,
    bounds: within(0.05, 1),
    default: 1,
    defaultReason: "The stick's own range. Under fly-by-wire roll trim had asked for up to 637°/s, the source gradient, against 30°/s at full stick, so a few percent of trim outrolled the stick.",
    home: main(FLIGHT_CONTROLS),
    appliesLive: true,
    source: "controls/src/applyFlightControls.ts",
  },

  // Controls → Gamepad.
  {
    id: "osfs.input.gamepadPollingRate",
    label: "Gamepad polling rate",
    description: "How often the application reads the controller, not the controller's own report rate.",
    unit: "Hz",
    kind: "number",
    step: 1,
    bounds: within(10, 240),
    named: [{ id: "frame", label: "Every frame", description: "Reads input before each flight frame, with no timer cap." }],
    default: "frame",
    defaultReason: "A fixed rate below the frame rate can introduce visible stepping; the browser's frame rate stays the upper limit.",
    home: main(GAMEPAD),
    appliesLive: true,
    source: "controls/src/gamepadPolling.ts",
  },
  {
    id: "osfs.input.gamepadResponse",
    label: "Analog response",
    description: "Smooth eases pitch, roll and yaw toward each report every flight frame; Direct holds each report unchanged.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "smooth", label: "Smooth" },
      { id: "direct", label: "Direct" },
    ],
    default: "smooth",
    defaultReason: "The original behaviour.",
    home: main(GAMEPAD),
    appliesLive: true,
    source: "controls/src/flightInputManager.ts",
  },
  {
    id: "osfs.input.gamepadResponseTime",
    label: "Response time",
    description: "With Smooth, the time to approach 95% of a held stick command.",
    unit: "s",
    kind: "number",
    step: 0.025,
    bounds: within(0.05, 2),
    default: 0.375,
    defaultReason: "The original filter, min(1, 8·dt) per frame.",
    home: main(GAMEPAD),
    appliesLive: true,
    source: "controls/src/flightInputManager.ts",
  },
  {
    id: "osfs.input.gamepadDeadzoneMode",
    label: "Stick deadzone behaviour",
    description: "Cutoff ignores the centre zone and keeps the stick's magnitude outside it; Rescaled subtracts the zone from the remaining travel.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "cutoff", label: "Cutoff" },
      { id: "scaled", label: "Rescaled" },
    ],
    default: "cutoff",
    defaultReason: "The original behaviour.",
    home: main(GAMEPAD),
    appliesLive: true,
    source: "controls/src/flightInputManager.ts",
  },
  {
    id: "osfs.input.stickDeadzone",
    label: "Stick deadzone",
    description: "Stick deflection below this is read as centred: built into a controller profile when it is created, and used by bindings without their own.",
    unit: "fraction",
    kind: "number",
    step: 0.01,
    bounds: within(0, 0.5),
    default: 0.08,
    defaultReason: "The original deadzone of the Xbox and Classic profiles.",
    home: all(GAMEPAD),
    appliesLive: false,
    source: "controls/src/gamepadToolsAdapter.ts",
  },
  {
    id: "osfs.input.gamepadSmoothing",
    label: "Controller smoothing rate",
    description: "On the input path without controller bindings, the fraction of the remaining distance the stick and throttle close per second.",
    unit: "per-s",
    kind: "number",
    step: 0.5,
    bounds: within(0.5, 60),
    default: 8,
    defaultReason: "The original filter, min(1, 8·dt) per frame: about 95% of a held command in 0.375 s.",
    home: all(GAMEPAD),
    appliesLive: true,
    source: "controls/src/flightInputManager.ts",
  },
  {
    id: "osfs.input.takeoverDeadband",
    label: "Takeover deadband",
    description: "How far a control must move from where it rested before it takes over from another input.",
    unit: "fraction",
    kind: "number",
    step: 0.01,
    bounds: within(0.01, 0.5),
    default: 0.12,
    defaultReason: "The original value.",
    home: all(GAMEPAD),
    appliesLive: true,
    source: "controls/src/flightInputManager.ts",
  },
  {
    id: "osfs.input.throttleRate",
    label: "Throttle rate",
    description: "How fast held throttle keys and buttons move the throttle, in full travel per second.",
    unit: "per-s",
    kind: "number",
    step: 0.05,
    bounds: within(0.05, 5),
    default: 0.5,
    defaultReason: "The original value: idle to full in two seconds.",
    home: all(GAMEPAD),
    appliesLive: true,
    source: "controls/src/flightInputManager.ts",
  },

  // Controls → Keyboard response.
  {
    id: "osfs.input.keyboard.mode",
    label: "Response mode",
    description: "How held keys move the simulated stick.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "direct", label: "Direct", description: "Keys snap the stick to full deflection immediately." },
      { id: "smooth", label: "Smooth target", shortLabel: "Smooth", description: "Keys set a target; the stick eases toward it exponentially." },
      { id: "rate", label: "Rate ramp", shortLabel: "Rate", description: "Keys move the stick at a tunable rate that can accelerate with hold time." },
      { id: "assist", label: "Flight assist", shortLabel: "Assist", description: "Keys command pitch, roll and yaw rates; a PID drives the stick to match them." },
    ],
    default: "smooth",
    defaultReason: "Reproduces the original exponential filter.",
    home: main(KEYBOARD),
    appliesLive: true,
    source: KEYBOARD_STICK_SOURCE,
  },
  keyboardNumber("expo", "Expo", "Softens small keyboard deflections while keeping full range; 0 is linear. The HUD stick, gamepad and phone are unchanged.", "fraction", 0, 1, 0.05, 0, "The original, linear response."),
  keyboardNumber("smoothResponseSec", "Smooth response time", "Smooth: the time to reach about 95% of a held deflection.", "s", 0.05, 3, 0.025, 0.375, "The original filter, min(1, 8·dt) per frame."),
  keyboardNumber("smoothReturnSec", "Smooth return time", "Smooth: the time to centre after release.", "s", 0.05, 3, 0.025, 0.375, "The original filter, min(1, 8·dt) per frame."),
  keyboardNumber("rateTimeToFull", "Rate time to full", "Rate: seconds from centre to full deflection at the base hold rate.", "s", 0.1, 5, 0.05, 0.6, "The original value."),
  keyboardNumber("rateTimeToCenter", "Rate time to centre", "Rate: seconds from full deflection back to centre after release.", "s", 0.05, 3, 0.05, 0.25, "The original value."),
  keyboardNumber("rateAccelAfterSec", "Rate acceleration after", "Rate: how long a key is held before the ramp speeds up.", "s", 0, 3, 0.05, 0.35, "The original value."),
  keyboardNumber("rateAccelMultiplier", "Rate acceleration", "Rate: the peak ramp speed after a long hold, as a multiple of the base rate.", "ratio", 1, 8, 0.1, 2.5, "The original value."),
  keyboardNumber("rateMaxDeflection", "Rate maximum deflection", "Rate: the largest deflection the keyboard may reach.", "fraction", 0.1, 1, 0.05, 1, "The original value: full authority."),
  keyboardNumber("assistRollRateDeg", "Assist roll rate", "Assist: the roll rate a held aileron key commands.", "deg/s", 5, 180, 1, 45, "The original value."),
  keyboardNumber("assistPitchRateDeg", "Assist pitch rate", "Assist: the pitch rate a held elevator key commands.", "deg/s", 5, 90, 1, 20, "The original value."),
  keyboardNumber("assistYawRateDeg", "Assist yaw rate", "Assist: the yaw rate a held rudder key commands.", "deg/s", 5, 90, 1, 20, "The original value."),
  keyboardNumber("assistKp", "Assist proportional gain", "Assist: stick deflection per unit of rate error.", "ratio", 0, 5, 0.05, 0.8, "The original value."),
  keyboardNumber("assistKi", "Assist integral gain", "Assist: how fast a lasting rate error builds deflection.", "ratio", 0, 2, 0.01, 0.15, "The original value."),
  keyboardNumber("assistKd", "Assist derivative gain", "Assist: damping on how fast the rate error changes.", "ratio", 0, 1, 0.005, 0.02, "The original value."),
  keyboardNumber("assistMaxDeflection", "Assist maximum deflection", "Assist: the largest deflection the assist may command.", "fraction", 0.1, 1, 0.05, 1, "The original value: full authority."),

  // Controls → Orbit (FOSS Earth's section, beside its orbit inversion).
  {
    id: "osfs.input.touchWheelCooldown",
    label: "Touch wheel cooldown",
    description: "After a touch gesture ends, wheel pans are ignored for this long, so the browser's late synthetic ones do not orbit the camera.",
    unit: "ms",
    kind: "number",
    step: 10,
    bounds: within(0, 1_000),
    default: 180,
    defaultReason: "The original value, chosen to outlast the late wheel pans a browser synthesises after a touch ends.",
    home: all(ORBIT),
    appliesLive: true,
    source: "controls/src/flightCameraInput.ts",
  },

  // Controls → Feedback.
  {
    id: "osfs.feedback.hapticInterval",
    label: "Haptic interval",
    description: "Wheel contact is summarised into one vibration this often.",
    unit: "ms",
    kind: "number",
    step: 5,
    bounds: within(10, 500),
    default: 50,
    defaultReason: "The original value: one envelope per 50 ms window, never queued.",
    home: all(FEEDBACK),
    appliesLive: true,
    source: "controls/src/haptics.ts",
  },
  {
    id: "osfs.feedback.hapticMaxDuration",
    label: "Haptic maximum duration",
    description: "The longest one vibration may last.",
    unit: "ms",
    kind: "number",
    step: 5,
    bounds: within(10, 1_000),
    default: 60,
    defaultReason: "The original value, a little longer than the interval so pulses join.",
    home: all(FEEDBACK),
    appliesLive: true,
    source: "controls/src/haptics.ts",
  },
  {
    id: "osfs.feedback.minMagnitude",
    label: "Haptic threshold",
    description: "Weaker vibrations than this are not sent.",
    unit: "fraction",
    kind: "number",
    step: 0.01,
    bounds: within(0, 0.5),
    default: 0.03,
    defaultReason: "The original value.",
    home: all(FEEDBACK),
    appliesLive: true,
    source: "controls/src/haptics.ts",
  },
  {
    id: "osfs.feedback.touchdownReference",
    label: "Touchdown reference",
    description: "The strut impulse in one interval that gives a full-strength touchdown vibration.",
    unit: NEWTON_SECONDS,
    kind: "number",
    step: 10,
    scale: "log2",
    bounds: within(10, 10_000),
    default: 300,
    defaultReason: "An authored scale: roughly the main-gear strut impulse in the first 60 ms of a firm Cessna 172 touchdown.",
    home: all(FEEDBACK),
    appliesLive: true,
    source: "controls/src/haptics.ts",
  },
  {
    id: "osfs.feedback.slipReference",
    label: "Spin-up reference",
    description: "The tyre slip work in one interval that gives a full-strength spin-up vibration.",
    unit: JOULES,
    kind: "number",
    step: 10,
    scale: "log2",
    bounds: within(10, 100_000),
    default: 1_200,
    defaultReason: "An authored scale: roughly one 50 ms interval of the modelled gentle-touchdown spin-up.",
    home: all(FEEDBACK),
    appliesLive: true,
    source: "controls/src/haptics.ts",
  },
] as const satisfies readonly ParameterSpec[];

/** Every one of the flight controls' parameters. */
export const CONTROLS_PARAMETERS = [
  ...CONTROLS_PARAMETERS_1,
  ...CONTROLS_PARAMETERS_2,
  ...CONTROLS_PARAMETERS_3,
] as const;

/** The effective value of each of the flight controls' parameters, by id. */
export type ControlsParameterValues = CatalogueValues<typeof CONTROLS_PARAMETERS>;

export type ControlsParameterId = keyof ControlsParameterValues & string;

/** What the flight controls' code reads its parameters through: the registry, or its defaults in a test. */
export type ControlsParameters = CatalogueParameters<ControlsParameterValues>;

/** Reads, writes and watches the flight controls' parameters, typed by id. */
export type ControlsParameterStore = CatalogueStore<ControlsParameterValues>;

/** The registry, typed for the flight controls' parameters. */
export function controlsParameterStore(registry: CatalogueRegistry): ControlsParameterStore {
  return catalogueStore(registry);
}

/** The spec of one of the flight controls' parameters. */
export const controlsParameterSpec = catalogueSpec(CONTROLS_PARAMETERS);

/**
 * The flight controls' parameter defaults in memory, for code that runs without a
 * registry, such as a unit test. Overrides stand in for values the test sets.
 */
export function controlsParameterDefaults(overrides: Partial<ControlsParameterValues> = {}): ControlsParameterStore {
  return catalogueDefaults(controlsParameterSpec, overrides);
}

function keyboardNumber<Field extends string>(
  field: Field, label: string, description: string,
  unit: "s" | "fraction" | "ratio" | "deg/s",
  min: number, max: number, step: number, value: number, defaultReason: string,
) {
  return {
    id: `osfs.input.keyboard.${field}` as const,
    label,
    description,
    unit,
    kind: "number" as const,
    step,
    bounds: within(min, max),
    default: value,
    defaultReason,
    home: all(KEYBOARD),
    appliesLive: true,
    source: KEYBOARD_STICK_SOURCE,
  };
}
