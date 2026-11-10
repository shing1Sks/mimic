package dev.mimic.input

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

/** Moments worth feeling: each maps to a haptic. */
sealed interface StickEvent {
    data object Engage : StickEvent
    /** 0 = right, counter-clockwise in 45 degree steps (2 = up, 4 = left, 6 = down). */
    data class Direction(val index: Int) : StickEvent
    data object Rim : StickEvent
    data object Neutral : StickEvent
}

/** x, y in -1..1, +y = up. */
data class StickOut(val x: Float, val y: Float, val events: List<StickEvent>)

/**
 * A virtual thumbstick that appears wherever the thumb lands and stays anchored there until
 * release. Past the rim it reads full tilt in that direction; coming back to the anchor is
 * neutral, so the thumb always knows where centre is without looking. [follow] instead drags
 * the anchor along when the thumb goes past the rim.
 */
class AnchoredStick(
    val radiusPx: Float,
    val deadzone: Float = 0.12f,
    var follow: Boolean = false,
    var ticks: Boolean = true,
) {
    var anchorX = 0f; private set
    var anchorY = 0f; private set
    private var engaged = false
    private var atRim = false
    private var dir = -1

    fun down(x: Float, y: Float) {
        anchorX = x; anchorY = y; engaged = false; atRim = false; dir = -1
    }

    fun move(x: Float, y: Float): StickOut {
        var dx = x - anchorX
        var dy = y - anchorY
        var d = hypot(dx, dy)
        if (follow && d > radiusPx) {
            val k = 1 - radiusPx / d
            anchorX += dx * k; anchorY += dy * k
            dx = x - anchorX; dy = y - anchorY; d = radiusPx
        }
        val m = d / radiusPx
        val ev = ArrayList<StickEvent>(2)

        if (!engaged && m > deadzone) {
            engaged = true; ev += StickEvent.Engage
        } else if (engaged && m < deadzone * 0.7f) {
            engaged = false; dir = -1; ev += StickEvent.Neutral
        }
        if (!engaged) { atRim = false; return StickOut(0f, 0f, ev) }

        val sx = dx / max(d, radiusPx)
        val sy = -dy / max(d, radiusPx)     // screen y grows down, stick y grows up

        val idx = ((atan2(sy, sx) / (PI / 4)).roundToInt() + 8) % 8
        if (dir != -1 && idx != dir && ticks) ev += StickEvent.Direction(idx)
        dir = idx

        if (!atRim && m >= 0.97f) { atRim = true; ev += StickEvent.Rim }
        else if (atRim && m < 0.85f) atRim = false

        return StickOut(sx, sy, ev)
    }

    fun up(): StickOut {
        engaged = false; atRim = false; dir = -1
        return StickOut(0f, 0f, emptyList())
    }
}
