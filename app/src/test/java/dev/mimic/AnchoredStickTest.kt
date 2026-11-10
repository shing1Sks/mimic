package dev.mimic

import dev.mimic.input.AnchoredStick
import dev.mimic.input.StickEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AnchoredStickTest {
    private fun stick(follow: Boolean = false, ticks: Boolean = true) =
        AnchoredStick(radiusPx = 75f, deadzone = 0.12f, follow = follow, ticks = ticks)

    @Test fun anchorStaysPutPastRim() {
        val s = stick(); s.down(100f, 100f)
        val o = s.move(400f, 100f)
        assertEquals(1f, o.x, 1e-4f); assertEquals(0f, o.y, 1e-4f)
        assertEquals(100f, s.anchorX, 0f); assertEquals(100f, s.anchorY, 0f)
        assertEquals(1, o.events.count { it == StickEvent.Rim })
    }

    @Test fun rimEventNotRepeatedWhileHeld() {
        val s = stick(); s.down(0f, 0f)
        s.move(200f, 0f)
        val o = s.move(210f, 5f)
        assertTrue(o.events.none { it == StickEvent.Rim })
    }

    @Test fun rimFiresAgainAfterBackingOff() {
        val s = stick(); s.down(0f, 0f)
        s.move(200f, 0f); s.move(20f, 0f)
        assertTrue(s.move(200f, 0f).events.contains(StickEvent.Rim))
    }

    @Test fun returningToAnchorIsNeutral() {
        val s = stick(); s.down(50f, 50f)
        s.move(300f, 300f)
        val o = s.move(50f, 50f)
        assertEquals(0f, o.x, 0f); assertEquals(0f, o.y, 0f)
        assertTrue(o.events.contains(StickEvent.Neutral))
    }

    @Test fun deadzoneEngageOnce() {
        val s = stick(); s.down(0f, 0f)
        assertEquals(0f, s.move(5f, 0f).x, 0f)  // inside deadzone (9 px)
        val a = s.move(30f, 0f)
        assertTrue(a.events.contains(StickEvent.Engage))
        assertTrue(s.move(40f, 0f).events.none { it == StickEvent.Engage })
    }

    @Test fun directionTicksOnlyWhenEnabled() {
        val on = stick(ticks = true); on.down(0f, 0f); on.move(40f, 0f)
        assertTrue(on.move(0f, -40f).events.contains(StickEvent.Direction(2)))  // screen up = stick up = index 2
        val off = stick(ticks = false); off.down(0f, 0f); off.move(40f, 0f)
        assertTrue(off.move(0f, -40f).events.none { it is StickEvent.Direction })
    }

    @Test fun followModeDragsAnchor() {
        val s = stick(follow = true); s.down(100f, 100f)
        s.move(400f, 100f)
        assertEquals(325f, s.anchorX, 1e-3f)
        val back = s.move(325f, 100f)
        assertEquals(0f, back.x, 1e-4f)
    }

    @Test fun screenYDownMapsToStickYDown() {
        val s = stick(); s.down(0f, 0f)
        assertEquals(-1f, s.move(0f, 300f).y, 1e-4f)
    }

    @Test fun upReturnsCentre() {
        val s = stick(); s.down(0f, 0f); s.move(60f, 0f)
        val o = s.up()
        assertEquals(0f, o.x, 0f); assertEquals(0f, o.y, 0f)
    }
}
