package dev.mimic.hid

/**
 * Reconnecting to the last laptop on its own, like a real mouse waking up, for as long as the app
 * is in the foreground: power button off and on, app switch, Bluetooth toggled, laptop asleep and
 * awake all recover without a Retry button. Only an explicit Disconnect stops it (and picking
 * another laptop changes which one it chases). Pure: what to do next, and how long to wait.
 */
object Reconnect {
    /** Wait after attempt N (0-based): quick at first, then every [MAX_GAP_MS], forever. */
    private val DELAYS_MS = longArrayOf(0, 1_000, 2_000, 3_000, 4_000)
    const val MAX_GAP_MS = 5_000L

    fun delayFor(attempt: Int): Long = DELAYS_MS.getOrElse(attempt.coerceAtLeast(0)) { MAX_GAP_MS }

    enum class Action {
        /** Connected, or nothing to chase: just look again later. */
        IDLE,
        /** Bluetooth is off: wait for it. */
        WAIT_BLUETOOTH,
        /** Not registered as a Bluetooth input device (yet, or any more): register. */
        REGISTER,
        /** Registered, not connected, a remembered laptop is still paired: connect to it. */
        CONNECT,
    }

    fun next(
        bluetoothOn: Boolean, status: HidController.Status, connected: Boolean,
        userDisconnected: Boolean, target: String?,
    ): Action = when {
        !bluetoothOn -> Action.WAIT_BLUETOOTH
        status == HidController.Status.Unsupported -> Action.IDLE
        status == HidController.Status.Off -> Action.REGISTER
        status == HidController.Status.Registering -> Action.IDLE
        connected || userDisconnected || target == null -> Action.IDLE
        else -> Action.CONNECT
    }

    /** The last host, if it is still paired with this phone; otherwise nothing to reconnect to. */
    fun pick(lastAddress: String?, bondedAddresses: Collection<String>): String? =
        lastAddress?.takeIf { it.isNotBlank() && bondedAddresses.any { b -> b.equals(it, ignoreCase = true) } }
}
