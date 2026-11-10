package dev.mimic.input

/**
 * A press that only counts when meant: a finger (not a palm) goes down on the button and lifts
 * again on it, after at least [MIN_MS]. A brush that skims across, a palm resting on the glass,
 * or a finger that slides off before lifting does nothing. Pure; times in ms.
 */
class DeliberateTap {
    private var downAt = -1L

    fun down(t: Long, palm: Boolean) { downAt = if (palm) -1L else t }

    /** True = fire. [inside]: the finger lifted over the button. */
    fun up(t: Long, inside: Boolean): Boolean {
        val ok = downAt >= 0 && inside && t - downAt >= MIN_MS
        downAt = -1L
        return ok
    }

    fun cancel() { downAt = -1L }

    val pressed get() = downAt >= 0

    /** Still pressed and already long enough to count (for an action that lasts the whole press). */
    fun ready(t: Long) = downAt >= 0 && t - downAt >= MIN_MS

    companion object { const val MIN_MS = 60L }
}
