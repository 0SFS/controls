# Flight commands through one property batch — 7 November 2026

Part of [prompt 04](https://github.com/0SFS/fly/blob/main/docs/performance/2026-11-05/prompts/04-jsbsim-property-io.md)
of the 5 November phone audit (JSBSim property traffic), step 2. Baseline:
controls `2baf0c6`, fly `6a97ee1`, `@felipegalind0/jsbsim` 1.2.4-fork.21.
Ledger: P-118.

## What it was

fly calls `applyFlightControls` before every physics step. It set eleven
commands one `setPropertyValue` at a time: elevator, aileron, rudder,
throttle, pitch and roll trim, flaps, the three brakes and the gear lever.
Each single set converts the path string and walks the property tree again.
The Chrome recount in fly's
[rest check note](https://github.com/0SFS/fly/blob/main/docs/performance/2026-11-07/rest-check-order.md)
has these 11 among the largest groups of single calls left in a C172 step.

## What changed

The eleven commands go through one native `PropertyBatch` per SDK, kept in a
`WeakMap`, with its slots in the order the single sets were made. A batch
write sets its slots in order, and a tied property's setter runs as its
value is set, so JSBSim sees the same sequence of setter calls. The batch is
made with `create: true`: a single set creates a property the model lacks,
and some models lack some of these commands (the harness below fails
without it).

- Made on the first call for an SDK; made again when a write throws, which
  happens after a model load (the SDK disposes every batch then). A
  disposed batch writes nothing, so the commands are written once.
- An SDK with no `createPropertyBatch`, or one that cannot make a batch,
  gets the eleven single sets in the same order, as before.
- The conditional writes keep their conditions and their places as single
  sets: the control law, automatic flaps and full-stick roll rate before the
  batch, the STOVL command after it.

## Exactness

- Differential harness (`fly/build/command-batch/diff.test.ts`): the old
  function (HEAD copy) and the new one on two real JSBSim instances in
  lockstep, given the same commands. The C172, the three Vision Jets and the
  F-35B with both engine models, 4 seeds each, half in the air and half on
  the ground, 1,500 steps a run. Every axis moves, with jumps to the ends of
  its range, to 0, -0, and a quarter past full; the gear, STOVL, control law,
  automatic flaps, roll rate and roll trim range change; the model is loaded
  again at step 700 and now and then after. After every call, the eleven
  commands and the conditional properties, and after every step 24 state
  properties (position, attitude, rates, surface positions, throttle, gear,
  thrust, trims), are identical under `Object.is`. Last, values a type check
  refuses (NaN, Infinity, `undefined`, `true`, `"0.25"`) are stored the same.
  Totals: 35,682 calls and steps, 71 model loads, 95 batches made, no single
  command set on the new side. One run stopped at step 1,181, where the
  state is no longer finite on both sides. A/A passes.
- `tests/applyFlightControls.test.ts`, 4 new tests: the order of single sets,
  the batch write and the STOVL set; the batch made once with `create: true`
  and reused; one batch per SDK; a disposed batch replaced with the commands
  written once; the single-set fallback in the same order.
- Mutants (`fly/build/command-batch/mutants.py`): 13 of 14 caught, all 13
  by the unit tests. Nine were also run against the harness alone. It
  caught the seven that change what is written (swapped paths, no `create`,
  no retry after a load, a wrong brake value, the rudder sign or roll trim
  range dropped, the gear forced down), but not the two that only reorder
  writes (the brakes swapped, STOVL before the batch): in these models no
  command's setter depends on another's, so only the tests see the order.
  The survivor, not disposing the batch after a failed write, is
  equivalent: a write fails only on a batch that is already disposed.
- Suites through fly's vitest config: controls' tests and fly's JSBSim,
  physics, app, phone, drone, audio, diagnostics and aircraft tests, 102
  files, 1,294 tests pass (3 expected failures, as before). fly's two app
  test files give their batch mock a `write` that sets each slot in order,
  as the SDK's does. fly `npm run typecheck` passes.

## Measured

Node 22 on the M5, real JSBSim, airborne at 3,000 ft and 110 kt, each
aircraft with the conditional writes fly makes for it. Medians of 9
interleaved rounds of 20,000 calls; ranges are the rounds' minimum and
maximum. Script: `fly/build/command-batch/bench.test.ts`.

| Aircraft | Before | After | JSBSim step |
| --- | ---: | ---: | ---: |
| C172 | 7.11 µs (7.10–7.18) | 0.19 µs (0.18–0.28) | 16.4 µs |
| Vision Jet | 8.95 µs (8.92–9.04) | 0.22 µs (0.21–0.25) | 14.9 µs |
| F-35B | 13.07 µs (13.04–13.08) | 4.21 µs (4.21–4.24) | 110.2 µs |

The F-35B keeps its conditional single sets (control law, automatic flaps,
roll rate, STOVL). At 60 steps a second the saving is about 0.42 ms/s of
main thread for the C172, 0.52 ms/s for the Vision Jet and 0.53 ms/s for the
F-35B. These are Node timings, not frame rates. Not measured: the browser
frame profiler, a phone.

## Left

The F-35B's conditional writes could share a second small batch keyed by
the properties present. The rest of prompt 04 is reads.
