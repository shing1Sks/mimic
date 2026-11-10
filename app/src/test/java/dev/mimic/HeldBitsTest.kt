package dev.mimic

import dev.mimic.hid.MotionButton
import dev.mimic.input.HeldBits
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Grip's gesture bits (centre, b, one, two) stay up for the whole press and at least
 * [HeldBits.MIN_MS]: a Bluetooth stall of 125 ms+ (seen in the first real recording) must not
 * swallow a 100 ms pulse.
 */
class HeldBitsTest {
    private val C = 1 shl MotionButton.CENTER
    private val B = 1 shl MotionButton.B

    @Test fun minimumIs250ms() = assertEquals(250L, HeldBits.MIN_MS)

    @Test fun aPulseLastsTheMinimum() {
        val h = HeldBits()
        h.pulse(MotionButton.B, 1000)
        assertEquals(B, h.bits(1000))
        assertEquals(B, h.bits(1249))
        assertEquals(0, h.bits(1250))
    }

    @Test fun aLongPressHoldsUntilReleased() {
        val h = HeldBits()
        h.press(MotionButton.CENTER, 0)
        assertEquals(C, h.bits(200))
        assertEquals(C, h.bits(4000))          // still held: still up, however long
        h.release(MotionButton.CENTER, 4000)
        assertEquals(0, h.bits(4000))
    }

    @Test fun aShortPressIsStretchedToTheMinimum() {
        val h = HeldBits()
        h.press(MotionButton.CENTER, 0)
        h.release(MotionButton.CENTER, 80)
        assertEquals(C, h.bits(100))
        assertEquals(C, h.bits(249))
        assertEquals(0, h.bits(250))
    }

    @Test fun bitsAreIndependent() {
        val h = HeldBits()
        h.press(MotionButton.CENTER, 0)
        h.pulse(MotionButton.B, 100)
        assertEquals(C or B, h.bits(300))
        assertEquals(C, h.bits(350))
        h.release(MotionButton.CENTER, 500)
        assertEquals(0, h.bits(500))
    }

    @Test fun releasingAnUnheldBitDoesNothing() {
        val h = HeldBits()
        h.release(MotionButton.CENTER, 10)
        assertEquals(0, h.bits(10))
    }

    @Test fun aRepressRestartsTheMinimum() {
        val h = HeldBits()
        h.pulse(MotionButton.B, 0)
        h.pulse(MotionButton.B, 200)
        assertEquals(B, h.bits(400))
        assertEquals(0, h.bits(450))
    }

    @Test fun clearDropsEverything() {
        val h = HeldBits()
        h.press(MotionButton.CENTER, 0); h.pulse(MotionButton.B, 0)
        h.clear()
        assertEquals(0, h.bits(1))
    }
}
