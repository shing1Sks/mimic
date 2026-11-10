package dev.mimic.motion

import kotlin.math.abs
import kotlin.math.sign

/**
 * Turning the phone aims the right stick, the way motion aiming works on modern handhelds:
 * rotation speed maps to stick deflection (turn faster, look faster), with a small dead zone
 * so a steady hand doesn't drift. Inputs are rates already expressed as yaw (+ = turning left)
 * and pitch (+ = tilting up) for the way the phone is held.
 */
class GyroAim(var sensitivity: Float = 1f) {
    /** Returns right-stick (x, y) in -1..1, +y = up. */
    fun update(yawRate: Float, pitchRate: Float, dt: Float): Pair<Float, Float> =
        axis(-yawRate) to axis(pitchRate)

    private fun axis(rate: Float): Float {
        val m = abs(rate) - DEAD
        if (m <= 0f) return 0f
        return (sign(rate) * m * GAIN * sensitivity).coerceIn(-1f, 1f)
    }

    companion object {
        const val DEAD = 0.03f   // rad/s
        const val GAIN = 0.5f    // 2 rad/s = full deflection
    }
}
