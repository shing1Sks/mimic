package dev.mimic

import dev.mimic.haptics.Feel
import dev.mimic.haptics.HapticCaps
import dev.mimic.haptics.HapticPlan
import dev.mimic.haptics.Prim
import dev.mimic.haptics.plan
import dev.mimic.haptics.planRumble
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HapticPlanTest {
    private val full = HapticCaps(Prim.entries.toSet(), predefined = true, amplitude = true)
    private val predefOnly = HapticCaps(emptySet(), predefined = true, amplitude = true)
    private val bare = HapticCaps(emptySet(), predefined = false, amplitude = true)

    @Test fun clickUsesPrimitiveWhenSupported() {
        val p = plan(Feel.Click, full, 0.8f) as HapticPlan.Composition
        assertEquals(listOf(Triple(Prim.CLICK, 0.8f, 0)), p.steps)
    }

    @Test fun clickFallsBackToPredefined() {
        assertEquals(HapticPlan.Predefined(0), plan(Feel.Click, predefOnly, 1f))
    }

    @Test fun thudFallsBackToHeavyClick() {
        assertEquals(HapticPlan.Predefined(5), plan(Feel.Thud, predefOnly, 1f))
    }

    @Test fun fallsBackToWaveformWithoutPredefined() {
        val w = plan(Feel.Click, bare, 1f) as HapticPlan.Waveform
        assertTrue(w.amps.any { it > 0 })
    }

    @Test fun strengthZeroIsNone() {
        for (f in Feel.entries) assertEquals(HapticPlan.None, plan(f, full, 0f))
    }

    @Test fun scrollNotchIsVeryLight() {
        val p = plan(Feel.Notch, full, 1f) as HapticPlan.Composition
        assertEquals(Prim.TICK, p.steps.single().first)
        assertTrue(p.steps.single().second <= 0.4f)
    }

    @Test fun clickAndThudFeelDifferent() {
        val a = plan(Feel.Click, full, 1f) as HapticPlan.Composition
        val b = plan(Feel.Thud, full, 1f) as HapticPlan.Composition
        assertTrue(a.steps.first().first != b.steps.first().first)
    }

    @Test fun connectUpIsTwoSteps() {
        val p = plan(Feel.ConnectUp, full, 1f) as HapticPlan.Composition
        assertEquals(2, p.steps.size)
        assertTrue(p.steps[1].third > 0)
    }

    @Test fun rumbleScalesWithStrength() {
        val hi = planRumble(255, 60, 0, full, 1f) as HapticPlan.Composition
        val lo = planRumble(64, 60, 0, full, 1f) as HapticPlan.Composition
        assertTrue(hi.steps.first().second > lo.steps.first().second)
    }

    @Test fun rumbleWaveformScalesAndLasts() {
        val hi = planRumble(255, 80, 0, bare, 1f) as HapticPlan.Waveform
        val lo = planRumble(64, 80, 0, bare, 1f) as HapticPlan.Waveform
        assertTrue(hi.amps.max() > lo.amps.max())
        assertTrue(hi.timings.sum() >= 80)
    }

    @Test fun rumbleZeroIsNone() {
        assertEquals(HapticPlan.None, planRumble(0, 60, 0, full, 1f))
        assertEquals(HapticPlan.None, planRumble(200, 60, 0, full, 0f))
    }

    // POCO X6 (HyperOS, measured 2026-11-08): no composition primitives, predefined + amplitude only.
    private val poco = HapticCaps(emptySet(), predefined = true, amplitude = true)

    @Test fun swingRisesOnPhonesWithoutPrimitives() {
        val w = plan(Feel.Swing, poco, 1f) as HapticPlan.Waveform
        assertTrue(w.amps.size >= 3)
        assertTrue(w.amps.last() > w.amps[1])          // rising
    }

    @Test fun rumbleImpactHasSharpAttackThenBody() {
        val w = planRumble(255, 120, 0, poco, 1f) as HapticPlan.Waveform
        val nz = w.amps.filter { it > 0 }
        assertTrue(nz.size >= 2)
        assertTrue(nz.first() > nz.last())             // hit, then a softer tail
        assertTrue(w.timings.sum() >= 120)
    }
}
