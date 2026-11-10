package dev.mimic.motion

import kotlin.math.abs

/**
 * Tapping the back of the phone with a finger makes a sharp, tiny jolt along the screen normal
 * (accelerometer z) while the phone barely rotates. A swing also changes acceleration but
 * spins the phone fast, so taps are only accepted while the gyro is calm. Experimental: off by
 * default (Settings > Wand), kept only if it proves reliable in the user's hands.
 */
class BackTap(val threshold: Float = 2.5f, val maxGyro: Float = 3f, val refractoryMs: Int = 250) {
    private var baseline = Float.NaN
    private var lastTapNs = Long.MIN_VALUE / 2

    /** az m/s^2, gyroMag rad/s, sample time ns. True on the sample where a tap is detected. */
    fun update(az: Float, gyroMag: Float, tNs: Long): Boolean {
        if (baseline.isNaN()) { baseline = az; return false }
        val hp = az - baseline
        baseline += (az - baseline) * 0.05f      // ~50 ms at 400 Hz: follows tilt, not jolts
        if (abs(hp) <= threshold || gyroMag >= maxGyro) return false
        if (tNs - lastTapNs < refractoryMs * 1_000_000L) return false
        lastTapNs = tNs
        return true
    }
}
