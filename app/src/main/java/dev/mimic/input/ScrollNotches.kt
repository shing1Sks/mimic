package dev.mimic.input

/**
 * Turns a thumb drag into whole wheel notches, like a detented mouse wheel: each notch is
 * one scroll step and one haptic tick. Dragging up (negative screen dy) scrolls up (positive).
 */
class ScrollNotches(val pxPerNotch: Float) {
    private var carry = 0f

    fun drag(dyPx: Float): Int {
        carry += -dyPx / pxPerNotch
        val whole = carry.toInt()           // toward zero, keeps the remainder's sign
        carry -= whole
        return whole
    }

    fun reset() { carry = 0f }
}
