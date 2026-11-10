package dev.mimic

import dev.mimic.motion.BackTap
import org.junit.Assert.assertEquals
import org.junit.Test

class BackTapTest {
    private val stepNs = 2_500_000L   // 400 Hz accelerometer

    /** Feeds (az, gyro) samples, returns how many taps fired. */
    private fun feed(b: BackTap, samples: List<Pair<Float, Float>>, t0: Long = 0L): Int {
        var t = t0; var n = 0
        for ((az, g) in samples) { if (b.update(az, g, t)) n++; t += stepNs }
        return n
    }
    private fun still(ms: Int, az: Float = 9.8f, g: Float = 0.02f) = List(ms * 400 / 1000) { az to g }
    private fun spike(peak: Float, g: Float = 0.05f) = listOf(9.8f + peak / 2, 9.8f + peak, 9.8f + peak / 2).map { it to g }

    @Test fun detectsSharpTapWhileStill() {
        assertEquals(1, feed(BackTap(), still(200) + spike(5f) + still(200)))
    }

    @Test fun ignoresSwing() {
        val swing = List(160) { i -> (9.8f + 6f * kotlin.math.sin(i / 10f)) to 8f }
        assertEquals(0, feed(BackTap(), still(100) + swing + still(100)))
    }

    @Test fun ignoresSlowTilt() {
        val tilt = List(400) { i -> (9.8f - 2.8f * i / 400f) to 0.3f }
        assertEquals(0, feed(BackTap(), still(100) + tilt))
    }

    @Test fun refractoryPreventsDoubleCount() {
        assertEquals(1, feed(BackTap(), still(200) + spike(5f) + still(50) + spike(5f) + still(200)))
    }

    @Test fun twoTapsFarApartBothCount() {
        assertEquals(2, feed(BackTap(), still(200) + spike(5f) + still(400) + spike(5f) + still(200)))
    }
}
