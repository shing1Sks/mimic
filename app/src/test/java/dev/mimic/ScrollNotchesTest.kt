package dev.mimic

import dev.mimic.input.ScrollNotches
import org.junit.Assert.assertEquals
import org.junit.Test

class ScrollNotchesTest {
    @Test fun countsWholeNotchesAndKeepsRemainder() {
        val n = ScrollNotches(pxPerNotch = 20f)
        assertEquals(3, n.drag(-70f))  // finger moves up 3.5 notches -> scroll up 3
        assertEquals(1, n.drag(-10f))  // the remaining half plus this half
    }

    @Test fun reverseDirectionCountsNegative() {
        val n = ScrollNotches(20f)
        assertEquals(-2, n.drag(45f))
    }

    @Test fun resetDropsRemainder() {
        val n = ScrollNotches(20f)
        n.drag(-15f); n.reset()
        assertEquals(0, n.drag(-10f))
    }
}
