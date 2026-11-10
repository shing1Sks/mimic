package dev.mimic

import dev.mimic.hid.HidDescriptor
import dev.mimic.hid.KeySet
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyboardTest {
    private fun bytes(vararg v: Int) = v.map { it.toByte() }.toByteArray()

    @Test fun reportIsModifiersReservedThenSixKeys() {
        assertArrayEquals(bytes(0, 0, 0x15, 0, 0, 0, 0, 0), HidDescriptor.keyboardReport(0, listOf(0x15)))
        assertArrayEquals(bytes(1, 0, 0x2C, 0x06, 0, 0, 0, 0), HidDescriptor.keyboardReport(1, listOf(0x2C, 0x06)))
    }

    @Test fun moreThanSixKeysKeepsTheFirstSix() {
        val r = HidDescriptor.keyboardReport(0, (4..12).toList())
        assertEquals(8, r.size); assertEquals(9.toByte(), r[7])
    }

    @Test fun descriptorDeclaresKeyboardReport4() {
        val d = HidDescriptor.bytes.map { it.toInt() and 0xFF }
        val i = (0 until d.size - 3).firstOrNull { d[it] == 0x09 && d[it + 1] == 0x06 && d[it + 2] == 0xA1 }
        assertTrue("keyboard usage present", i != null)
        assertEquals(4, HidDescriptor.KEYBOARD_ID)
        assertTrue("report id 4 follows", d.subList(i!!, i + 8).windowed(2).any { it == listOf(0x85, 4) })
    }

    @Test fun keySetTracksPressedKeysAndModifiers() {
        val k = KeySet()
        assertTrue(k.down(0x15))
        assertTrue(!k.down(0x15)) // already down: no change
        k.down(KeySet.LEFT_CTRL)
        assertArrayEquals(bytes(1, 0, 0x15, 0, 0, 0, 0, 0), k.report())
        assertTrue(k.up(0x15))
        k.up(KeySet.LEFT_CTRL)
        assertArrayEquals(bytes(0, 0, 0, 0, 0, 0, 0, 0), k.report())
        k.down(0x2C); k.clear()
        assertArrayEquals(bytes(0, 0, 0, 0, 0, 0, 0, 0), k.report())
    }

    /**
     * Point's CENTRE can press and lift F9 inside one 8 ms flush (a quick tap fires on lift). The
     * report sent must still contain F9 once, or Windows never sees the key and the tray never
     * centres the cursor.
     */
    @Test fun aTapShorterThanOneFlushStillReachesThePc() {
        val k = KeySet()
        assertTrue(k.down(KeySet.F9))
        assertTrue(k.up(KeySet.F9))                 // lifted before any report went out
        assertArrayEquals(bytes(0, 0, 0x42, 0, 0, 0, 0, 0), k.report())
        assertTrue("the release is still owed", k.owesReport)
        assertArrayEquals(bytes(0, 0, 0, 0, 0, 0, 0, 0), k.report())
        assertFalse(k.owesReport)
    }

    @Test fun aModifierTapShorterThanOneFlushStillReachesThePc() {
        val k = KeySet()
        k.down(KeySet.LEFT_CTRL); k.up(KeySet.LEFT_CTRL)
        assertArrayEquals(bytes(1, 0, 0, 0, 0, 0, 0, 0), k.report())
        assertArrayEquals(bytes(0, 0, 0, 0, 0, 0, 0, 0), k.report())
    }

    @Test fun clearDropsAnOwedTapToo() {
        val k = KeySet()
        k.down(KeySet.F9); k.up(KeySet.F9); k.clear()
        assertArrayEquals(bytes(0, 0, 0, 0, 0, 0, 0, 0), k.report())
        assertFalse(k.owesReport)
    }
}
