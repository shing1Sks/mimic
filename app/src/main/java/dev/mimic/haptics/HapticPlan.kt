package dev.mimic.haptics

/**
 * The vibration language: every interaction has its own feel, so you know what you pressed
 * without looking. Pure logic: picks the best way this phone can play each feel.
 */
enum class Feel { Click, Thud, Release, Notch, StickEngage, StickDirection, StickRim, Swing, ConnectUp, ConnectDown }

/** Android VibrationEffect.Composition primitives (API 30+). */
enum class Prim { CLICK, THUD, TICK, LOW_TICK, QUICK_RISE, QUICK_FALL, SLOW_RISE, SPIN }

data class HapticCaps(val primitives: Set<Prim>, val predefined: Boolean, val amplitude: Boolean)

sealed interface HapticPlan {
    /** steps: primitive, scale 0..1, delay before it in ms. */
    data class Composition(val steps: List<Triple<Prim, Float, Int>>) : HapticPlan
    /** VibrationEffect.EFFECT_* id: CLICK 0, DOUBLE_CLICK 1, TICK 2, HEAVY_CLICK 5. */
    data class Predefined(val effect: Int) : HapticPlan
    data class Waveform(val timings: LongArray, val amps: IntArray) : HapticPlan
    data object None : HapticPlan
}

private const val EFFECT_CLICK = 0
private const val EFFECT_DOUBLE_CLICK = 1
private const val EFFECT_TICK = 2
private const val EFFECT_HEAVY_CLICK = 5

/** One feel, written three ways: preferred primitives, a predefined effect, a raw pulse. */
private class Recipe(
    val steps: List<Triple<Prim, Float, Int>>,
    val alt: Map<Prim, Prim> = emptyMap(),   // substitute primitive if the first choice is missing
    val predefined: Int,
    val pulseMs: Long,
    val pulseAmp: Float,
    /** A shaped pulse (segment ms, amplitude 0..1) that beats the predefined effect when amplitude control exists. */
    val shape: Pair<LongArray, FloatArray>? = null,
)

private val recipes = mapOf(
    Feel.Click to Recipe(listOf(Triple(Prim.CLICK, 1f, 0)), predefined = EFFECT_CLICK, pulseMs = 12, pulseAmp = 1f),
    Feel.Thud to Recipe(listOf(Triple(Prim.THUD, 0.8f, 0)), mapOf(Prim.THUD to Prim.LOW_TICK),
        predefined = EFFECT_HEAVY_CLICK, pulseMs = 25, pulseAmp = 0.7f),
    Feel.Release to Recipe(listOf(Triple(Prim.TICK, 0.3f, 0)), predefined = EFFECT_TICK, pulseMs = 6, pulseAmp = 0.3f),
    Feel.Notch to Recipe(listOf(Triple(Prim.TICK, 0.3f, 0)), predefined = EFFECT_TICK, pulseMs = 5, pulseAmp = 0.3f),
    Feel.StickEngage to Recipe(listOf(Triple(Prim.TICK, 0.3f, 0)), predefined = EFFECT_TICK, pulseMs = 6, pulseAmp = 0.3f),
    Feel.StickDirection to Recipe(listOf(Triple(Prim.LOW_TICK, 0.5f, 0)), mapOf(Prim.LOW_TICK to Prim.TICK),
        predefined = EFFECT_TICK, pulseMs = 6, pulseAmp = 0.4f),
    Feel.StickRim to Recipe(listOf(Triple(Prim.CLICK, 0.8f, 0)), predefined = EFFECT_CLICK, pulseMs = 14, pulseAmp = 0.8f),
    Feel.Swing to Recipe(listOf(Triple(Prim.QUICK_RISE, 0.6f, 0)), mapOf(Prim.QUICK_RISE to Prim.CLICK),
        predefined = EFFECT_CLICK, pulseMs = 30, pulseAmp = 0.5f,
        shape = longArrayOf(12, 12, 12) to floatArrayOf(0.25f, 0.55f, 0.9f)),
    Feel.ConnectUp to Recipe(listOf(Triple(Prim.TICK, 0.5f, 0), Triple(Prim.CLICK, 0.9f, 60)),
        predefined = EFFECT_DOUBLE_CLICK, pulseMs = 15, pulseAmp = 0.8f),
    Feel.ConnectDown to Recipe(listOf(Triple(Prim.QUICK_FALL, 0.7f, 0)), mapOf(Prim.QUICK_FALL to Prim.THUD),
        predefined = EFFECT_HEAVY_CLICK, pulseMs = 30, pulseAmp = 0.6f,
        shape = longArrayOf(20, 20, 30) to floatArrayOf(0.8f, 0.45f, 0.2f)),
)

