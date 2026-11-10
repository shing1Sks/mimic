package dev.mimic

import dev.mimic.input.PadLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PadLayoutTest {
    // landscape phones in dp: 2400x1080 @2.625, POCO X6 2712x1220 @2.75 less a cutout each side, a small one
    private val screens = listOf(914f to 411f, 926f to 443f, 986f to 443f, 760f to 360f)
    private val scales = listOf(0.8f, 1f, 1.15f, 1.3f)

    private fun each(block: (PadLayout) -> Unit) {
        for ((w, h) in screens) for (k in scales) for (m in listOf(false, true)) block(PadLayout(w, h, k, m))
    }

    @Test fun nothingOverlapsAndEverythingIsOnScreen() = each { p ->
        val all = p.all
        for (r in all) assertTrue("$r inside ${p.w}x${p.h}", r.x >= 0 && r.y >= 0 && r.right <= p.w && r.bottom <= p.h)
        for (i in all.indices) for (j in i + 1 until all.size)
            assertFalse("${all[i]} overlaps ${all[j]} at ${p.w}x${p.h} k=${p.scale}", all[i].overlaps(all[j]))
    }

    @Test fun onlyTheExitButtonIsNearTheTopEdge() = each { p ->
        for (r in p.all - p.exit) assertTrue("$r too close to the shade edge", r.y >= PadLayout.TOP)
    }

    @Test fun layoutIsCentred() = each { p ->
        val mid = p.w / 2
        // stick and face diamond sit the same distance from their edges
        val leftEdge = minOf(p.leftZone.x, p.x.x, p.b.x)
        val rightEdge = p.w - maxOf(p.leftZone.right, p.b.right, p.x.right)
        assertEquals("left margin = right margin", leftEdge, rightEdge, 0.5f)
        assertEquals(mid, p.home.cx, 0.01f)
        assertEquals("select/start symmetric", mid - p.select.cx, p.start.cx - mid, 0.01f)
        assertEquals("d-pad and right stick symmetric", kotlin.math.abs(mid - p.dUp.cx), kotlin.math.abs(p.rightZone.cx - mid), 0.01f)
        assertEquals("stick and face buttons at the same height", p.leftZone.cy, (p.y.cy + p.a.cy) / 2, 0.01f)
    }

    @Test fun requestedScaleIsKeptOnARealPhone() {
        assertEquals(1f, PadLayout(914f, 411f, 1f).scale, 0f)
        assertEquals(1.3f, PadLayout(986f, 443f, 1.3f).scale, 0f)
    }

    @Test fun stickZoneIsACircleNotTheWholeBox() {
        assertTrue(PadLayout.inStickZone(100f, 100f, 200f, 200f))   // centre
        assertTrue(PadLayout.inStickZone(100f, 2f, 200f, 200f))     // top rim
        assertFalse(PadLayout.inStickZone(5f, 5f, 200f, 200f))      // box corner
        assertFalse(PadLayout.inStickZone(-10f, 100f, 200f, 200f))  // outside
        assertFalse(PadLayout.inStickZone(1f, 1f, 0f, 0f))
    }

    @Test fun stickZoneIsBoundedNotHalfTheScreen() = each { p ->
        val area = p.leftZone.w * p.leftZone.h
        assertTrue("stick zone ${p.leftZone} is too big", area < p.w * p.h * 0.15f)
        assertTrue("but bigger than the visible base", p.leftZone.w / 2 > p.leftRadius + 20f)
    }

    @Test fun mirroredSwapsThumbSides() {
        val r = PadLayout(914f, 411f); val l = PadLayout(914f, 411f, mirror = true)
        assertTrue(r.leftZone.cx < r.w / 2 && l.leftZone.cx > l.w / 2)
        assertEquals(r.leftZone.x, l.w - l.leftZone.right, 0.01f)
    }
}
