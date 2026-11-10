# Build your own game for Mimic

Every game in `games/` reads the phone through one small script, [`games/lib/mimic.js`](../games/lib/mimic.js).
It needs no install, no build step and no network: the phone is a Bluetooth gamepad, and the browser's
Gamepad API already sees it. This page gets a working game on screen in a few minutes.

## How the phone looks to a browser

In **Wand** (and **Grip**, while a game is open) the phone is a gamepad with 12 buttons and 6 axes:
orientation as a quaternion and acceleration. `mimic.js` turns that into values you can use directly,
in three.js world coordinates (x right, y up, z toward the player). With no phone connected, the mouse
stands in, so you can build and test without one.

In **Pad** mode the phone is an ordinary gamepad (sticks, ABXY, shoulders, D-pad): read it with
`navigator.getGamepads()` like any controller. In **Point** mode it is a mouse.

## A complete game in one file

Create `games/swing/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Swing Meter</title>
<style>
  html, body { margin: 0; height: 100%; background: #101216; color: #e8eaee; font: 16px system-ui, sans-serif; }
  canvas { display: block; width: 100vw; height: 100vh; }
  #hud { position: fixed; left: 16px; top: 12px; }
</style>
</head>
<body>
<div id="hud">Point the phone (Wand mode) at the screen and swing. A: kick the phone. Center: recentre.</div>
<canvas id="c"></canvas>
<script src="../lib/mimic.js"></script>
<script>
  const mc = new MimicController();   // slot 0: falls back to the mouse when no phone is sending
  const cv = document.getElementById('c'), g = cv.getContext('2d');
  let best = 0, rumbleAsked = false;

  // Rumble needs one click (Chrome shows a device chooser the first time).
  addEventListener('click', () => { if (!rumbleAsked) { rumbleAsked = true; mc.enableRumble(); } });

  function frame() {
    mc.update();                                   // once per frame, before reading anything
    cv.width = innerWidth; cv.height = innerHeight;
    const W = cv.width, H = cv.height;

    // pointer: -1..1 on a virtual screen in front of the player (+y up)
    const x = (mc.pointer.x + 1) / 2 * W, y = (1 - (mc.pointer.y + 1) / 2) * H;
    // angularSpeed: how fast the phone is turning, rad/s; a hard swing is 10+
    best = Math.max(best * 0.995, mc.angularSpeed);

    g.fillStyle = '#7cc4ff';
    g.beginPath(); g.arc(x, y, 10 + mc.angularSpeed * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8eaee';
    g.fillText(`${mc.source}  ${mc.mode}  speed ${mc.angularSpeed.toFixed(1)} rad/s  best ${best.toFixed(1)}`, 16, H - 16);

    if (mc.pressed('a')) mc.rumble(1, 120, 0);     // strength 0..1, ms, pattern 0 = impact
    requestAnimationFrame(frame);
  }
  frame();
</script>
</body>
</html>
```

Run it:

```sh
python tools/serve.py 8765
```

and open http://127.0.0.1:8765/swing/ in Chrome or Edge. Put the phone on **Wand**, point it at the
screen and press **Center** on the phone to set "forward". Click once in the page to allow rumble.

## The API at a glance

Create one controller and call `update()` once per frame:

```js
const mc = new MimicController();          // first phone, with mouse/keyboard fallback
mc.update();
```

| Property / method | What you get |
|---|---|
| `mc.connected`, `mc.source` | Whether a phone is sending; `'phone'`, `'mouse'` or `'none'`. |
| `mc.mode` | `'wand'`, `'grip'`, `'mouse'` (fallback) or `null` (empty slot). |
| `mc.quat` | Orientation `{x, y, z, w}`. Identity = top of the phone pointing into the screen (-Z), screen facing up. Copy it straight onto a three.js object. |
| `mc.forward`, `mc.up` | Unit vectors: where the phone's top points, where its screen faces. |
| `mc.yaw`, `mc.pitch`, `mc.roll` | Radians, for simple games. |
| `mc.pointer` | `{x, y, onScreen}`, -1..1 on a virtual screen ahead of the player. |
| `mc.angularVelocity`, `mc.angularSpeed` | rad/s, world frame. Good for swings and flicks. |
| `mc.accel`, `mc.linearAccel` | m/s², with and without gravity. |
| `mc.arm` | Estimated `shoulder`, `elbow`, `wrist`, `hand` positions (metres from the head) and `handVelocity`, from a simple arm model. Use `mc.setHand('left')` for left-handed players. |
| `mc.isDown(b)`, `mc.pressed(b)`, `mc.released(b)` | Buttons: `a b one two minus plus home up down left right center`. `pressed` is true only on the frame it went down. |
| `mc.toWorld(v)` | Rotate a vector from phone space (forward -Z, face +Y) into the world. |
| `await mc.enableRumble()` | Ask for permission to vibrate the phone (call from a click). |
| `mc.rumble(strength, ms, pattern)` | Vibrate: strength 0..1, up to 255 ms, pattern 0 impact, 1 buzz, 2 rise, 3 double. |

Without a phone: mouse position aims, left button = A, right button = B, Space = A, Enter = B,
C = Center, 1 and 2, arrow keys = D-pad. Quick mouse flicks produce real angular velocity.

### More than one phone

Each phone is its own gamepad. `MimicController.all()` returns a controller for every Mimic phone
present, or create them by slot: `new MimicController({ slot: 1 })`. Only slot 0 falls back to the mouse.

### Menus you can point at

[`games/lib/wandcursor.js`](../games/lib/wandcursor.js) turns the Wand into a menu cursor: point and press A
to click buttons.

```js
const cursor = MimicCursor.create(mc, { visible: () => inMenu, selector: 'button, .btn' });
// each frame, after mc.update():
if (cursor.update()) { /* A clicked something: skip your own A handling this frame */ }
```

### Recording play sessions

Include [`games/lib/recorder.js`](../games/lib/recorder.js) and open the game with `?rec=1` (or press F8)
to save a video plus every controller sample to `recordings/` through `tools/serve.py`. Call
`MimicRec.event('hit', { power: 0.8 })` to mark game events in the log. Recordings stay on your machine.

## Tips from the games in this repo

- Ask the player to press **Center** while pointing at the screen, and offer it again in the pause menu.
  Orientation is relative to that moment.
- Read swings from `angularVelocity`, not from position: the phone measures rotation precisely and
  position only roughly.
- Rumble on impact, briefly. Short, strong kicks feel better than long buzzes.
- Keep pure game logic in plain functions you can test with `node` (see any `games/*/test/`).

To use three.js, load the shared copy with `<script src="../lib/three.min.js"></script>` (r149). The
example loaders (GLTF, RGBE, SkeletonUtils) are in `games/lib/vendor/`; see how `games/bowling` loads them.