fun plan(feel: Feel, caps: HapticCaps, strength: Float): HapticPlan {
    val s = strength.coerceIn(0f, 1f)
    if (s <= 0f) return HapticPlan.None
    val r = recipes.getValue(feel)
    val steps = r.steps.map { (prim, scale, delay) ->
        val use = when {
            prim in caps.primitives -> prim
            r.alt[prim]?.let { it in caps.primitives } == true -> r.alt.getValue(prim)
            else -> null
        }
        use?.let { Triple(it, (scale * s).coerceIn(0f, 1f), delay) }
    }
    if (steps.all { it != null }) return HapticPlan.Composition(steps.filterNotNull())
    if (caps.amplitude) r.shape?.let { (ms, amps) -> return shaped(ms, FloatArray(amps.size) { amps[it] * s }) }
    if (caps.predefined) return HapticPlan.Predefined(r.predefined)
    return pulse(r.pulseMs, r.pulseAmp * s, caps)
}

/**
 * Game rumble ("the kick"): [strength] 0..255 and [ms] from the game, scaled by the user's
 * haptic strength. Pattern 0 = impact (a sharp hit with body), 1 = buzz, 2 = rise, 3 = double.
 */
fun planRumble(strength: Int, ms: Int, pattern: Int, caps: HapticCaps, userStrength: Float): HapticPlan {
    val x = (strength.coerceIn(0, 255) / 255f) * userStrength.coerceIn(0f, 1f)
    if (x <= 0f) return HapticPlan.None
    val len = ms.coerceIn(10, 255)
    val prims = when (pattern) {
        1 -> listOf(Triple(Prim.LOW_TICK, x, 0), Triple(Prim.LOW_TICK, x, len / 2))
        2 -> listOf(Triple(Prim.QUICK_RISE, x, 0))
        3 -> listOf(Triple(Prim.CLICK, x, 0), Triple(Prim.CLICK, x, 70))
        else -> listOf(Triple(Prim.THUD, x, 0), Triple(Prim.CLICK, x, 0))
    }
    if (prims.all { it.first in caps.primitives }) return HapticPlan.Composition(prims)
    if (!caps.amplitude) return pulse(len.toLong(), x, caps)
    val l = len.toLong()
    return when (pattern) {
        1 -> shaped(longArrayOf(l), floatArrayOf(0.6f * x))
        2 -> shaped(longArrayOf(l / 3, l / 3, l - 2 * (l / 3)), floatArrayOf(0.3f * x, 0.6f * x, x))
        3 -> shaped(longArrayOf(30, 40, 30), floatArrayOf(x, 0f, x))
        // Impact: a sharp full-strength hit, then a softer body so it feels like mass, not a buzz.
        else -> shaped(longArrayOf(18, (l - 18).coerceAtLeast(10)), floatArrayOf(x, 0.4f * x))
    }
}

/** Segments as a waveform, with a leading zero-length "off" so it starts immediately. */
private fun shaped(ms: LongArray, amps: FloatArray): HapticPlan.Waveform = HapticPlan.Waveform(
    longArrayOf(0) + ms,
    intArrayOf(0) + IntArray(amps.size) { i -> if (amps[i] <= 0f) 0 else (amps[i].coerceIn(0f, 1f) * 255).toInt().coerceAtLeast(1) },
)

private fun pulse(ms: Long, amp: Float, caps: HapticCaps): HapticPlan {
    val a = if (caps.amplitude) (amp.coerceIn(0f, 1f) * 255).toInt().coerceAtLeast(1) else 255
    return HapticPlan.Waveform(longArrayOf(0, ms), intArrayOf(0, a))
}
