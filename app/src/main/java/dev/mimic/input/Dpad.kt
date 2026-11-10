package dev.mimic.input

/**
 * On-screen D-pad: four keys held independently (two at once makes a diagonal), turned into the
 * HID hat value (0 = up, clockwise to 7 = up-left, 8 = centred). Opposite keys cancel.
 */
object Dpad {
    const val UP = 1; const val RIGHT = 2; const val DOWN = 4; const val LEFT = 8

    fun set(held: Int, key: Int, down: Boolean) = if (down) held or key else held and key.inv()

    fun hat(held: Int): Int {
        val y = (if (held and UP != 0) 1 else 0) - (if (held and DOWN != 0) 1 else 0)
        val x = (if (held and RIGHT != 0) 1 else 0) - (if (held and LEFT != 0) 1 else 0)
        return when {
            y == 1 && x == 0 -> 0; y == 1 && x == 1 -> 1; y == 0 && x == 1 -> 2; y == -1 && x == 1 -> 3
            y == -1 && x == 0 -> 4; y == -1 && x == -1 -> 5; y == 0 && x == -1 -> 6; y == 1 && x == -1 -> 7
            else -> 8
        }
    }
}
