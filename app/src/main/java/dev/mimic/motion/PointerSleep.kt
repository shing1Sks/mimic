package dev.mimic.motion

import kotlin.math.abs

/**
 * Puts the air mouse to sleep when the phone is set down (lying flat and still for
 * [stillMs]) so the pointer never wanders on its own; any real rotation wakes it.
 */
class PointerSleep(val stillMs: Int = 2000) {
    private var stillFor = 0
    var asleep = false; private set

    /** gyroMag rad/s, gravityZ m/s^2 along the screen normal, dtMs since last call. Returns asleep. */
    fun update(gyroMag: Float, gravityZ: Float, dtMs: Int): Boolean {
        if (asleep) {
            if (gyroMag > WAKE) { asleep = false; stillFor = 0 }
            return asleep
        }
        stillFor = if (gyroMag < STILL && abs(gravityZ) > FLAT) stillFor + dtMs else 0
        if (stillFor >= stillMs) asleep = true
        return asleep
    }

    companion object {
        const val STILL = 0.03f   // rad/s: below a resting hand's tremor
        const val WAKE = 0.15f    // rad/s: a deliberate pick-up
        const val FLAT = 9.3f     // m/s^2: within ~18 degrees of flat
    }
}
