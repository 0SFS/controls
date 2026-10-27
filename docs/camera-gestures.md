# Camera gestures

What each surface gives the flight camera, and why a Mac trackpad cannot turn
the view and zoom it in one gesture as a touchscreen can. Checked 2026-10-27.

## Two fingers at once

| Surface | What the page receives | Two fingers |
| --- | --- | --- |
| Touchscreen on the computer | Touch events with every finger | Turn the view with the point between them and zoom with their spread, at once (`flightCameraInput.ts`) |
| Phone camera pad | Touch events with every finger | The same by default; ⚙ Settings → Camera pad → **Zoom only** makes them a pinch only (`osfs.phone.twoFingers`, rc `PhoneStick.tsx`) |
| Mac trackpad | One gesture, already classified by macOS | A swipe turns the view or a pinch zooms it, never both |

The glide that carries a gesture on after the fingers lift is
`src/cameraGlide.ts`. A touch surface that counts its fingers drives it through
`createTouchSurfaceGlide`:

- The first finger landing stops the glide.
- A finger joining one already down stops only a glide left from an earlier
  lift, so a swipe carries on into a pinch without a hitch.
- Lifting one of two fingers lets the zoom glide on while the finger left goes
  on turning the view. Lifting the last lets the turn glide on.

## Why a Mac trackpad turns or zooms

A browser never sees the fingers on a Mac trackpad. macOS reads the contacts
itself, decides what the gesture is, and hands the page only the result:

- a two-finger move as plain `wheel` events (`deltaX`, `deltaY`), with the
  system's momentum after the lift;
- a pinch as `wheel` events with `ctrlKey` set, the spread in `deltaY`. Chrome
  and Firefox both do this.
- in Safari, a pinch also comes as `gesturestart`, `gesturechange` and
  `gestureend`, carrying `scale` and `rotation`. `flightCameraInput.ts` takes
  Safari's pinch from these and ignores its ctrl+wheel copy.

macOS picks one kind per gesture and keeps it until the fingers lift. A probe
page that logged every event while the user pinched and slid at once, in
Firefox 157 on macOS 27, confirmed this: each gesture arrived as all scroll or
all pinch, never both interleaved. No web code can split them again, so on
/fly a trackpad gesture turns the view or zooms it, whatever the code allows.
FOSS Earth's globe locks each wheel gesture to its first kind too, on purpose
(`engine/src/input/wheelGesture.ts`, which ends a gesture after 180 ms without
an event).

Two ways around it, neither taken:

- **Safari's rotation.** A pinch in Safari carries `rotation` as well as
  `scale`, so a twist of the two fingers could turn the view while their spread
  zooms. Only Safari sends it, and only around the vertical axis, so pitch would
  still need a swipe.
- **Raw contacts in a native process.** The contacts do reach native code
  before macOS classifies them. A small Swift probe read them through the
  private `MultitouchSupport.framework` on macOS 27 at 125 Hz, with no
  permission prompt. That needs something the pilot downloads, which a web app
  should not ask for. It is kept as an idea for a downloadable app, with the
  probe's findings, in
  [Downloadable app ideas](https://github.com/0SFS/docs/blob/main/proposals/downloadable-app.md).
