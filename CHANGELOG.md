# Changelog

Updated just before each approved release, not on every change.

## Unreleased

### Games and browser controller (2026-11-10)
- **Browser controller (new):** any phone, iPhone included, can be a controller without the app.
  A game shows a QR code; the phone opens a web page and links to the PC over WebRTC. The game sees
  it as a normal Mimic phone, so every game works unchanged, and multiplayer lobbies get a "Scan to
  join" code next to the empty slots. Needs a secure page for the motion sensors (USB `adb reverse`
  locally, mimic.shing.in once live) and a small signaling endpoint (built into `tools/serve.py` for
  now). No volume keys or iPhone vibration in a browser, and some strict networks block the link.
- **Browser phones, seamless:** games name the buttons the player actually has (a browser phone's
  Grip shows HOLD / B / CENTRE / SWITCH, the app's Grip keeps Vol Down / Vol Up). The QR panel works
  like a lobby: a seat per player, each phone presses a button when ready, and it closes by itself
  (no reaching for the mouse). A browser phone follows the tab to the next game without a rescan, a
  one-player game reads whichever phone is moving (an idle app link no longer hides it), and pages
  without a signaling relay show no QR that could not connect.
- **Every local play is recorded:** on this machine's server each play saves the game video and every
  input (no prompt), so feedback can point at a real session; `?rec=0` turns it off.
- **Duskwater: The Gulls.** Fall in the fight, rise as a gull: a dead player flies over the depot for
  the rest of the round, marks every enemy it sees for its team (through walls, on the radar, to bot
  teammates) and dives (R2 / click) to blind an enemy for 1.7 s; a kill within 5 s pays a gull assist
  (+$200). Gulls can be shot down and return after 4 s. Why: a death meant up to 100 s of watching, the
  worst part of couch play. Also rumble on every player's own phone or pad, a low-health heartbeat,
  slow motion on the round-winning kill and a 1 v N last-stand callout. The spectator camera is gone.
- **Point CENTRE:** Point mode gets a CENTRE button that taps F9; the Windows tray turns it into
  "cursor to the middle of the screen".
- **Emberlane (new):** bowling with the phone as the ball. The release uses the hand's measured
  velocity (accelerometer), not where the phone points, so wrist bend no longer becomes fake aim or
  loft. The lane's straight line comes from the forearm when you pick the ball up. A key released up
  to 150 ms after the swing bottom lets go at the bottom, as real fingers do. Aim Normal (0.4x) or
  Pro (1:1), optional gutter bumpers, realistic bounces, fast pacing. The first game with the phone
  starts with a line-up: three practice swings at an empty lane learn how the phone sits in this
  player's fist (median of agreeing swings; a wild one asks for another), so straight ahead fits
  any grip. Only practice swings teach it, never real throws (no aim assist).
  Standing in a room nobody walks, so the game adds a real bowler's approach (2 m/s) to every forward
  throw: the hand measured 11-13 km/h on swings the player called hard, and the ball felt dead. With
  it and Aim Normal at 0.25 (was 0.4), the same recorded swings knock twice the pins (98 vs 50 over
  18 balls, gutters 2 vs 10); a test replays that session so a later change cannot undo it. Why: recorded sessions showed
  balls drifting into the gutter from a reference error and a late key, not the player.
- **Every game fits the window:** all screens checked at six laptop sizes (browser bars included),
  equal-width buttons, short how-to panels with a "More" toggle.
- **Release settings:** volume and graphics quality with an automatic fallback in every game;
  left-handed play in Sunvolley and Cadence Cut (mirrored arm and stroke reading); reduced flashes
  in Cadence Cut; phone pause (keep holding Vol Up) and a settings screen in IRONFERN.
- **Performance:** Duskwater draws half the objects and compiles shaders at match start (about
  56 fps solo on Iris Xe when the machine is quiet); Emberlane's strike camera hitch reduced.
- **Fixes:** Iron Ludus versus shield now stays on the rival's arm; Gyrowing's objective arrow
  pointed the wrong way; IRONFERN pause and settings shared element ids.

### App release readiness (2026-11-10)
- **Fixed: crash at launch on Android 10 and 11.** The vibration code asked for a system service
  that only exists from Android 12, so the app closed immediately on older phones. It now uses the
  older service there.
- **Fixed: Bluetooth never started on Android 10 and 11.** The app asked for Android 12's "Nearby
  devices" permission, which does not exist on older versions and so always came back "denied".
  It now asks only on Android 12 and newer.
- **Fixed: a quick tap on Point's CENTRE could do nothing.** A tap that pressed and released F9
  within one 8 ms Bluetooth report was merged into "no key", so the PC never saw it. Every tap now
  reaches the PC once.
- **Fixed: cursor jump after a reconnect.** Moving the phone while the link was down saved the
  motion up and sent it all at once when the PC came back, flinging the cursor into a corner. That
  motion is now dropped.
- **Fixed: the Wand screen could crash** if the Dolphin Wi-Fi port could not be opened; Dolphin over
  Wi-Fi is optional, so it now just stays off. "Pair a new laptop" no longer crashes when the
  permission is missing.
- **Permission screen:** if "Nearby devices" is refused, Home explains why Mimic needs it and offers
  one button to allow it (or to open the app's settings once Android stops asking). Granting it there
  starts Bluetooth without restarting the app.
- **About, help and licences** (Settings > About): version, a "Check for updates" button that says
  checking, up to date, update available or could not connect (no crash offline), how to pair with
  Windows and when to re-pair after an update, what Point's CENTRE needs (the Windows tray app),
  links to the website, source, releases and issues, and the MIT and Apache 2.0 licence texts.
- **Settings:** a vibration on/off switch (also silences game rumble), a note that Wand and Grip aim
  speed is set in each game (they send the phone's real angle), and "Reset settings to defaults"
  (asks twice; keeps the paired PC).
- **First-run pairing guide** now says the phone stays visible for 2 minutes and how to re-pair.
- No change to the Bluetooth descriptor: no re-pair needed.

### Review round (2026-11-09), tuned from recorded play sessions
- **Grip mode (was Gun), buttonless:** in a pistol grip only the volume keys are reachable, so they do everything.
  Vol Down fires; Vol Up taps reload, holds to align, double-taps to switch weapon; a sideways flick
  dodges. Aim is absolute from the last align, so the crosshair never drifts away from the phone.
- **Grip is motion only:** Grip always sends the Wand's motion report (Vol Down = a, Vol Up tap = b,
  hold = center, double tap = one, flick = two, CENTRE = center). Its old second output, mouse plus
  R / F9 / Q / Space keys switched over WebHID, is removed: it duplicated Point mode, and when the
  player cancelled Chrome's WebHID prompt Grip stayed on the mouse and Emberlane silently played with
  the cursor instead of the phone. The PC / "Mimic game" pill, the Grip aim-speed setting and the
  games' once-a-second motion request are gone; WebHID now only tags each phone once for rumble.
  The Bluetooth descriptor is unchanged, so no re-pair. IRONFERN now reads the phone directly: aim
  1:1 from where it points (Phone aim setting in the pause menu), menus driven by the phone cursor.
- **Play recorder:** add `?rec=1` (or press F8) in any game to save video plus every controller input
  to `recordings/` through `tools/serve.py`, which also replaces the old static server.
- **Wand as a cursor:** every Wand game's menus can be driven by pointing and pressing A.
- **Windows tray:** frees the mouse pointer when another program leaves it fenced in.
- **IRONFERN (new):** a fixed-stand dino hunt for Grip mode. Five missions, playable with aim and fire
  alone (weapon per stand, auto-reload, auto-scope), markers and off-screen arrows, fair dodges.
- **Iron Ludus (new):** a colosseum sword fight for the Wand. Spamming loses (stamina, rushed cuts,
  flailing), opponents read and punish patterns, blades clash, bind and beat.
- **Gyrowing:** fly the real world (Sentinel-2 imagery, real terrain, 12,854 airports) with tours,
  hops, scored landings and ring runs. The "pushed down" feel is fixed (stall, spiralling auto-rudder,
  always-on turbulence, phone drift), and a new Steady assist is the default.
- **Cadence Cut:** a 12-level campaign with real music and new note types; swings past the screen
  edge keep their direction.
- **Duskwater:** realistic weapons, characters and sounds; stick aiming retuned from a recording.

### Feedback round (2026-11-08)
- **Tennis, hit rebuilt from recorded strokes:** the racket angle is automatic. Where your hand travels
  aims the ball (measured from the phone's motion sensor, wind-up ignored); swing speed sets how far,
  and an over-hit goes long. Serves can now land anywhere in the box, or out.
- **Gun mode (new):** hold the phone like a pistol for any PC shooter. Aim follows where the top
  points in any grip, volume down fires, volume up reloads (R). The phone now also acts as a
  keyboard, so re-pair once.
- **Duskwater:** an on-screen key guide that names the phone's buttons, puts the shop first during buy
  time, and hides with HOME or H.
- **Gyrowing:** a flight coach that gives the one next step (throttle, rotate at 55 kt, gear up,
  climb; approach, flare and brake when landing).

### Redesign (2026-11-08)
- **Brand:** the mimic octopus logo and app icon; Chameleon, Ink and Arcade themes in Settings.
- **Grip-first modes:**
  - **Point** (air mouse) with thumb-zone click pads, a notched scroll strip, volume keys as
    back/forward, and sleep when put down.
  - **Wand**, a motion controller over Bluetooth with game rumble.
  - **Pad**, a gamepad with anchored floating sticks, an ABXY arc, size and visibility sliders, and
    optional tilt-to-aim.
- **Haptics:** a full vibration language (click, thud, ticks, rim bump, swing, connect), and games can
  make the phone vibrate on impact.
- **App flow:** first-launch intro and pairing guide, a new home screen, full-screen modes with
  hold-to-exit, palm rejection, and screen dimming.
- **Games:**
  - **Mimic Open (tennis):** swing-timed magnetic hits, the serve aimed by the phone at the toss, and
    Hit zone / Swing power options.
  - **Cadence Cut (slash rhythm):** screen-space cuts, and charts that use the whole grid and flow from
    one cut into the next.
  - **Duskwater (tactical arena shooter, for Pad):** a gentler look profile for the phone's touch stick.
  - **Gyrowing (flight simulator):** hold the phone flat and tilt to fly.
  - All of them can make the phone vibrate through the controller library.
- **Windows tray app:** swaps the cursor to the Mimic pointer while the phone is moving it.
- **Dolphin:** a Wii Remote profile (draft).
- **Hardening from the final review:**
  - A stick zone no longer grabs a finger outside it, and a resting palm no longer steals it.
  - Controllers go quiet when the app is in the background or the screen is locked.
  - Game rumble survives reconnects.
  - The D-pad supports diagonals.
  - The debug hooks only run in development builds.
  - The tray pointer respects display scaling.
- **Removed:** the camera and desk-slide mouse modes, and Wi-Fi tennis served from the phone.
- **Re-pair needed:** the Bluetooth descriptor changed (rumble), so remove the phone in Windows
  Bluetooth settings and pair again once.
