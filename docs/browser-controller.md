# Browser controller

Any phone can be a Mimic controller without installing anything: the game page on the PC shows a
QR code, the phone's camera opens a web page, and that page talks to the game directly over WebRTC.
iPhones work too. Browser phones and Bluetooth phones (the Mimic app) can play in the same game.

To the game, a browser phone looks exactly like a Bluetooth phone running the app, so nothing in a
game has to change.

## Pieces

| File | What it does |
|---|---|
| `games/lib/mimic-link.js` | PC side. Shows the QR, runs signaling, accepts phones, and adds each phone to `navigator.getGamepads()` as a virtual gamepad. |
| `games/lib/mimic-proto.js` | Shared by both sides: orientation maths, the packet format, the virtual gamepad shapes, the signaling client. |
| `games/lib/qr.js` | QR code encoder (no dependencies). |
| `games/phone/` | The phone page: Grip, Wand and Pad. |
| `tools/serve.py` | Dev server. Also hosts the dev signaling mailbox (`/signal/...`). |

## Using it in a game

Add one script tag after `mimic.js`:

```html
<script src="../lib/mimic.js"></script>
<script src="../lib/mimic-link.js"></script>
```

To show a QR where players will see it, put an empty element with `data-mimic-join` in the page
(title screen, lobby). A page with no such element gets a small "Phone browser" button in the bottom
left corner instead (`data-button="bl|br|tl|tr|off"` on the script tag picks or removes it), so the
button never sits on a game's HUD. It works on elements that
are added later too, so lobby code that rebuilds its HTML can include it.

```html
<div data-mimic-join="grip"></div>               <!-- QR + "Scan to join" -->
<div data-mimic-join="pad" data-size="96"></div>  <!-- size in px -->
<div data-mimic-join data-compact></div>          <!-- small "Scan to play" chip -->
```

The value is the mode the phone suggests (`grip`, `wand`, `pad`, or empty to let the player pick).

JavaScript API: `MimicLink.showQR(container?, mode?)`, `MimicLink.hideQR()`, `MimicLink.phones()`,
`MimicLink.rumble(gamepadIndex, strength, ms, pattern)`, `MimicLink.on('join' | 'leave' | 'change', fn)`,
`MimicLink.url(mode?)`.

