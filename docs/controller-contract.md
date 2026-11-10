# Controller contract for Mimic games

What a browser game can rely on when a phone runs Mimic: how Grip and Wand buttons map, what
`games/lib/mimic.js` exposes, and how several phones show up for local multiplayer. Games should
feature-detect anything newer than the basics.

## Grip mode (phone in one fist, only the volume keys reachable)

The app's Grip mode **always** sends the **same motion report the Wand sends** (12 buttons, >= 6 axes),
so every game that reads `MimicController` (games/lib/mimic.js) works with Grip unchanged. Grip never
sends mouse or keyboard input: Point mode is the mouse. Button meaning:

| Phone | Wand button slot | Meaning in Mimic games |
|---|---|---|
| Vol Down held | `a` | HOLD: fire, grip the ball, raise the guard, swing-enable. Released = let go. |
| Vol Up tap | `b` | second action (game-specific: reload, back, special) |
| Vol Up hold (>= 600 ms) | `center` | align / recenter (straight ahead = now); up until Vol Up is released |
| Vol Up double tap | `one` | switch (weapon, camera, item) |
| CENTRE button on screen | `center` | align / recenter; up from 60 ms into the press until the finger lifts |
| Sideways flick of the phone | `two` | dodge (at most once a second) |

Every gesture bit (`b`, `center`, `one`, `two`) stays up for its whole press and at least 250 ms
(2026-11-10: 100 ms pulses were lost in Bluetooth stalls of 125 ms+). On align the phone zeroes its
heading on the direction of its top edge (projected on the floor), the back only when the top is
within a few degrees of vertical (MotionFeed.kt `YawRef`).

Games must never require any other Wand button to play; menus are driven by the Wand cursor
(games/lib/wandcursor.js: point + `a`) or by `a`/`b`.

Shooters (IRONFERN) read the same report: aim from the orientation (yaw/pitch deltas since the last
frame, 1:1 in angle), `a` fire, `b` reload, `one` switch, `two` dodge, `center` align.

Changed 2026-11-10: Grip used to have a second "PC" output (mouse aim + left click + R / F9 / Q /
Space keys) and switched to motion only when a Mimic game asked over WebHID (control byte
`0x80 | 0x10 | tag`, once a second). That is gone: it duplicated Point mode, and when the player
cancelled Chrome's WebHID chooser Grip silently stayed on the mouse and games played with a cursor
instead of the phone. The WebHID control message now carries only the slot tag (`0x80 | tag`, sent
once when the page opens the phone); the app ignores the old `0x10` bit. The keyboard collection
stays in the HID descriptor (changing it forces a Windows re-pair); Grip never sends keys. The only
key any mode sends is F9 from Point's CENTRE button, which the Windows tray turns into "cursor to the
middle of the screen".

`mc.mode` (read-only): `'wand' | 'grip' | 'mouse'` when the lib can tell; games may use it only
for wording ("hold Vol Down" vs "hold A").

## Several phones on one PC (local multiplayer, 2 to 4 players)

Each phone pairs to the PC as its own Bluetooth device, so the browser sees one gamepad per phone.

- `MimicController.all()` (static): the connected Mimic motion controllers (Wand or Grip),
  ordered by gamepad index, each a `MimicController` bound to that phone.
- `new MimicController({ slot: n })`: bound to the n-th Mimic motion controller (0-based). Slot 0
  keeps the mouse/keyboard fallback when no phone is there; other slots have no fallback
  (`connected` stays false).
- `new MimicController()` is slot 0.
- Mimic **Pad** phones appear as 16-button gamepads with id containing "Mimic" (Chrome reports
  mapping `""`: triggers on axes 3/4, D-pad as a hat on axis 9); games read those through
  `navigator.getGamepads()` (see Duskwater and Gyrowing).
- Browser phones (games/lib/mimic-link.js, see docs/browser-controller.md) show up as extra gamepads
  shaped exactly like the app's, so all of the above applies to them too.
- Rumble with several phones: best effort; `rumble()` on a slot targets that phone when WebHID can
  tell them apart, otherwise all.

A game can also read
`navigator.getGamepads()` directly (Wand/Grip = 12 buttons and >= 6 axes; quaternion in axes 0-2 as
in mimic.js `update()`), but should prefer the lib.

Player join flow (all multiplayer games, same look): a lobby showing slots P1..P4; a phone joins by
pressing `a` (Wand/Grip) or A/Start (Pad); `b` leaves; keyboard/mouse can take one slot; start when
everyone joined presses start/holds `a`.
