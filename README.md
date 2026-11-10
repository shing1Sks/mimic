# Mimic

The controller you left at home.

Mimic turns an Android phone into a **real Bluetooth controller for your PC**: an air mouse, a
gamepad, a motion controller, or a one-hand Grip controller. Pair it once and Windows treats it like
hardware, so it works with **any PC app or game**, not only the games in this repository. No drivers,
no PC software required, no account, and no Wi-Fi needed: everything goes over Bluetooth.

Each mode has its own layout built around how you hold the phone, and its own vibrations, so you can
use it without looking down.

## Quick start

1. **Install the app.** Download the latest `mimic-<version>.apk` from
   [Releases](https://github.com/shing1Sks/mimic/releases/latest) on your phone and open it. Android asks
   you to allow installs from your browser the first time.
   Requires Android 10 or newer with the Bluetooth HID device profile (most phones have it). On Android 12
   and newer, allow the "Nearby devices" permission when asked: that is how Mimic becomes a Bluetooth device.
2. **Pair.** Open Mimic and tap **Pair a new laptop**. On Windows go to
   *Settings > Bluetooth & devices > Add device*, pick the phone, and confirm the code on both screens.
3. **Pick a mode** on the phone and use it. Next time, Mimic reconnects to the last PC by itself.
4. **Optional: the Windows tray helper** (see below) shows a Mimic pointer while the phone is moving
   the cursor.

Mimic checks once a day for a newer release (it reads a small JSON file at
`https://mimic.shing.in/version.json`) and shows an "Update available" card on the home screen. Updates
are downloaded only when you tap it, checked against the published SHA-256, and installed by Android's
own installer.

If an update changes what the phone reports to Windows (the release notes say so), remove the phone in
Windows Bluetooth settings and pair again.

## Modes

| Mode | Hold it | What it is |
|---|---|---|
| **Point** | Flat in one hand, top toward the screen | Air mouse. Turn your wrist to move. Click and right-click pads plus a notched scroll strip under your thumb. The volume keys act as back and forward. CENTRE puts the cursor in the middle of the screen (needs the Windows tray helper). Put the phone down and the pointer sleeps. |
| **Wand** | Upright, like a remote | Motion controller. Sends orientation, acceleration and buttons (A, B, 1, 2, -, +, Home, D-pad, Center). Games can make the phone vibrate on impact. Works as a Wii Remote in [Dolphin](dolphin/README.md). |
| **Pad** | Sideways in both hands | Gamepad. The stick appears where your thumb lands and stays anchored. ABXY in an arc, shoulders along the top edge, a right stick, a D-pad, and optional tilt-to-aim or tilt-to-steer. |
| **Grip** | In your fist, top forward | One-hand motion controller for shooters and swinging games. Point to aim; the volume keys and short flicks do the rest. It always sends the same motion report as the Wand (Mimic games in Chrome or Edge); for the PC's mouse use Point. |

Settings has three themes, left-handed layouts, vibration on/off and strength, pointer speed, pad
layout options and a reset to defaults. Settings > About shows the version, checks for updates, explains
pairing and lists the licences.

## Games

Browser games built for Mimic live in `games/`. They run in Chrome or Edge on the PC and read the phone
over Bluetooth through the browser's Gamepad API. Click once in a game to start the sound, and allow
the "Mimic" device when the browser asks: that lets the game make the phone vibrate.

| Folder | Game | Play with | What it is |
|---|---|---|---|
| `games/tennis` | Sunvolley | Wand or Grip | Tennis where the racket follows your arm. |
| `games/saber` | Cadence Cut | Wand | Slash blocks to music; a 12-level campaign. |
| `games/arena` | Duskwater | Pad | A team shooter in a dockyard at dusk. |
| `games/flight` | Gyrowing | Pad or Wand | Fly a generated landscape or the real world (satellite imagery, real terrain and airports). |
| `games/gladiator` | Iron Ludus | Wand | Sword fights in a colosseum; timing beats spamming. |
| `games/dino` | IRONFERN | Grip | A fixed-stand dinosaur hunt in five missions. |
| `games/bowling` | Emberlane | Wand or Grip | Bowling with a real arm swing. |

`games/controller-test.html` shows everything the phone sends, plus a rumble test.

Run them locally (Python 3, nothing to install):

```sh
python tools/serve.py 8765
```

Then open http://127.0.0.1:8765/ and pick a folder, for example http://127.0.0.1:8765/saber/.
Add `?rec=1` to a game's URL to record a play session (video and controller input) into `recordings/`.

## Build your own game

Everything a game needs is in [`games/lib/mimic.js`](games/lib/mimic.js), a single script with no
dependencies:

```html
<script src="../lib/mimic.js"></script>
<script>
  const mc = new MimicController();
  function frame() {
    mc.update();
    // mc.quat, mc.pointer, mc.angularSpeed, mc.arm.hand, mc.pressed('a'), mc.rumble(1, 120) ...
    requestAnimationFrame(frame);
  }
  frame();
</script>
```

It gives orientation (as a three.js-ready quaternion), a screen pointer, angular velocity, acceleration,
an estimated hand position, buttons with pressed/released edges, rumble, and several phones at once.
Without a phone the mouse stands in. A complete example game and the full API are in
[docs/build-a-game.md](docs/build-a-game.md).

## Windows tray helper (`windows/`)

An optional helper that swaps the Windows cursor to the Mimic pointer while the phone is moving it,
frees the pointer when another program leaves it fenced in, and makes Point's CENTRE button work (the
phone sends F9; the helper moves the cursor to the middle of the screen). It builds with the C# compiler that
ships with Windows:

```powershell
powershell -ExecutionPolicy Bypass -File windows\build.ps1
windows\out\MimicTray.exe
```

The tray menu has Start with Windows, Open games folder and Quit. The normal cursor always comes back,
even if the helper is killed: the next start restores it.

## Build the app from source

You need JDK 17 or newer and the Android SDK (command-line tools are enough; Android Studio is optional).
Point Gradle at the SDK with a `local.properties` file in the repo root (`sdk.dir=/path/to/Android/Sdk`)
or the `ANDROID_HOME` environment variable.

```sh
./gradlew assembleDebug                 # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest             # unit tests
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

On Windows use `gradlew.bat` (or `./gradlew` from Git Bash). Release builds and signing are described in
[docs/releasing.md](docs/releasing.md). A debug build cannot update over a release build (different
signing keys); uninstall one before installing the other.

Game logic tests run with Node: `node games/<game>/test/<name>.test.js`.

## How it works

The phone registers as a Bluetooth HID device (Android's `BluetoothHidDevice` API) with a combined
descriptor: mouse, keyboard keys, a gamepad, and a motion controller whose axes carry orientation and
acceleration. Windows needs no driver for any of them. Game makers: see
[docs/build-a-game.md](docs/build-a-game.md) and [docs/controller-contract.md](docs/controller-contract.md).

## Contributing

Issues and pull requests are welcome. A few conventions:

- Keep pure logic (gestures, filters, scoring, physics) in plain functions with unit tests: Kotlin tests
  in `app/src/test`, game tests in `games/<game>/test`.
- Tune feel from real play: record a session with `?rec=1` and look at the data before changing constants.
- Every third-party asset needs a free licence that allows redistribution (CC0, CC-BY, MIT or similar).
  Add it to the game's credits file and to [THIRD_PARTY.md](THIRD_PARTY.md) in the same change.
- Run `./gradlew testDebugUnitTest` and the game tests you touched before opening a pull request.

## Licence

The code is released under the [MIT licence](LICENSE). Bundled game assets (models, textures, sounds,
music) are by their authors under CC0, CC-BY 3.0 or CC-BY 4.0; see [THIRD_PARTY.md](THIRD_PARTY.md) for
every file, its author and its licence.