Script tag options: `data-signal` (signaling URL), `data-phone` (phone page URL), `data-button`,
`data-mode` (the corner button's suggested mode).

## What the game sees

| Phone mode | Gamepad |
|---|---|
| Grip, Wand | id `Mimic Web (Vendor: 038f Product: 1200)`, 12 buttons, 6 axes. Axes 0 to 2 are the orientation quaternion, 3 to 5 the acceleration, with the Grip/Wand code in the low bits. Same as the app, so `MimicController`, `MimicController.all()` and `mc.mode` work. |
| Pad | id `Mimic Web Gamepad (Vendor: 038f Product: 1201)`, mapping `""`, 16 buttons, 10 axes: the app's Pad as Chrome shows it (left stick 0/1, right stick 2/5, L2/R2 analog on 3/4 resting at -1, D-pad as a hat on axis 9). Games that already read the Mimic Pad read this too. |

Several phones give several gamepads. A virtual pad takes the lowest free gamepad index. If a
Bluetooth pad later appears on that index, the real pad keeps it and the browser phone moves.

Rumble: `MimicController#rumble()` and a virtual Pad's `vibrationActuator.playEffect()` reach the
browser phone. `mimic-link.js` wraps `MimicController.prototype.rumble`; `mimic.js` itself is not
changed. The phone vibrates with `navigator.vibrate`, which Android Chrome has and iOS Safari does not.

## Signaling contract

The phone and the PC exchange a WebRTC offer, an answer and ICE candidates through a small HTTP
mailbox. Each message goes from one peer to another inside a room. The PC is always the peer `host`.
Each phone picks a random id.

```
POST <base>/<room>
  body (sent as text/plain so the browser skips the CORS preflight):
  {"from": "<id>", "to": "<id>", "type": "<offer|answer|ice|bye>", "data": {...}}
  -> 200 {"seq": <n>}

GET <base>/<room>?for=<id>&after=<seq>&wait=<ms>
  -> 200 {"seq": <latest seq in the room>, "msgs": [{"seq", "from", "to", "type", "data"}, ...]}
     only the messages addressed to <id> with seq > after, oldest first
```

- `room` and ids match `[A-Za-z0-9_-]{1,40}`. `type` is 1 to 20 characters. Bodies are at most 64 KB.
  A bad request gets 400 with `{"error": "..."}`.
- `seq` counts up per room.
- `wait` is optional. A server may hold the GET open until a message arrives or `wait` passes
  (long-poll, the dev server holds up to 15 s), or answer at once. Clients poll no faster than every
  300 ms when the answer comes back empty and quick, so both kinds of server work.
- A message lives 60 s. A room with no new messages for 10 minutes is deleted. A room keeps at most
  500 messages.
- Responses carry `Access-Control-Allow-Origin: *`, and `OPTIONS` answers 204, so a game page on one
  host can use signaling on another.

Message `data`:

| type | from, to | data |
|---|---|---|
| `offer` | phone to host | `{sid, sdp, mode, name}`. `sid` is new for every connection attempt. |
| `answer` | host to phone | `{sid, sdp}` |
| `ice` | either way | `{sid, c}`, where `c` is `RTCIceCandidate.toJSON()` |
| `bye` | phone to host | `{sid}`, sent when the phone page closes |

The phone makes the offer and opens both channels. The host ignores a repeated offer with the same `sid`.

Dev server: `tools/serve.py` serves this at `/signal/<room>`, plus `GET /signal-info` →
`{lan, port, lan_bound}` so the PC page can put its Wi-Fi address in the QR. Production: the website (mimic.shing.in) runs the same contract as a Vercel function
(mimic-site `api/signal.js`, rewritten from `/signal/<room>`), storing messages in Upstash Redis with
the same TTLs. Its `/signal-info` answers `{lan: null, lan_bound: true, hosted: true}`, or 404 when no
store is configured, which hides the QR.

The phone page finds signaling at `<its own origin>/signal` unless the URL has `&sig=<url>`. The
PC page adds `sig` to the QR only when the two differ.

## Data channels

Two DataChannels, both opened by the phone:

- `motion`: unordered, `maxRetransmits: 0`. State packets at the sensor rate (Pad: while a stick is
  held, plus 4 per second). A lost packet is never resent.
- `ctl`: reliable and ordered. Button changes (the same state packet), JSON control messages.

State packet (binary, little endian, 28 bytes):

| bytes | field |
|---|---|
| 0 | kind: 1 motion, 2 pad |
| 1 | flags: bit 0 = phone page visible |
| 2-3 | motion buttons, bits 0-11 = A B 1 2 - + Home Up Down Left Right Centre |
| 4-7 | seq (shared by both channels) |
| 8-15 | phone time in ms (`performance.timeOrigin + performance.now()`, float64) |
| 16-27 | motion: six int16 axes, already signed with the mode code, exactly as the app sends them |
| 16-24 | pad: uint16 buttons (A B X Y L1 R1 L2 R2 Select Start L3 R3 Home), int8 lx ly rx ry, uint8 lt rt, uint8 hat (0 = up, clockwise, 8 = centred) |

Every packet carries the full state. The PC keeps only packets with a higher `seq` than the last
one it applied, so a late motion packet never overwrites a newer button change.

Control messages (JSON over `ctl`):

| message | direction |
|---|---|
| `{t:'hello', mode, name}`, `{t:'mode', mode}` | phone to PC |
| `{t:'welcome', player, index}` | PC to phone |
| `{t:'ping', pc, rtt}` / `{t:'pong', pc, ph}` | PC asks, phone answers with its clock. The PC uses this for round trip time and the clock offset. |
| `{t:'rumble', s, ms, p}` | PC to phone. Strength 0 to 1, duration in ms, pattern 0 to 3. |

## Orientation

The phone page reads `RelativeOrientationSensor` where the browser has it (Chrome on Android,
which hands back a quaternion directly) and otherwise `deviceorientation` (Safari). The angles become
the same phone-to-world quaternion as Android's rotation vector, R = Rz(alpha) Rx(beta) Ry(gamma). After
that the page does what `MotionFeed.kt` does: a yaw-only reference is taken when Centre is pressed,
the result is ref × q with w ≥ 0, and it is sent as int16 with the Grip or Wand code in the low bits.
Acceleration is gravity, computed from the orientation, plus `devicemotion`'s linear acceleration.

## Running it in development

1. Start the server: `python tools/serve.py 8765`. Add `--lan` to let phones on the same Wi-Fi reach it.
2. Open a game, for example `http://127.0.0.1:8765/tennis/`, and click **Phone browser**.
3. On the phone:
   - Motion (Grip, Wand) only works on a secure page: https, or `localhost`. Plain http on a LAN
     address hides the sensors. With a USB cable:
     `adb reverse tcp:8765 tcp:8765`, then open `http://localhost:8765/phone/?room=<room>` on the
     phone (the panel shows this exact link).
   - Over Wi-Fi with `--https`: the server also serves https on port+1 (self-signed certificate for this
     PC's Wi-Fi address, made once into `tools/.cert/`) and the QR points the phone there. Keep the game on
     `http://127.0.0.1:8765` and scan. The phone warns about the certificate once: Advanced, then Proceed.
     Grip, Wand and Pad all work.
   - Over Wi-Fi with only `--lan`, Pad works. Grip and Wand need https.
4. On the dev server, the phone page records itself: every reading, packet sent and control message goes to
   `recordings/<game session>/phone-<id>-<time>.ndjson`, beside the game's own recording. `games/lab/`
   (Swing Lab) reads a Bluetooth phone and a browser phone at once through the cricket bat maths.

Tests: `python games/lib/test/qr-lab.e2e.py` (the Wi-Fi https flow and its recordings). `node games/lib/test/mimic-link.test.js` (maths, packets, gamepad merging, the wrapper with
`mimic.js`, the mailbox over HTTP). `python games/lib/test/mimic-link.e2e.py` (Chromium: a game page
and emulated phones connected over WebRTC).

## Online room (play with someone somewhere else)

`games/lib/mimic-room.js` plus the page `games/room/` (cricket uses it; any game can).

- The host's game calls `MimicRoom.host({ game, mirror: [ids], audio: () => ({ ctx, node }) })` and,
  after drawing each frame, `MimicRoom.frame(canvas, x, y, w, h)` with the part of the canvas the
  friend should see. `MimicRoom.inviteUrl()` is the friend's link: the phone link with `/room/`
  instead of `/phone/` (same server, same room, same mailbox) plus `game=`.
- The friend's page joins the room as a viewer (id `v-...`; mimic-link hands those messages to
  mimic-room) and offers to receive one video and one audio track and a `room` data channel. The host
  answers with a canvas stream (at the friend's window shape, at most 1280x720, 30 fps, game sound
  from a MediaStreamDestination on the game's mix). The data channel carries the mirrored DOM
  (`{t:'dom', id, html}`, applied by morphing so CSS transitions still run), the phone link,
  `dims`, clock pings, and the friend's `size` and measured `delay`.
- The friend's phone link carries `&guest=<viewer id>`; the phone sends it in its `hello`, and
  `MimicLink.phones()[].guest` names the viewer. That is how the game knows a seat is far away.
- Picture delay: every streamed frame has a strip of 24 blocks under the picture (sync, 20 bits of
  the host's `performance.now()` in ms, parity). The friend's page reads it back with
  `requestVideoFrameCallback` as each frame is shown, maps it through a ping-measured clock offset,
  and reports the median delay; `MimicRoom.delayFor(guestId)` returns it. Cricket adds it to the
  swing lag of that batter.
- Elements tagged `data-room="host"` or `data-room="guest"` show on one side only (the guest page has
  `body.room-guest`).
- Video starts at 2.5 Mbps (`x-google-start-bitrate` in the offer), up to 4.5 Mbps. Over TURN that is
  roughly 200-350 MB per match.

Test: `python games/lib/test/room.e2e.py` (host page, friend's page and two phone pages, headless).

## Limits

- **TURN only on the site.** The site serves Cloudflare TURN credentials at `/ice`; the dev server
  has STUN only (or the site's TURN with `serve.py --public`). Without TURN, networks that block a
  direct link (client-isolated guest Wi-Fi, strict carrier NAT) cannot connect.
- **Vibration:** Android only. iOS Safari has no vibration API.
- **Sensor rate:** browsers give about 60 Hz (Chrome caps sensors at 60 Hz). The app sends more
  often over Bluetooth, so very fast swings show less detail.
- **Point mode** (the app's air mouse) cannot be done from a browser: a web page cannot move the PC's
  cursor. Browser phones are game controllers only, so they work in Mimic games and other web pages
  that read gamepads, not in desktop games.
- **Volume keys:** a web page cannot read them, so Grip uses a large on-screen HOLD area instead of
  Vol Down.
- iPhone: no fullscreen or orientation lock for web pages. The player turns the phone sideways for Pad.
