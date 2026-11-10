package dev.mimic.input

/**
 * Hardware keys go to whichever mode claimed them, and only while Mimic is on screen. If the
 * app is in the background or no mode claimed them, the key does what it normally does
 * (volume), so leaving Point can never trap the volume keys.
 */
class KeyRouter {
    @Volatile var handler: ((keyCode: Int, down: Boolean) -> Boolean)? = null

    /** True = consumed. */
    fun onKey(keyCode: Int, down: Boolean, appForeground: Boolean): Boolean {
        if (!appForeground) return false
        return handler?.invoke(keyCode, down) ?: false
    }
}
