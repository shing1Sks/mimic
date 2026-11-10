package dev.mimic.hid

/**
 * The HID report descriptor is how a device tells the computer "here is what I am".
 * We describe two devices in one: a mouse (report 1) and a gamepad (report 2), so the
 * laptop pairs once and every mode works.
 */
object HidDescriptor {
    const val MOUSE_ID = 1
    const val PAD_ID = 2
    const val MOTION_ID = 3
    const val KEYBOARD_ID = 4

    val bytes: ByteArray = intArrayOf(
        // ---- Mouse (report 1): 5 buttons, 16-bit relative X/Y, wheel, horizontal pan ----
        0x05, 0x01,        // Usage Page (Generic Desktop)
        0x09, 0x02,        // Usage (Mouse)
        0xA1, 0x01,        // Collection (Application)
        0x85, MOUSE_ID,    //   Report ID
        0x09, 0x01,        //   Usage (Pointer)
        0xA1, 0x00,        //   Collection (Physical)
        0x05, 0x09,        //     Usage Page (Button)
        0x19, 0x01, 0x29, 0x05,
        0x15, 0x00, 0x25, 0x01,
        0x95, 0x05, 0x75, 0x01,
        0x81, 0x02,        //     Input (Data,Var,Abs) — 5 button bits
        0x95, 0x01, 0x75, 0x03,
        0x81, 0x03,        //     Input (Const) — 3 bits padding
        0x05, 0x01,        //     Usage Page (Generic Desktop)
        0x09, 0x30, 0x09, 0x31, // X, Y
        0x16, 0x01, 0x80,  //     Logical Min (-32767)
        0x26, 0xFF, 0x7F,  //     Logical Max (32767)
        0x75, 0x10, 0x95, 0x02,
        0x81, 0x06,        //     Input (Data,Var,Rel)
        0x09, 0x38,        //     Usage (Wheel)
        0x15, 0x81, 0x25, 0x7F,
        0x75, 0x08, 0x95, 0x01,
        0x81, 0x06,
        0x05, 0x0C,        //     Usage Page (Consumer)
        0x0A, 0x38, 0x02,  //     Usage (AC Pan)
        0x15, 0x81, 0x25, 0x7F,
        0x75, 0x08, 0x95, 0x01,
        0x81, 0x06,
        0xC0,              //   End Collection
        0xC0,              // End Collection

        // ---- Gamepad (report 2): 16 buttons, hat, 4 stick axes, 2 triggers ----
        0x05, 0x01,        // Usage Page (Generic Desktop)
        0x09, 0x05,        // Usage (Game Pad)
        0xA1, 0x01,        // Collection (Application)
        0x85, PAD_ID,      //   Report ID
        0x05, 0x09,        //   Usage Page (Button)
        0x19, 0x01, 0x29, 0x10,
        0x15, 0x00, 0x25, 0x01,
        0x75, 0x01, 0x95, 0x10,
        0x81, 0x02,        //   Input — 16 buttons
        0x05, 0x01,        //   Usage Page (Generic Desktop)
        0x09, 0x39,        //   Usage (Hat switch)
        0x15, 0x00, 0x25, 0x07,
        0x35, 0x00, 0x46, 0x3B, 0x01, // Physical 0..315
        0x65, 0x14,        //   Unit (degrees)
        0x75, 0x04, 0x95, 0x01,
        0x81, 0x42,        //   Input (Data,Var,Abs,Null) — 8 = centred
        0x65, 0x00,        //   Unit (none)
        0x35, 0x00, 0x45, 0x00, // reset physical range so axes use logical
        0x75, 0x04, 0x95, 0x01,
        0x81, 0x03,        //   Input (Const) — 4 bits padding
        0x09, 0x30, 0x09, 0x31, // X, Y   (left stick)
        0x09, 0x32, 0x09, 0x35, // Z, Rz  (right stick)
        0x09, 0x33, 0x09, 0x34, // Rx, Ry (L2, R2 analog)
        0x15, 0x00, 0x26, 0xFF, 0x00,
        0x75, 0x08, 0x95, 0x06,
        0x81, 0x02,        //   Input — 6 axes, 0..255
        // Output: rumble from the laptop, [strength 0..255, duration ms 0..255, pattern 0..3]
        0x06, 0x00, 0xFF,  //   Usage Page (Vendor 0xFF00)
        0x09, 0x01,        //   Usage (vendor 1)
        0x15, 0x00, 0x26, 0xFF, 0x00,
        0x75, 0x08, 0x95, 0x03,
        0x91, 0x02,        //   Output (Data,Var,Abs)
        0xC0,              // End Collection

        // ---- Motion controller (report 3): 12 buttons, 6 signed 16-bit axes ----
        // A separate device to Windows and browsers. Axes carry the phone's orientation and
        // acceleration, see motionReport(). Raw-ish data, like a real motion controller:
        // every game decides what a swing means.
        0x05, 0x01,        // Usage Page (Generic Desktop)
        0x09, 0x04,        // Usage (Joystick)
        0xA1, 0x01,        // Collection (Application)
        0x85, MOTION_ID,   //   Report ID
        0x05, 0x09,        //   Usage Page (Button)
        0x19, 0x01, 0x29, 0x0C,
        0x15, 0x00, 0x25, 0x01,
        0x75, 0x01, 0x95, 0x0C,
        0x81, 0x02,        //   Input — 12 buttons
        0x75, 0x01, 0x95, 0x04,
        0x81, 0x03,        //   Input (Const) — 4 bits padding
        0x05, 0x01,        //   Usage Page (Generic Desktop)
        0x09, 0x30, 0x09, 0x31, 0x09, 0x32, // X, Y, Z    orientation quaternion x, y, z
        0x09, 0x33, 0x09, 0x34, 0x09, 0x35, // Rx, Ry, Rz acceleration x, y, z
        0x16, 0x01, 0x80,  //   Logical Min (-32767)
        0x26, 0xFF, 0x7F,  //   Logical Max (32767)
        0x75, 0x10, 0x95, 0x06,
        0x81, 0x02,        //   Input — 6 axes
        // Output: rumble from the laptop, [strength 0..255, duration ms 0..255, pattern 0..3]
        0x06, 0x00, 0xFF,  //   Usage Page (Vendor 0xFF00)
        0x09, 0x01,        //   Usage (vendor 1)
        0x15, 0x00, 0x26, 0xFF, 0x00,
        0x75, 0x08, 0x95, 0x03,
        0x91, 0x02,        //   Output (Data,Var,Abs)
        0xC0,              // End Collection

        // ---- Keyboard (report 4): modifiers, reserved, 6 keys (unused for now; kept so pairings stay valid) ----
        0x05, 0x01,        // Usage Page (Generic Desktop)
        0x09, 0x06,        // Usage (Keyboard)
        0xA1, 0x01,        // Collection (Application)
        0x85, KEYBOARD_ID, //   Report ID
        0x05, 0x07,        //   Usage Page (Keyboard/Keypad)
        0x19, 0xE0, 0x29, 0xE7,
        0x15, 0x00, 0x25, 0x01,
        0x75, 0x01, 0x95, 0x08,
        0x81, 0x02,        //   Input — 8 modifier bits
        0x75, 0x08, 0x95, 0x01,
        0x81, 0x03,        //   Input (Const) — reserved byte
        0x05, 0x07,
        0x19, 0x00, 0x29, 0x65,
        0x15, 0x00, 0x25, 0x65,
        0x75, 0x08, 0x95, 0x06,
        0x81, 0x00,        //   Input (Data,Array) — up to 6 keys
        0xC0,              // End Collection
    ).map { it.toByte() }.toByteArray()

