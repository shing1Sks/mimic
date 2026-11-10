package dev.mimic.hid

/** A vibration request from a game on the laptop. */
data class Rumble(val strength: Int, val ms: Int, val pattern: Int)

/**
 * A control message from a Mimic game, riding on the same 3-byte output report as rumble so no
 * descriptor change (and no Windows re-pair) is needed: [0, 0, 0x80 | tag].
 *   tag  0..3, a number the page gave this phone; echoed back in the motion report (see
 *        [MotionSig]) so a page with several phones knows which WebHID device is which slot.
 * Bit 0x10 used to ask Grip for motion instead of mouse + keys; Grip now always sends motion, so
 * it is ignored. Older app versions read the message as rumble pattern 3 at strength 0 (silent).
 */
data class Control(val tag: Int)

/**
 * Decodes the 3-byte rumble output report the laptop sends to the gamepad (2) or motion
 * controller (3): [strength 0..255, duration ms 0..255, pattern 0..3]. Some host stacks
 * include the report ID as the first byte, some don't; both are accepted. Anything malformed
 * is ignored rather than trusted. A pattern byte with the top bit set is a [Control] instead.
 */
object RumbleCodec {
    fun decode(reportId: Int, data: ByteArray): Rumble? {
        val p = payload(reportId, data) ?: return null
        fun u(i: Int) = p[i].toInt() and 0xFF
        if (u(2) and 0x80 != 0) return null
        return Rumble(u(0), u(1), u(2).coerceAtMost(3))
    }

    fun control(reportId: Int, data: ByteArray): Control? {
        val p = payload(reportId, data) ?: return null
        val c = p[2].toInt() and 0xFF
        if (c and 0x80 == 0) return null
        return Control(c and 0x03)
    }

    /** The control byte for [Control] (what a page sends as the third byte). */
    fun controlByte(c: Control) = 0x80 or (c.tag and 3)

    private fun payload(reportId: Int, data: ByteArray): ByteArray? {
        if (reportId != HidDescriptor.PAD_ID && reportId != HidDescriptor.MOTION_ID) return null
        val p = if (data.size >= 4 && data[0].toInt() == reportId) data.copyOfRange(1, 4) else data
        return if (p.size < 3) null else p
    }
}
