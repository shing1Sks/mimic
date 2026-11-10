package dev.mimic

import dev.mimic.input.DeliberateTap
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Centre button: a real press and release fires; brushes, palms and slide-offs don't. */
class DeliberateTapTest {
    @Test fun pressAndReleaseOnTheButtonFires() {
        val t = DeliberateTap(); t.down(1000, palm = false)
        assertTrue(t.up(1120, inside = true))
    }

    @Test fun aBrushTooQuickToMeanItDoesNothing() {
        val t = DeliberateTap(); t.down(1000, palm = false)
        assertFalse(t.up(1000 + DeliberateTap.MIN_MS - 1, inside = true))
    }

    @Test fun palmNeverFires() {
        val t = DeliberateTap(); t.down(1000, palm = true)
        assertFalse(t.up(1300, inside = true))
    }

    @Test fun slidingOffBeforeLiftingCancels() {
        val t = DeliberateTap(); t.down(1000, palm = false)
        assertFalse(t.up(1300, inside = false))
    }

    @Test fun upWithoutDownDoesNothingAndStateResets() {
        val t = DeliberateTap()
        assertFalse(t.up(500, inside = true))
        t.down(1000, palm = false); assertTrue(t.up(1200, inside = true))
        assertFalse("a second release without a press", t.up(1400, inside = true))
    }

    @Test fun readyOnceHeldLongEnoughWhilePressed() {
        // Grip's CENTRE goes up as soon as the press is a real one and stays up while held
        val t = DeliberateTap()
        assertFalse(t.ready(1000))
        t.down(1000, palm = false)
        assertFalse(t.ready(1000 + DeliberateTap.MIN_MS - 1))
        assertTrue(t.ready(1000 + DeliberateTap.MIN_MS))
        t.cancel(); assertFalse(t.ready(5000))
        t.down(6000, palm = true); assertFalse(t.ready(9000))
    }
}
