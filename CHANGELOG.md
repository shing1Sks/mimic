# Changelog

Updated just before each approved release, not on every change.

## 1.0.0 (2026-11-13)

First public release: the Android app (air mouse, gamepad, Wand/Grip motion controller over Bluetooth) and nine browser games playable at mimic.shing.in, with the app or straight from a phone browser.


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
- **Iron Ludus: real swordplay.** The sword is a 3D blade driven 1:1 by the phone; blocking and
  parrying mean meeting his blade with yours (no shield button, sidestep or thrust button). Damage from
  contact speed, edge vs flat vs thrust and hit location, with lasting wounds (disarm, shield drop,
  kneel, limp, daze). Opponents telegraph with their bodies, feint, read repeated lines and punish a
  missed full swing; stamina and the rushed / waggle / tired penalties are gone. Why: replaying the
  player's session, 74% of real swings were scored as glances and big swings averaged 0.11 power.
  New training post, rebuilt split-screen versus, swing / hit / parry logging.
- **Willowlight (new):** two-phone floodlit cricket in Grip. One phone bowls a real overarm action (pace
  from arm speed, length from release timing, line from the swing plane, spin from wrist twist, swing
  from the seam), the other bats with the phone as the handle (timing, swing path, straight or cross
  bat). Edges, bowled, LBW, catches by AI fielders, auto-run singles, fours and sixes; broadcast HUD
  with speed gun, pitch map and wicket / six replays; two-seat lobby with role swap; solo match and
  nets against the computer. Dropped for now: reverse swing, run-outs, byes, DRS.
  Round 2, from the player's session: the ball now leaves at the arm's whip, not the key-up (the
  key came up 92 ms before to 25 ms after the whip, so reading the arm at key-up gave 40-57 deg
  wides; the 4 real throws now go within 7 deg and pitch within 1 m of the aim); stray taps are
  ignored; spin and swing judged against the player's own grip; a card after every ball shows aim
  vs pitch, timing, line and movement. Players in front of the camera fade out and the field sits
  clear of the view. Broadcast cuts, short skippable replays, fireworks and LED boards on sixes, a
  roaring crowd, horns, drums, celebrations and commentary captions.
  Round 3: you bowl from your own end (camera behind your arm) and two players get split screen;
  the release reads the forward whip (25 of 26 real throws accepted, was 15 of 26) and LINE-UP learns
  each bowler's habit; a heavier-looking ball; flags, a Mexican wave, chants, big screens, rocket
  fireworks and cartwheeling stumps.
- **IRONFERN: ADRENALINE.** Weak-spot hits, kills and dodges fill a meter; when it is full and an animal
  lunges at you the world slows to 0.28x for up to 3 s (aim stays 1:1, the phone beats like a heart)
  and a kill inside it is a CLUTCH. Rumble on every shot, kill, hurt, roar, charge and big footstep
  (the game never vibrated before); freezes on kills, slow-motion rex and trike deaths; a new gun and
  arm look with spring recoil; Light quality about half the GPU time. Browser phones see HOLD / B /
  CENTRE / SWITCH.
  Round 2, from the player's session (aim swung -119 to +111 deg chasing raptors that flanked and
  leapt into the face): phone mode shows only phone controls (no Space / click / Esc anywhere), no
  weapon switching (each stand hands you its gun), and the threat plays out at range: raptors stalk
  a 21-27 m ring in front and rush from there (two hits stop a rush), spitters, trike and rex attack
  from distance and never from outside the view; ADRENALINE drops in during the last ~15 m of a
  charge. Phone players aim and fire: the flick still dodges but is no longer taught.
- **Gyrowing: Low pass and the skim score.** Fly under 200 ft and over 70 kt over real terrain to
  build x8 chains with ridge-skim, valley-threading and stunt bonuses; every place, including any
  searched airport, leads with a 2-minute Low pass with a best score. Speed streaks, a tighter
  low-level camera and ground-rush audio; barrel rolls and loops (double-flick the stick, or 1 / 2);
  60 deg sport turns at full stick; rumble for skimming, bonuses, rings and stunts. Rebuilt cockpit
  (chrome gauges, leather glareshield, wet compass, real yokes, throttle quadrant, night lighting).
  Faster: tree LOD, Performance tier by default on integrated GPUs, no cockpit glass overlay.
  Real cities: real-world flights stream OpenStreetMap (OpenFreeMap vector tiles): real buildings
  with heights and roofs, roads, rivers, coastlines, parks with trees, airport runways and taxiways,
  city lights at night. Tiles are cached in the browser and requested gently (2 at a time, back-off);
  new Options row "Real-world map detail". The island gets more villages, boats and traffic.
- **Tidecast: Depths.** The cast becomes a dive: the camera plunges under with the lure and the phone
  steers it on its line (tip down dives, turn to bank, level hovers, a flick jigs, hold A to reel
  up; 30-350 m of line). Four zones (sunlit reef, kelp forest over a wreck, bioluminescent twilight,
  an abyss teaser), 15 fish with schools, ambushers and predators. A pull back sets the hook; a
  running fish heads for cover and snags unless you lean away, and bigger fish swallow what you've
  hooked and take over the line. Sell, keep as bait or release; a tackle box of upgrades; a field
  guide; saved progress. Dock Party becomes a side-on aquarium. Replaces the dock-and-float game.
- **Tidecast (new):** motion fishing on a golden-hour dock. Cast with a real flick (hold A as a thumb
  on the spool, let go as the rod comes forward: timing and wrist speed set the arc), feel nibbles and
  the strike through the phone, set the hook with an upward jerk, then fight: rod angle against the
  fish's runs, reel by circling the rod tip (or hold A), keep the line between snapping and slack, bow
  when it jumps. Seven fish with their own habits, one legendary at sunset. Golden Hour (calm solo),
  Sunset Derby, and Dock Party for 2-4 phones where the round clock is the sun going down.
- **Duskwater: The Gulls.** Fall in the fight, rise as a gull: a dead player flies over the depot for
  the rest of the round, marks every enemy it sees for its team (through walls, on the radar, to bot
  teammates) and dives (R2 / click) to blind an enemy for 1.7 s; a kill within 5 s pays a gull assist
  (+$200). Gulls can be shot down and return after 4 s. Why: a death meant up to 100 s of watching, the
  worst part of couch play. Also rumble on every player's own phone or pad, a low-health heartbeat,
  slow motion on the round-winning kill and a 1 v N last-stand callout. The spectator camera is gone.
  Fairer bots: they react like people (Recruit ~0.9 s, Regular ~0.65, Veteran ~0.43), aim settles and
  drifts instead of locking on, turn at a limited speed, miss and pause, and no longer know exactly where
  you are. Difficulty labelled Recruit / Regular / Veteran and starts on Recruit; versus gulls mark on
  the radar only.
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
- **Emberlane sound:** the pins clipped (true peak 1.66, over a thousand clipped samples per strike) and
  the knock clips were 90% mid-range ringing: now a limiter and soft clip on the master, knocks
  re-pitched and shortened with a synthesised maple body, a voice cap, warm EQ and a hall reverb. A
  heavy ball rumble with doppler, gutter tone, landing and pit thuds and the ball return; strike,
  spare, split and gutter moments with stings and room reactions that build through double and
  turkey; a procedural lounge band that ducks under the roll; looping alley ambience with distant
  lanes. New MUSIC slider (default 50%); VOLUME is now EFFECTS.
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
