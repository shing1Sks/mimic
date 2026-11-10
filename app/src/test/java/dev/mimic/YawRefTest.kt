package dev.mimic

import dev.mimic.motion.YawRef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Recenter (Centre / Vol Up hold): which way is "straight ahead" for the phone's current pose.
 * Android world frame (z up), phone frame x right, y top, z out of the screen; heading is the
 * angle from world +Y, anticlockwise seen from above. The phone's TOP decides; the back (the
 * screen normal) only takes over when the top is near vertical, blended so there is no jump.
 */
class YawRefTest {
    private fun rot(ax: Float, ay: Float, az: Float, deg: Double): FloatArray {
        val h = deg * PI / 360
        val s = sin(h).toFloat()
        return floatArrayOf(ax * s, ay * s, az * s, cos(h).toFloat())
    }
    private fun mul(a: FloatArray, b: FloatArray) = floatArrayOf(
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    )
    private fun chain(vararg q: FloatArray) = q.reduce { acc, r -> mul(acc, r) }
    private fun deg(rad: Float) = rad * 180.0 / PI
    private fun angDiff(a: Double, b: Double): Double { var d = (a - b) % 360.0; if (d > 180) d -= 360; if (d < -180) d += 360; return abs(d) }

    /** Hanging arm, phone in a fist: top down, back facing sideways (rolled 90), arm [tilt] deg forward, all yawed by [yaw]. */
    private fun fist(yaw: Double, tilt: Double) =
        chain(rot(0f, 0f, 1f, yaw), rot(1f, 0f, 0f, tilt), rot(0f, 0f, 1f, 90.0), rot(1f, 0f, 0f, -90.0))
    /** Wand pointing: flat-ish, top toward the screen, yawed. */
    private fun point(yaw: Double, pitch: Double = 0.0) = chain(rot(0f, 0f, 1f, yaw), rot(1f, 0f, 0f, pitch))
    /** Wand upright like a remote: top up, screen toward you (back faces the screen), leaning [lean] deg toward the screen, the top tilted [roll] deg sideways. */
    private fun upright(yaw: Double, lean: Double = 0.0, roll: Double = 0.0) =
        chain(rot(0f, 0f, 1f, yaw), rot(1f, 0f, 0f, 90.0 - lean), rot(0f, 0f, 1f, roll))

    @Test fun wandPointingAtTheScreenIsUnchanged() {
        for (y in listOf(-120.0, -30.0, 0.0, 45.0, 170.0)) for (p in listOf(-40.0, 0.0, 30.0, 60.0))
            assertEquals("yaw $y pitch $p", y, deg(YawRef.heading(point(y, p))), 0.5)
    }

    @Test fun wandUprightUsesTheBackAsBefore() {
        for (y in listOf(-90.0, 0.0, 60.0)) for (lean in listOf(-10.0, 0.0, 8.0))
            assertTrue("yaw $y lean $lean", angDiff(deg(YawRef.heading(upright(y, lean))), y) < 1.0)
    }

    @Test fun hangingFistFollowsTheTopNotTheBack() {
        // the old recenter took the back here: the world turned 90 deg
        for (y in listOf(-50.0, 0.0, 30.0)) for (tilt in listOf(10.0, 14.0, 20.0, 45.0))
            assertTrue("yaw $y tilt $tilt: ${deg(YawRef.heading(fist(y, tilt)))}", angDiff(deg(YawRef.heading(fist(y, tilt))), y) < 3.0)
    }

    @Test fun exactlyVerticalTopFallsBackToTheBack() {
        // top straight down: no top heading at all, the back decides (it faces +X: heading -90; nothing is NaN)
        val h = deg(YawRef.heading(fist(0.0, 0.0)))
        assertTrue("$h", !h.isNaN() && angDiff(h, -90.0) < 1.0)
    }

    @Test fun noJumpAsTheTopApproachesVertical() {
        for (yaw in listOf(0.0, 77.0)) {
            var prev = deg(YawRef.heading(fist(yaw, 0.0)))
            var t = 0.25
            while (t <= 40.0) {
                val h = deg(YawRef.heading(fist(yaw, t)))
                assertTrue("fist tilt $t: $prev -> $h", angDiff(h, prev) < 6.0)
                prev = h; t += 0.25
            }
            prev = deg(YawRef.heading(upright(yaw, 0.0, 0.0)))
            var r = 0.25
            while (r <= 60.0) {
                val h = deg(YawRef.heading(upright(yaw, 0.0, r)))
                assertTrue("upright roll $r: $prev -> $h", angDiff(h, prev) < 6.0)
                prev = h; r += 0.25
            }
        }
    }

    @Test fun referenceTurnsThatDirectionToForward() {
        val q = fist(37.0, 15.0)
        val r = mul(YawRef.of(q), q)
        assertEquals(0.0, deg(YawRef.heading(r)), 0.5)
        // a yaw-only rotation: tilt and roll are untouched
        val ref = YawRef.of(q)
        assertEquals(0f, ref[0], 1e-6f); assertEquals(0f, ref[1], 1e-6f)
        assertEquals(1.0, (ref[2] * ref[2] + ref[3] * ref[3]).toDouble(), 1e-5)
        assertTrue(atan2(ref[2], ref[3]).isFinite())
    }
}