    /**
     * Fingerprint of [bytes]. Windows caches a device's descriptor at pairing time, so after it
     * changes (a new collection, like the keyboard) the laptop must forget Mimic and pair again.
     */
    val version: Int get() = bytes.contentHashCode().let { if (it == 0) 1 else it }

    fun mouseReport(buttons: Int, dx: Int, dy: Int, wheel: Int, pan: Int) = byteArrayOf(
        (buttons and 0x1F).toByte(),
        (dx and 0xFF).toByte(), (dx shr 8 and 0xFF).toByte(),
        (dy and 0xFF).toByte(), (dy shr 8 and 0xFF).toByte(),
        wheel.toByte(), pan.toByte(),
    )

    /** [modifiers, reserved, key x6]; extra keys beyond six are dropped. */
    fun keyboardReport(mods: Int, keys: List<Int>): ByteArray {
        val b = ByteArray(8)
        b[0] = (mods and 0xFF).toByte()
        keys.take(6).forEachIndexed { i, k -> b[2 + i] = k.toByte() }
        return b
    }

    fun padReport(p: PadState) = byteArrayOf(
        (p.buttons and 0xFF).toByte(), (p.buttons shr 8 and 0xFF).toByte(),
        (p.hat and 0x0F).toByte(),
        p.lx.toByte(), p.ly.toByte(), p.rx.toByte(), p.ry.toByte(),
        p.lt.toByte(), p.rt.toByte(),
    )
}

