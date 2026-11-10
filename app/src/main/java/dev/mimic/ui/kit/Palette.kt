package dev.mimic.ui.kit

/** The three looks the user can pick in Settings. */
enum class ThemeName { Chameleon, Ink, Arcade }

/** The ways of holding the phone, each its own controller. */
enum class Mode { Point, Wand, Pad, Grip }

/**
 * Colours as ARGB longs so they stay plain JVM values (tested without Android).
 * Chameleon is the brand idea made visible: the app changes colour to become each device.
 */
object Palette {
    const val bg = 0xFF0A0B0D

    fun accent(theme: ThemeName, mode: Mode?): Long = when (theme) {
        ThemeName.Chameleon -> when (mode) {
            null, Mode.Point -> 0xFF5EE6D0
            Mode.Wand -> 0xFFFFB454
            Mode.Pad -> 0xFFA68BFF
            Mode.Grip -> 0xFFFF6B4A
        }
        ThemeName.Ink -> 0xFF7CC4FF
        ThemeName.Arcade -> if (mode == Mode.Wand) 0xFFFFD23F else 0xFFFF5D73
    }
}
