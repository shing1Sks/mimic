package dev.mimic

import dev.mimic.motion.GyroAim
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GyroAimTest {
    @Test fun stillPhoneGivesZero() {
        val (x, y) = GyroAim().update(0f, 0f, 0.01f)
        assertEquals(0f, x, 0f); assertEquals(0f, y, 0f)
    }

    // Pad is held landscape: turning right is rotation about the phone's long axis (gyro X
    // in landscape), tilting the top edge back is about gyro Y. GyroAim takes (yawRate, pitchRate).
    @Test fun turnRightGivesPositiveX() {
        assertTrue(GyroAim().update(-1f, 0f, 0.01f).first > 0f)
    }

    @Test fun tiltUpGivesPositiveY() {
        assertTrue(GyroAim().update(0f, 1f, 0.01f).second > 0f)
    }

    @Test fun clampsToUnit() {
        val (x, y) = GyroAim(sensitivity = 5f).update(-50f, 50f, 0.01f)
        assertEquals(1f, x, 0f); assertEquals(1f, y, 0f)
    }

    @Test fun deadzoneSuppressesTremor() {
        val (x, y) = GyroAim().update(0.02f, -0.02f, 0.01f)
        assertEquals(0f, x, 0f); assertEquals(0f, y, 0f)
    }
}
