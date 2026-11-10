package dev.mimic.input

/**
 * Whether a control may take a finger that just touched down. Touch events reaching a control
 * carry every pointer on the screen, so a control must only take a finger that lands inside its
 * own bounds, isn't a palm, and only while it isn't already held by another finger.
 */
object TouchClaim {
    fun canClaim(owned: Int, x: Float, y: Float, w: Int, h: Int, touchMajorPx: Float, xdpi: Float): Boolean =
        owned == -1 && x >= 0f && y >= 0f && x <= w && y <= h && !PalmFilter.isPalm(touchMajorPx, xdpi)
}
