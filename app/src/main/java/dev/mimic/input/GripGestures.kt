package dev.mimic.input

import dev.mimic.hid.MotionButton
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Grip mode is held in a fist: only the volume keys are under the fingers. So Vol Up does three
 * things by timing (tap = reload, hold = align, double tap = switch weapon) and a quick sideways
 * flick of the phone is a dodge. Vol Down stays the trigger, handled directly. Pure; times in ms.
 *
 * Grip always sends the Wand's motion report; [button] maps each gesture to the Wand button it
 * pulses (the table in docs/controller-contract.md).
 */
class GripGestures {
    enum class Out { RELOAD, ALIGN, SWITCH, DODGE }

    private var pressT = -1L
    private var holdFired = false
    private var consumed = false
    private var pendingTap = false
    private var lastUpT = Long.MIN_VALUE / 2
    private var dodgeReadyAt = 0L
    private var quietUntil = 0L
    private var flickStart = -1L
    private var flickSign = 0f

    /** Any key press jolts the phone: no dodge for a moment after one (Vol Down is handled outside). */
    fun keyActivity(t: Long) { quietUntil = t + KEY_QUIET_MS; flickStart = -1L }

    fun volUp(down: Boolean, t: Long): List<Out> {
        keyActivity(t)
        if (down) {
            if (pendingTap && t - lastUpT < DOUBLE_MS) {
                pendingTap = false; consumed = true; pressT = t; holdFired = true
                return listOf(Out.SWITCH)
            }
            pressT = t; holdFired = false; consumed = false
            return emptyList()
        }
        if (pressT < 0) return emptyList()
        pressT = -1
        if (consumed || holdFired) return emptyList()
        pendingTap = true; lastUpT = t
        return emptyList()
    }

    /** Call regularly (every frame or key event) to resolve holds and single taps. */
    fun tick(t: Long): List<Out> {
        if (pressT >= 0 && !holdFired && t - pressT >= HOLD_MS) { holdFired = true; return listOf(Out.ALIGN) }
        if (pendingTap && t - lastUpT >= DOUBLE_MS) { pendingTap = false; return listOf(Out.RELOAD) }
        return emptyList()
    }

    /**
     * a: linear acceleration (gravity removed) in phone axes; up: gravity direction in phone axes.
     * Sideways = across the barrel (the phone's top, +y) and across gravity, whatever the grip.
     */
    fun motion(a: FloatArray, t: Long, up: FloatArray = floatArrayOf(0f, 0f, 1f)): List<Out> {
        // side = top (0,1,0) x up = (up.z, 0, -up.x)
        var sx = up[2]; var sz = -up[0]
        val n = sqrt(sx * sx + sz * sz)
        if (n < 0.2f) return emptyList()       // top pointing at the sky: no clear sideways
        sx /= n; sz /= n
        val side = a[0] * sx + a[2] * sz
        val total2 = a[0] * a[0] + a[1] * a[1] + a[2] * a[2]
        val rest = sqrt(maxOf(0f, total2 - side * side))
        // a flick is a sustained, mostly sideways shove; a knock (key press, tap, recoil) is one
        // sharp sample or shakes every axis
        val flicking = abs(side) >= FLICK && abs(side) >= DOMINANCE * rest && t >= dodgeReadyAt && t >= quietUntil
        if (!flicking || (flickStart >= 0 && side * flickSign < 0)) { flickStart = -1L; return emptyList() }
        if (flickStart < 0) { flickStart = t; flickSign = side; return emptyList() }
        if (t - flickStart < SUSTAIN_MS) return emptyList()
        flickStart = -1L
        dodgeReadyAt = t + COOLDOWN_MS
        return listOf(Out.DODGE)
    }

    companion object {
        /** Vol Down, held: the Wand's `a`. */
        const val TRIGGER = MotionButton.A

        /** The Wand button a gesture pulses. */
        fun button(o: Out): Int = when (o) {
            Out.RELOAD -> MotionButton.B       // Vol Up tap
            Out.ALIGN -> MotionButton.CENTER   // Vol Up hold, and the on-screen CENTRE
            Out.SWITCH -> MotionButton.ONE     // Vol Up double tap
            Out.DODGE -> MotionButton.TWO      // sideways flick
        }

        const val HOLD_MS = 600L
        const val DOUBLE_MS = 250L
        const val FLICK = 22f          // m/s^2 sideways: a deliberate jerk, not aiming
        const val COOLDOWN_MS = 1000L
        const val SUSTAIN_MS = 30L         // the shove must last this long (2+ sensor samples)
        const val DOMINANCE = 1.5f         // sideways must beat the other axes by this much
        const val KEY_QUIET_MS = 350L
    }
}
