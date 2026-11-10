package dev.mimic.input

/**
 * Gesture bits in the motion report that must reach the PC: each stays up for the whole press
 * and at least [MIN_MS], so a Bluetooth stall (the first real Grip recording had stalls of
 * 125 ms to 5.8 s) cannot swallow it the way it swallowed 100 ms pulses. Pure; times in ms.
 */
class HeldBits {
    private val downAt = LongArray(32) { -1L }
    private val held = BooleanArray(32)

    /** The bit goes up now and stays up until [release] (and at least [MIN_MS]). */
    fun press(bit: Int, t: Long) { downAt[bit] = t; held[bit] = true }

    /** The press ended at [t]; the bit drops at max(t, press + [MIN_MS]). */
    fun release(bit: Int, t: Long) { held[bit] = false }

    /** A gesture with no lasting press (a tap resolved, a flick): up for [MIN_MS]. */
    fun pulse(bit: Int, t: Long) { press(bit, t); release(bit, t) }

    /** The bits up at [t]. */
    fun bits(t: Long): Int {
        var out = 0
        for (i in 0 until 32) {
            if (downAt[i] < 0) continue
            if (held[i] || t - downAt[i] < MIN_MS) out = out or (1 shl i) else downAt[i] = -1L
        }
        return out
    }

    fun clear() { downAt.fill(-1L); held.fill(false) }

    companion object { const val MIN_MS = 250L }
}
