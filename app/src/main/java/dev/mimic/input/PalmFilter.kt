package dev.mimic.input

/**
 * A resting palm or the side of a hand makes a much wider contact than a fingertip. When the
 * phone is held as a controller the palm is often on the glass, so wide contacts are ignored.
 */
object PalmFilter {
    /** Fingertips are ~7-10 mm across; palms and hand edges are 15 mm and up. */
    const val MAX_FINGER_MM = 14f

    fun isPalm(touchMajorPx: Float, xdpi: Float): Boolean =
        touchMajorPx > 0f && xdpi > 0f && touchMajorPx / xdpi * 25.4f > MAX_FINGER_MM

    /** Indices of the contacts that are fingers. */
    fun fingers(touchMajorsPx: List<Float>, xdpi: Float): List<Int> =
        touchMajorsPx.indices.filter { !isPalm(touchMajorsPx[it], xdpi) }
}
