package dev.mimic

import dev.mimic.hid.Control
import dev.mimic.hid.MotionSig
import dev.mimic.hid.RumbleCodec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/** Who is speaking (Wand or Grip) and which page slot, hidden in the motion axes' low bits. */
class MotionSigTest {
    private fun b(vararg v: Int) = v.map { it.toByte() }.toByteArray()

    // ---- the page tags each phone through the rumble output report (no descriptor change) ----
    @Test fun controlCarriesTheTagAndIsNotRumble() {
        val c = Control(2)
        val byte = RumbleCodec.controlByte(c)
        assertEquals(0x82, byte)
        assertEquals(c, RumbleCodec.control(3, b(0, 0, byte)))
        assertEquals(c, RumbleCodec.control(3, b(3, 0, 0, byte)))
        assertNull(RumbleCodec.decode(3, b(0, 0, byte)))
        assertEquals("old want-motion bit is ignored", Control(1), RumbleCodec.control(3, b(0, 0, 0x91)))
        assertNull("plain rumble is not control", RumbleCodec.control(3, b(255, 40, 1)))
    }

    @Test fun signatureRoundTripsAndBarelyMovesValues() {
        val axes = intArrayOf(0, -1, 32767, -32767, 1234, -5678)
        for (mode in intArrayOf(MotionSig.WAND, MotionSig.GRIP)) for (tag in 0..3) {
            val s = MotionSig.sign(axes, mode, tag)
            assertEquals(mode to tag, MotionSig.read(s))
            for (i in 0 until 6) {
                assertTrue(abs(s[i] - axes[i]) <= 1)
                assertTrue(s[i] in -32767..32767)
            }
        }
    }

    @Test fun signedAxesAreNeverAllZero() {
        // games treat all-zero axes as "not sending yet"; the neutral report stays unsigned
        for (mode in intArrayOf(MotionSig.WAND, MotionSig.GRIP)) {
            val s = MotionSig.sign(IntArray(6), mode, 0)
            assertFalse(s[0] == 0 && s[1] == 0 && s[2] == 0 && s[5] == 0)
        }
        assertArrayEquals(intArrayOf(1, 0, 0, 1, 0, 0), MotionSig.sign(intArrayOf(2, 0, 0, 0, 0, 0), MotionSig.WAND, 0))
    }
}
