package dev.mimic.haptics

import android.content.Context
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Plays the vibration language on this phone, using the richest method it supports
 * (see [plan] for the fallback order). Call from the input handler, on touch-down,
 * so the vibration lands in the same frame as the press.
 */
class HapticEngine(ctx: Context, private val strength: () -> Float) {
    // VibratorManager only exists from Android 12; touching it on Android 10/11 crashed at launch.
    private val vib: Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        else @Suppress("DEPRECATION") ctx.getSystemService(Vibrator::class.java)

    val caps: HapticCaps = run {
        val v = vib
        if (v == null || !v.hasVibrator()) HapticCaps(emptySet(), predefined = false, amplitude = false)
        else HapticCaps(
            primitives = if (Build.VERSION.SDK_INT >= 30)
                Prim.entries.filter { v.areAllPrimitivesSupported(it.id()) }.toSet() else emptySet(),
            predefined = true,
            amplitude = v.hasAmplitudeControl(),
        )
    }

    fun play(feel: Feel) = run(plan(feel, caps, strength()), media = false)

    /** Game rumble from the laptop (HID output report). */
    fun rumble(strength: Int, ms: Int, pattern: Int) =
        run(planRumble(strength, ms, pattern, caps, this.strength()), media = true)

    /** One line for diagnostics: what this phone's motor can do. */
    fun describe(): String {
        val v = vib ?: return "no vibrator"
        val durations = if (Build.VERSION.SDK_INT >= 31)
            Prim.entries.joinToString(" ") { p -> "${p.name}=${v.getPrimitiveDurations(p.id()).first()}ms" } else "n/a"
        val res = if (Build.VERSION.SDK_INT >= 34) " resonantHz=${v.resonantFrequency}" else ""
        return "primitives=${caps.primitives.joinToString(",")} amplitude=${caps.amplitude}$res durations: $durations"
    }

    private fun run(p: HapticPlan, media: Boolean) {
        val v = vib ?: return
        val effect = when (p) {
            HapticPlan.None -> return
            is HapticPlan.Predefined -> VibrationEffect.createPredefined(p.effect)
            is HapticPlan.Waveform -> VibrationEffect.createWaveform(p.timings, p.amps, -1)
            is HapticPlan.Composition -> {
                if (Build.VERSION.SDK_INT < 30) return
                val c = VibrationEffect.startComposition()
                for ((prim, scale, delay) in p.steps) c.addPrimitive(prim.id(), scale, delay)
                c.compose()
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            val usage = if (media) VibrationAttributes.USAGE_MEDIA else VibrationAttributes.USAGE_TOUCH
            v.vibrate(effect, VibrationAttributes.createForUsage(usage))
        } else v.vibrate(effect)
    }

    private fun Prim.id(): Int = when (this) {
        Prim.CLICK -> VibrationEffect.Composition.PRIMITIVE_CLICK
        Prim.THUD -> VibrationEffect.Composition.PRIMITIVE_THUD
        Prim.TICK -> VibrationEffect.Composition.PRIMITIVE_TICK
        Prim.LOW_TICK -> VibrationEffect.Composition.PRIMITIVE_LOW_TICK
        Prim.QUICK_RISE -> VibrationEffect.Composition.PRIMITIVE_QUICK_RISE
        Prim.QUICK_FALL -> VibrationEffect.Composition.PRIMITIVE_QUICK_FALL
        Prim.SLOW_RISE -> VibrationEffect.Composition.PRIMITIVE_SLOW_RISE
        Prim.SPIN -> VibrationEffect.Composition.PRIMITIVE_SPIN
    }
}
