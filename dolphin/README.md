# Mimic in Dolphin

[Dolphin](https://dolphin-emu.org) is a free emulator for Wii and GameCube games. Mimic's **Wand** mode
shows up in Windows as a game controller called "Mimic", so Dolphin can use it as a Wii Remote.

## Set up (Bluetooth, no Wi-Fi needed)
1. Open Mimic on the phone and go to **Wand**.
2. Copy `Mimic Wand.ini` into Dolphin's Wii Remote profile folder:
   - installed Dolphin: `%APPDATA%\Dolphin Emulator\Config\Profiles\Wiimote\`
   - portable Dolphin: `<Dolphin folder>\User\Config\Profiles\Wiimote\`
3. In Dolphin: **Controllers > Wii Remote 1: Emulated Wii Remote > Configure**, pick **Mimic Wand** under
   Profile and press **Load**.
4. Point the phone at the screen and tap **Center** on the phone.

What it maps: all buttons, the pointer (from where the phone points), tilt, and shake/swing (from
acceleration).

**Status:** the profile is a draft written from Dolphin's profile format. It has not yet been loaded
in Dolphin. If the bars in Configure don't move, check that the **Device** dropdown says "Mimic" and
save the profile again from there.

## Optional: true gyro for MotionPlus games (Wi-Fi)
Some games (for example ones that need Wii MotionPlus) want real gyroscope data, which the Bluetooth
link doesn't carry. For those:
1. On the phone, in **Wand**, open **Advanced: Dolphin over Wi-Fi** and note the address.
2. In Dolphin: **Controllers > Alternate Input Sources**, tick **Enable**, and add that address
   (port 26760).
3. In the Wii Remote's **Motion Input** tab, pick the DSU device for the accelerometer and gyroscope.

Games themselves are not included. Legally, use dumps of discs you own.
