package dev.mimic

import android.content.Context
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import dev.mimic.ui.kit.Mode
import dev.mimic.ui.kit.ThemeName

/** User-tunable values, persisted. Each is Compose state so the UI and engines see changes live. */
class Settings(ctx: Context) {
    private val p = ctx.getSharedPreferences("mimic", Context.MODE_PRIVATE)

    val theme = enumPref("theme", ThemeName.Chameleon)
    val leftHanded = boolPref("leftHanded", false)
    /** Master switch for every vibration (touch feedback and game rumble). */
    val haptics = boolPref("haptics", true)
    /** 0..1, scales every vibration. */
    val hapticStrength = floatPref("hapticStrength", 0.8f)
    /** Multiplier on the air mouse's base gain. */
    val sensitivity = floatPref("sensitivity", 1f)
    val invertX = boolPref("invertX", false)
    val invertY = boolPref("invertY", false)
    /** Point: sleep the pointer when the phone is set down. */
    val pointerSleep = boolPref("pointerSleep", true)
    /** Pad: stick base follows the thumb past the rim (default: anchored). */
    val stickFollow = boolPref("stickFollow", false)
    /** Pad: a soft tick when the stick passes one of 8 directions. */
    val stickTicks = boolPref("stickTicks", true)
    val padScale = floatPref("padScale", 1f)
    val padOpacity = floatPref("padOpacity", 0.9f)
    /** Pad: phone rotation drives the right stick. */
    val gyroAim = boolPref("gyroAim", false)
    /** Pad: steer the left stick by tilting the phone. */
    val tiltSteer = boolPref("tiltSteer", false)
    /** Wand: tapping the back of the phone presses B (experimental). */
    val backTap = boolPref("backTap", false)
    val introDone = boolPref("introDone", false)
    /** Motion (DSU) axis sign fixes, found by testing in Dolphin. */
    val dsuInvertPitch = boolPref("dsuInvertPitch", false)
    val dsuInvertYaw = boolPref("dsuInvertYaw", false)
    val dsuInvertRoll = boolPref("dsuInvertRoll", false)
    /** Bluetooth address of the last laptop we were connected to; reconnected on launch. */
    val lastHost = stringPref("lastHost", "")
    /** HidDescriptor.version the laptop was last paired with; differs = the laptop needs a re-pair. */
    val pairedDescriptor = intPref("pairedDescriptor", 0)

    /** Everything on the Settings page. Not the pairing, the intro or the remembered laptop. */
    private val userPrefs: List<Persisted<*>> = listOf(
        theme, leftHanded, haptics, hapticStrength, sensitivity, invertX, invertY, pointerSleep,
        stickFollow, stickTicks, padScale, padOpacity, gyroAim, tiltSteer, backTap,
        dsuInvertPitch, dsuInvertYaw, dsuInvertRoll,
    )

    fun resetToDefaults() = userPrefs.forEach { it.reset() }

    /** Vibration strength the engine should use right now: 0 when vibration is switched off. */
    fun effectiveHaptics(): Float = if (haptics.value) hapticStrength.value else 0f

    /** How many times the "hold it like this" card has been shown per mode. */
    fun gripCardShown(mode: Mode): Int = p.getInt("grip_${mode.name}", 0)
    fun markGripCardShown(mode: Mode) = p.edit().putInt("grip_${mode.name}", gripCardShown(mode) + 1).apply()

    private fun floatPref(key: String, def: Float) =
        Persisted(mutableStateOf(p.getFloat(key, def)), def) { p.edit().putFloat(key, it).apply() }

    private fun stringPref(key: String, def: String) =
        Persisted(mutableStateOf(p.getString(key, def) ?: def), def) { p.edit().putString(key, it).apply() }

    private fun intPref(key: String, def: Int) =
        Persisted(mutableStateOf(p.getInt(key, def)), def) { p.edit().putInt(key, it).apply() }

    private fun boolPref(key: String, def: Boolean) =
        Persisted(mutableStateOf(p.getBoolean(key, def)), def) { p.edit().putBoolean(key, it).apply() }

    private inline fun <reified E : Enum<E>> enumPref(key: String, def: E): Persisted<E> {
        val stored = p.getString(key, null)?.let { s -> enumValues<E>().firstOrNull { it.name == s } }
        return Persisted(mutableStateOf(stored ?: def), def) { p.edit().putString(key, it.name).apply() }
    }
}

class Persisted<T>(private val state: MutableState<T>, val default: T, private val save: (T) -> Unit) {
    var value: T
        get() = state.value
        set(v) { state.value = v; save(v) }

    fun reset() { value = default }
}
