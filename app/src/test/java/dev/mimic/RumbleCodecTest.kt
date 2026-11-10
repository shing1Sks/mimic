package dev.mimic

import dev.mimic.hid.HidDescriptor
import dev.mimic.hid.Rumble
import dev.mimic.hid.RumbleCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RumbleCodecTest {
    private fun b(vararg v: Int) = v.map { it.toByte() }.toByteArray()

    @Test fun decodesThreeBytes() {
        assertEquals(Rumble(200, 60, 1), RumbleCodec.decode(3, b(200, 60, 1)))
    }

    @Test fun decodesWithLeadingReportId() {
        assertEquals(Rumble(255, 40, 0), RumbleCodec.decode(3, b(3, 255, 40, 0)))
    }

    @Test fun padReportIdAccepted() {
        assertEquals(Rumble(10, 20, 2), RumbleCodec.decode(2, b(10, 20, 2)))
    }

    @Test fun rejectsShortPayload() {
        assertNull(RumbleCodec.decode(3, b(200, 60)))
        assertNull(RumbleCodec.decode(3, ByteArray(0)))
    }

    @Test fun rejectsUnknownReportId() {
        assertNull(RumbleCodec.decode(1, b(200, 60, 0)))
    }

    @Test fun clampsPatternTo0to3() {
        assertEquals(3, RumbleCodec.decode(3, b(100, 50, 9))!!.pattern)
    }

    @Test fun descriptorDeclaresOutputForPadAndMotion() {
        // Output main item = 0x91 followed by 0x02 (Data,Var,Abs)
        val d = HidDescriptor.bytes
        val outputs = (0 until d.size - 1).count { d[it] == 0x91.toByte() && d[it + 1] == 0x02.toByte() }
        assertEquals(2, outputs)
    }
}
