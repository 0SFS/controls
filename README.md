# Controls

Keyboard, controller, and other flight-control input for 0SFS.

The fly app depends on this package and runs its tests. From the `fly` directory, `npm test` includes them.

[Camera gestures](docs/camera-gestures.md) covers what touchscreens, the phone's camera pad and a Mac trackpad give the flight camera.

## Community

- [Code of conduct](https://github.com/0SFS/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/0SFS/.github/blob/main/CONTRIBUTING.md)
- [License](LICENSE)
- [Security](https://github.com/0SFS/.github/blob/main/SECURITY.md)

## Keyboard axes and vertical input

Controls → Keyboard axes assigns W/S, A/D, Q/E, Shift/Ctrl or arrow pairs to pitch, roll/lateral, yaw and power/climb. Selecting a pair already in use swaps it with the previous pair. Keyboard hints and the profile runtime read the same mapping. Aircraft data supplies defaults. DJI airframes use A/D yaw and Q/E lateral.

`verticalControl: "climb-rate"` makes keyboard/gamepad rate commands spring-centered climb/descent input. The `climb` command is independent of `throttle`. `createClimbRateLever` shows requested m/s and releases to zero on pointer release/cancel, keyboard release or blur. Planes retain their persistent throttle lever.

`mountCenteredStick` supplies the shared pointer and keyboard behavior for flight and phone instrument joysticks. Each pad captures its own pointer, supports full travel on both axes, and releases to center on capture loss, blur, hidden page, resize, orientation change or teardown. Its raw coordinates are right/down positive; `stickResponse` and `inverseStickResponse` share the 3.5% deadzone between instruments. Releasing an idle pad sends no pilot input.

## Armament bindings

`flight.weaponNext` selects the next available weapon type through the host's `onWeaponNext` callback. Built-in profiles use keyboard Y; the Xbox profile also uses the left bumper. Space and the right bumper remain `flight.weaponRelease`, and Xbox Y still increases throttle. `withWeaponNextDefaults` fills older profiles in memory only when the command is entirely absent and those sources are unclaimed; saved bindings, remappings and disabled commands are preserved. Next weapon can also be assigned in the binding editor.