/** Motion report: [buttons] bits 0..11, [axes] six values in -32767..32767. */
fun motionReport(buttons: Int, axes: IntArray): ByteArray {
    val b = ByteArray(2 + 12)
    b[0] = (buttons and 0xFF).toByte(); b[1] = (buttons shr 8 and 0x0F).toByte()
    for (i in 0 until 6) {
        val v = axes[i].coerceIn(-32767, 32767)
        b[2 + 2 * i] = (v and 0xFF).toByte(); b[3 + 2 * i] = (v shr 8 and 0xFF).toByte()
    }
    return b
}

/**
 * Which controller is speaking, hidden in the motion report without changing the descriptor:
 * the lowest bit of each axis (1/32767 of full scale, far below sensor noise) carries
 *   axes 0..3  a 4-bit mode code: [WAND] or [GRIP]
 *   axes 4..5  the 2-bit tag the page last gave this phone (see [Control]), 0 until then
 * A browser rebuilds each axis as round(value * 32767) and reads the bits back (games/lib/mimic.js).
 * An older app's noise matches a code on 1 frame in 8, so the page asks for several in a row.
 */
object MotionSig {
    const val WAND = 0x9   // axes 0..3 parity: odd, even, even, odd
    const val GRIP = 0x6   // even, odd, odd, even

    /** [axes] with their low bits set to [mode] and [tag]; values move by at most 1, toward zero. */
    fun sign(axes: IntArray, mode: Int, tag: Int): IntArray {
        val bits = (mode and 0xF) or ((tag and 3) shl 4)
        return IntArray(6) { i ->
            val v = axes[i].coerceIn(-32767, 32767)
            val want = bits shr i and 1
            if (v and 1 == want) v else if (v > 0) v - 1 else v + 1
        }
    }

    /** Inverse of [sign]: (mode code, tag). */
    fun read(axes: IntArray): Pair<Int, Int> {
        var bits = 0
        for (i in 0 until 6) bits = bits or ((axes[i] and 1) shl i)
        return (bits and 0xF) to (bits shr 4 and 3)
    }
}

/** Button bit positions in the motion report (button N in Windows/browsers = bit N-1). */
object MotionButton {
    const val A = 0; const val B = 1; const val ONE = 2; const val TWO = 3
    const val MINUS = 4; const val PLUS = 5; const val HOME = 6
    const val UP = 7; const val DOWN = 8; const val LEFT = 9; const val RIGHT = 10
    const val CENTER = 11
}

/** Gamepad state. Axes 0..255 with 128 centre; hat 0..7 clockwise from up, 8 = none. */
data class PadState(
    val buttons: Int = 0,
    val hat: Int = 8,
    val lx: Int = 128, val ly: Int = 128,
    val rx: Int = 128, val ry: Int = 128,
    val lt: Int = 0, val rt: Int = 0,
)

/** Button bit positions in the gamepad report (button N in Windows = bit N-1). */
object PadButton {
    const val A = 0; const val B = 1; const val X = 2; const val Y = 3
    const val L1 = 4; const val R1 = 5; const val L2 = 6; const val R2 = 7
    const val SELECT = 8; const val START = 9; const val L3 = 10; const val R3 = 11
    const val HOME = 12
}
