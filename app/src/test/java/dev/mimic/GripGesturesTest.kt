package dev.mimic

import dev.mimic.hid.MotionButton
import dev.mimic.input.GripGestures
import dev.mimic.input.GripGestures.Out
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Grip mode has only the volume keys under the fingers, so Vol Up does three things by timing:
 * tap = reload, hold = align (this pose becomes straight ahead), double tap = switch weapon.
 * A quick sideways flick of the phone = dodge.
 */
class GripGesturesTest {
    private fun run(vararg ev: Pair<Long, Boolean?>): List<Out> {
        val g = GripGestures(); val out = mutableListOf<Out>()
        for ((t, down) in ev) { if (down == null) out += g.tick(t) else out += g.volUp(down, t) }
        return out
    }

    @Test fun tapIsReloadAfterTheDoubleTapWindow() {
        val o = run(0L to true, 120L to false, 200L to null, 400L to null)
        assertEquals(listOf(Out.RELOAD), o)
    }

    @Test fun holdIsAlign() {
        val o = run(0L to true, 300L to null, 700L to null, 900L to false, 1300L to null)
        assertEquals(listOf(Out.ALIGN), o)
    }

    @Test fun doubleTapIsSwitch() {
        val o = run(0L to true, 100L to false, 220L to true, 300L to false, 700L to null)
        assertEquals(listOf(Out.SWITCH), o)
    }

    @Test fun flickSidewaysIsDodgeOnceThenCoolsDown() {
        val g = GripGestures()
        assertTrue(g.motion(floatArrayOf(2f, 0f, 0f), 0L).isEmpty())          // ordinary aiming
        assertTrue(g.motion(floatArrayOf(28f, 0f, 0f), 100L).isEmpty())       // one sample is not yet a flick
        assertEquals(listOf(Out.DODGE), g.motion(floatArrayOf(30f, 0f, 0f), 135L))
        assertTrue(g.motion(floatArrayOf(-30f, 0f, 0f), 150L).isEmpty())      // the snap back is not a second dodge
        assertTrue(g.motion(floatArrayOf(-30f, 0f, 0f), 190L).isEmpty())
        assertTrue(g.motion(floatArrayOf(30f, 0f, 0f), 1300L).isEmpty())
        assertEquals(listOf(Out.DODGE), g.motion(floatArrayOf(30f, 0f, 0f), 1340L))
    }

    @Test fun aSingleJoltIsNotADodge() {
        // pressing a volume key or tapping the screen knocks the phone for one sample
        val g = GripGestures()
        assertTrue(g.motion(floatArrayOf(40f, 0f, 0f), 0L).isEmpty())
        assertTrue(g.motion(floatArrayOf(1f, 0f, 0f), 20L).isEmpty())
        assertTrue(g.motion(floatArrayOf(40f, 0f, 0f), 40L).isEmpty())
        assertTrue(g.motion(floatArrayOf(0f, 0f, 0f), 60L).isEmpty())
    }

    @Test fun noDodgeRightAfterAKeyPress() {
        val g = GripGestures()
        g.keyActivity(0L)
        assertTrue(g.motion(floatArrayOf(30f, 0f, 0f), 100L).isEmpty())
        assertTrue(g.motion(floatArrayOf(30f, 0f, 0f), 140L).isEmpty())       // still inside the quiet window
        assertTrue(g.motion(floatArrayOf(30f, 0f, 0f), 400L).isEmpty())
        assertEquals(listOf(Out.DODGE), g.motion(floatArrayOf(30f, 0f, 0f), 440L))
    }

    @Test fun aJoltInEveryDirectionIsNotADodge() {
        // a knock shakes all axes; a flick is mostly sideways
        val g = GripGestures()
        assertTrue(g.motion(floatArrayOf(30f, 28f, 0f), 0L).isEmpty())
        assertTrue(g.motion(floatArrayOf(30f, 28f, 0f), 40L).isEmpty())
    }

    @Test fun recoilJabAlongTheBarrelIsNotADodge() {
        // firing kicks the phone along its length (y) and up (z), not sideways
        assertTrue(GripGestures().motion(floatArrayOf(4f, 30f, 25f), 0L).isEmpty())
    }

    @Test fun buttonMapFollowsTheContract() {
        assertEquals(MotionButton.A, GripGestures.TRIGGER)                       // Vol Down, held
        assertEquals(MotionButton.B, GripGestures.button(Out.RELOAD))             // Vol Up tap
        assertEquals(MotionButton.CENTER, GripGestures.button(Out.ALIGN))         // Vol Up hold, CENTRE
        assertEquals(MotionButton.ONE, GripGestures.button(Out.SWITCH))           // Vol Up double tap
        assertEquals(MotionButton.TWO, GripGestures.button(Out.DODGE))            // sideways flick
    }
}
