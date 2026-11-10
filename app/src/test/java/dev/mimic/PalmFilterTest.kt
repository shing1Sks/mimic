package dev.mimic

import dev.mimic.input.PalmFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PalmFilterTest {
    private val xdpi = 440f                      // POCO X6 class density
    private fun mm(v: Float) = v / 25.4f * xdpi

    @Test fun fingertipIsNotPalm() = assertFalse(PalmFilter.isPalm(mm(8f), xdpi))

    @Test fun palmIsPalm() = assertTrue(PalmFilter.isPalm(mm(20f), xdpi))

    @Test fun twoContactsOnlyPalmRejected() {
        assertEquals(listOf(0, 2), PalmFilter.fingers(listOf(mm(9f), mm(22f), mm(7f)), xdpi))
    }

    @Test fun unknownSizeCountsAsFinger() {
        // some panels report 0 for touch major
        assertFalse(PalmFilter.isPalm(0f, xdpi))
    }
}
