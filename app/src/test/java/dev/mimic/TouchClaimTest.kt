package dev.mimic

import dev.mimic.input.TouchClaim
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A control may only take a finger that lands inside it, isn't a palm, and when it's free. */
class TouchClaimTest {
    private val xdpi = 440f
    private fun mm(v: Float) = v / 25.4f * xdpi

    @Test fun fingerInsideFreeZoneIsClaimed() =
        assertTrue(TouchClaim.canClaim(owned = -1, x = 50f, y = 50f, w = 100, h = 100, touchMajorPx = mm(8f), xdpi = xdpi))

    @Test fun fingerOutsideZoneIsNotClaimed() {
        // the review's case: a palm rests on LOOK; the left thumb lands on STICK, outside LOOK
        assertFalse(TouchClaim.canClaim(owned = -1, x = -300f, y = 50f, w = 100, h = 100, touchMajorPx = mm(8f), xdpi = xdpi))
        assertFalse(TouchClaim.canClaim(owned = -1, x = 50f, y = 140f, w = 100, h = 100, touchMajorPx = mm(8f), xdpi = xdpi))
    }

    @Test fun palmIsNeverClaimed() =
        assertFalse(TouchClaim.canClaim(owned = -1, x = 50f, y = 50f, w = 100, h = 100, touchMajorPx = mm(20f), xdpi = xdpi))

    @Test fun busyZoneDoesNotTakeASecondFinger() =
        assertFalse(TouchClaim.canClaim(owned = 3, x = 50f, y = 50f, w = 100, h = 100, touchMajorPx = mm(8f), xdpi = xdpi))
}
