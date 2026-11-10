package dev.mimic

import dev.mimic.motion.PointerSleep
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PointerSleepTest {
    private fun run(s: PointerSleep, ms: Int, gyro: Float, gz: Float): Boolean {
        var asleep = false
        repeat(ms / 10) { asleep = s.update(gyro, gz, 10) }
        return asleep
    }

    @Test fun sleepsAfterTwoSecondsFlatStill() {
        val s = PointerSleep()
        assertFalse(run(s, 1900, 0.005f, 9.8f))
        assertTrue(run(s, 200, 0.005f, 9.8f))
    }

    @Test fun doesNotSleepWhenHeldTilted() {
        assertFalse(run(PointerSleep(), 5000, 0.005f, 7.0f))   // held at an angle, still
    }

    @Test fun handTremorKeepsItAwake() {
        assertFalse(run(PointerSleep(), 5000, 0.06f, 9.8f))
    }

    @Test fun wakesOnRotation() {
        val s = PointerSleep()
        assertTrue(run(s, 2500, 0.005f, 9.8f))
        assertFalse(s.update(0.3f, 9.8f, 10))
    }

    @Test fun smallBumpWhileAsleepDoesNotWake() {
        val s = PointerSleep()
        run(s, 2500, 0.005f, 9.8f)
        assertTrue(s.update(0.1f, 9.8f, 10))
    }
}
