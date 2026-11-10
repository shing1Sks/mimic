package dev.mimic.hid

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHidDevice
import android.bluetooth.BluetoothHidDeviceAppSdpSettings
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.mimic.BtPermissions
import dev.mimic.Persisted
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * Owns the phone's "I am a Bluetooth mouse + gamepad" registration and the report stream.
 *
 * Motion code calls [move]/[scroll]/[setMouseButton]/[setPad] as fast as it likes; a sender
 * thread flushes accumulated input every [FLUSH_MS] so we never flood the Bluetooth link,
 * and fractional motion is carried over so slow movements aren't lost to rounding.
 */
@SuppressLint("MissingPermission") // permissions are requested in MainActivity before start()
class HidController(private val ctx: Context, private val lastHost: Persisted<String>) {

    enum class Status { Off, Unsupported, Registering, Ready, Connected }

    var status by mutableStateOf(Status.Off); private set
    var host by mutableStateOf<BluetoothDevice?>(null); private set
    var error by mutableStateOf<String?>(null); private set
    /** Name of the laptop we are reconnecting to on our own, or null when not trying. */
    var reconnecting by mutableStateOf<String?>(null); private set

    /** Set by the open mode to play game rumble; null = ignore. Called on a binder thread. */
    @Volatile var onRumble: ((Rumble) -> Unit)? = null
    /** The tag the page last gave this phone (0..3), echoed in the motion report, see MotionSig. */
    @Volatile var tag = 0; private set

    private val main = Handler(Looper.getMainLooper())
    private val adapter: BluetoothAdapter? =
        ctx.getSystemService(BluetoothManager::class.java)?.adapter
    private var hid: BluetoothHidDevice? = null
    private val callbackExec = Executors.newSingleThreadExecutor()
    private val sender = Executors.newSingleThreadScheduledExecutor()

    // Accumulated input, guarded by `lock`.
    private val lock = Any()
    private var accX = 0f
    private var accY = 0f
    private var accWheel = 0f
    private var mouseButtons = 0
    private var mouseDirty = false
    private var pad = PadState()
    private var padDirty = false
    private var motionButtons = 0
    private val motionAxes = IntArray(6)
    private var motionDirty = false
    private val keys = KeySet()
    private var keysDirty = false

    private val sdp = BluetoothHidDeviceAppSdpSettings(
        "Mimic", "Phone as mouse and gamepad", "Mimic",
        BluetoothHidDevice.SUBCLASS1_COMBO, HidDescriptor.bytes,
    )

    private val callback = object : BluetoothHidDevice.Callback() {
        override fun onAppStatusChanged(pluggedDevice: BluetoothDevice?, registered: Boolean) {
            Log.i(TAG, "app registered=$registered plugged=${pluggedDevice?.name}")
            ui {
                status = if (registered) Status.Ready else Status.Off
                if (!registered) host = null
                // Reconnect to the last laptop automatically, like a real mouse waking up.
                else if (pluggedDevice != null) hid?.connect(pluggedDevice)
                kick()
            }
        }

        override fun onConnectionStateChanged(device: BluetoothDevice, state: Int) {
            Log.i(TAG, "connection ${device.name} state=$state")
            ui {
                when (state) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        host = device; status = Status.Connected
                        lastHost.value = device.address
                        reconnecting = null
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        val wasHost = host == device
                        if (wasHost) host = null
                        if (status == Status.Connected) status = Status.Ready
                        // Link dropped without the user asking (laptop slept, out of range): try again.
                        if (wasHost) kick()
                    }
                }
            }
        }

        override fun onGetReport(device: BluetoothDevice, type: Byte, id: Byte, bufferSize: Int) {
            // Hosts sometimes poll the current state; answer with a neutral report.
            val data = when (id.toInt()) {
                HidDescriptor.PAD_ID -> HidDescriptor.padReport(PadState())
                HidDescriptor.MOTION_ID -> motionReport(0, IntArray(6))
                HidDescriptor.KEYBOARD_ID -> HidDescriptor.keyboardReport(0, emptyList())
                else -> HidDescriptor.mouseReport(0, 0, 0, 0, 0)
            }
            hid?.replyReport(device, type, id, data)
        }

        override fun onSetReport(device: BluetoothDevice, type: Byte, id: Byte, data: ByteArray) {
            hid?.reportError(device, BluetoothHidDevice.ERROR_RSP_SUCCESS)
            output(id.toInt(), data)
        }

        // Output reports (game rumble) usually arrive here, on the interrupt channel.
        override fun onInterruptData(device: BluetoothDevice, reportId: Byte, data: ByteArray) =
            output(reportId.toInt(), data)

        private fun output(id: Int, data: ByteArray) {
            RumbleCodec.decode(id, data)?.let { r -> onRumble?.invoke(r) }
            RumbleCodec.control(id, data)?.let { c -> tag = c.tag }
        }
    }

    private val profileListener = object : BluetoothProfile.ServiceListener {
        override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
            hid = proxy as BluetoothHidDevice
            register(0)
        }

        override fun onServiceDisconnected(profile: Int) {
            hid = null
            ui { status = Status.Off; host = null; kick() }
        }
    }

    fun start() {
        if (status != Status.Off) return
        val a = adapter
        if (a == null) { status = Status.Unsupported; error = "No Bluetooth on this device."; return }
        if (!a.isEnabled) { error = "Bluetooth is off. Turn it on and Mimic starts by itself."; return }
        error = null
        status = Status.Registering; registeringSince = System.currentTimeMillis()
        val ok = a.getProfileProxy(ctx, profileListener, BluetoothProfile.HID_DEVICE)
        if (!ok) {
            status = Status.Unsupported
            error = "This phone does not expose the Bluetooth HID device profile."
        }
    }

    init {
        sender.scheduleAtFixedRate(::flush, FLUSH_MS, FLUSH_MS, TimeUnit.MILLISECONDS)
        sender.scheduleWithFixedDelay(::logStats, 1, 1, TimeUnit.SECONDS)
    }

    fun stop() {
        hid?.let {
            host?.let { h -> it.disconnect(h) }
            it.unregisterApp()
            adapter?.closeProfileProxy(BluetoothProfile.HID_DEVICE, it)
        }
        hid = null
        sender.shutdownNow()
        callbackExec.shutdown()
    }

    fun bondedDevices(): List<BluetoothDevice> {
        // The home screen renders before the permission dialog is answered.
        if (!BtPermissions.granted(ctx)) return emptyList()
        return adapter?.bondedDevices?.toList()?.sortedBy { it.name ?: "" } ?: emptyList()
    }

    /** The user picked a laptop: it becomes the one the keeper chases once connected. */
    fun connect(device: BluetoothDevice) {
        userDisconnected = false
        hid?.connect(device)
        kick()
    }

    /** Explicit disconnect: the only thing that stops automatic reconnecting (until [connect]). */
    fun disconnect() {
        userDisconnected = true; reconnecting = null
        host?.let { hid?.disconnect(it) }
    }

    /**
     * Registering can fail for a moment right after the app was closed and reopened (the old
     * registration is still being torn down), so try a few times before showing an error.
     */
    private fun register(attempt: Int) {
        val h = hid ?: return
        val ok = h.registerApp(sdp, null, null, callbackExec, callback)
        Log.i(TAG, "registerApp attempt=$attempt -> $ok")
        if (ok) return
        val wait = if (attempt < REGISTER_TRIES - 1) Reconnect.delayFor(attempt + 1) else null
        // out of quick tries: the keeper registers again in a few seconds
        if (wait != null) main.postDelayed({ if (hid === h && status == Status.Registering) register(attempt + 1) }, wait)
        else ui {
            status = Status.Off
            error = "This phone refused to register as a Bluetooth input device."
        }
    }

    // ---------------- always-on reconnect (main thread) ----------------
    // While the app is in the foreground, a keeper loop makes sure the phone is registered as a
    // Bluetooth input device and connected to the remembered laptop, retrying forever with gaps
    // capped at 5 s (Reconnect). Power button, app switch, Bluetooth toggle, laptop sleep: all
    // recover on their own. Only disconnect() stops it.
    private var userDisconnected = false
    private var keeping = false
    private var keepAttempt = 0
    private var registeringSince = 0L
    private var btWasOn = true
    private val keeper = Runnable { keep() }

    /** Call from the activity's onResume / onPause. */
    fun setForeground(on: Boolean) {
        keeping = on
        if (on) kick() else { main.removeCallbacks(keeper); reconnecting = null }
    }

    /** Something changed (link dropped, registered, foreground): look now, back-off from zero. */
    private fun kick() {
        keepAttempt = 0
        main.removeCallbacks(keeper)
        if (keeping) main.post(keeper)
    }

    private fun keep() {
        if (!keeping) return
        if (!BtPermissions.granted(ctx)) { main.postDelayed(keeper, Reconnect.MAX_GAP_MS); return }
        val a = adapter
        if (status == Status.Registering && System.currentTimeMillis() - registeringSince > REGISTER_STUCK_MS) {
            Log.i(TAG, "registration stuck, starting over"); status = Status.Off
        }
        val btOn = a?.isEnabled == true
        if (btOn && !btWasOn && status != Status.Off && status != Status.Unsupported) {
            // Bluetooth came back: the old registration and proxy are gone, start from scratch
            Log.i(TAG, "bluetooth back on, registering again"); hid = null; status = Status.Off; host = null
        }
        btWasOn = btOn
        val addr = Reconnect.pick(lastHost.value, bondedDevices().map { it.address })
        val action = Reconnect.next(btOn, status, host != null, userDisconnected, addr)
        when (action) {
            Reconnect.Action.REGISTER -> {
                Log.i(TAG, "keeper: register (attempt $keepAttempt)")
                val h = hid
                if (h != null) { error = null; status = Status.Registering; registeringSince = System.currentTimeMillis(); register(0) }
                else start()
            }
            Reconnect.Action.CONNECT -> {
                val dev = try { a?.getRemoteDevice(addr) } catch (e: IllegalArgumentException) { null }
                if (dev != null) {
                    reconnecting = dev.name ?: addr
                    Log.i(TAG, "keeper: connect to ${dev.address} (attempt $keepAttempt)")
                    hid?.connect(dev)
                }
            }
            Reconnect.Action.WAIT_BLUETOOTH -> reconnecting = null
            Reconnect.Action.IDLE -> if (host != null || userDisconnected || addr == null) reconnecting = null
        }
        val wait = if (host != null) Reconnect.MAX_GAP_MS else Reconnect.delayFor(++keepAttempt)
        main.postDelayed(keeper, maxOf(wait, 250L))
    }

    // ---------------- input API (any thread) ----------------

    fun move(dx: Float, dy: Float) = synchronized(lock) { accX += dx; accY += dy }

    fun scroll(notches: Float) = synchronized(lock) { accWheel += notches }

    /** bit 0 = left, 1 = right, 2 = middle */
    fun setMouseButton(bit: Int, down: Boolean) = synchronized(lock) {
        val next = if (down) mouseButtons or (1 shl bit) else mouseButtons and (1 shl bit).inv()
        if (next != mouseButtons) { mouseButtons = next; mouseDirty = true }
    }

    fun setPad(state: PadState) = synchronized(lock) {
        if (state != pad) { pad = state; padDirty = true }
    }

    /**
     * Keyboard: HID usage code (see KeySet), held while down. Only Point's CENTRE uses it (F9, which
     * the Windows tray turns into "cursor to the middle"); a tap shorter than one flush still arrives.
     */
    fun setKey(code: Int, down: Boolean) = synchronized(lock) {
        if (if (down) keys.down(code) else keys.up(code)) keysDirty = true
    }

    fun releaseKeys() = synchronized(lock) { if (keys.clear()) keysDirty = true }

    /** Motion controller state; sent at the next flush (125 Hz), latest value wins. */
    fun setMotion(buttons: Int, axes: IntArray) = synchronized(lock) {
        motionButtons = buttons; axes.copyInto(motionAxes); motionDirty = true
    }

    private fun flush() {
        val h = hid
        val dev = host
        if (h == null || dev == null) {
            // Nobody to send to: drop pointer motion instead of saving it up, or the first report
            // after a reconnect flings the cursor into a screen corner.
            synchronized(lock) { accX = 0f; accY = 0f; accWheel = 0f }
            return
        }
        var mouse: ByteArray? = null
        var padBytes: ByteArray? = null
        var motionBytes: ByteArray? = null
        var keyBytes: ByteArray? = null
        synchronized(lock) {
            val ix = accX.roundToInt().coerceIn(-32767, 32767)
            val iy = accY.roundToInt().coerceIn(-32767, 32767)
            val iw = accWheel.roundToInt().coerceIn(-127, 127)
            accX -= ix; accY -= iy; accWheel -= iw
            if (ix != 0 || iy != 0 || iw != 0 || mouseDirty) {
                mouse = HidDescriptor.mouseReport(mouseButtons, ix, iy, iw, 0)
                mouseDirty = false
            }
            if (padDirty) { padBytes = HidDescriptor.padReport(pad); padDirty = false }
            if (motionDirty) { motionBytes = motionReport(motionButtons, motionAxes); motionDirty = false }
            if (keysDirty) { keyBytes = keys.report(); keysDirty = keys.owesReport }
        }
        try {
            mouse?.let { timedSend(h, dev, HidDescriptor.MOUSE_ID, it) }
            padBytes?.let { timedSend(h, dev, HidDescriptor.PAD_ID, it) }
            motionBytes?.let { timedSend(h, dev, HidDescriptor.MOTION_ID, it) }
            keyBytes?.let {
                // Key presses are rare and must not be lost: a refused report is resent next tick.
                if (!timedSend(h, dev, HidDescriptor.KEYBOARD_ID, it)) synchronized(lock) { keysDirty = true }
            }
        } catch (e: Exception) {
            Log.w(TAG, "sendReport failed", e)
        }
    }

    // ---------------- diagnostics ----------------
    private var statOk = 0; private var statFail = 0
    private var statNs = 0L; private var statMaxNs = 0L

    private fun timedSend(h: BluetoothHidDevice, dev: BluetoothDevice, id: Int, data: ByteArray): Boolean {
        val t0 = System.nanoTime()
        val ok = h.sendReport(dev, id, data)
        val dt = System.nanoTime() - t0
        synchronized(lock) {
            if (ok) statOk++ else statFail++
            statNs += dt; if (dt > statMaxNs) statMaxNs = dt
        }
        return ok
    }

    private fun logStats() {
        val (ok, fail, ns, max) = synchronized(lock) {
            val r = listOf(statOk.toLong(), statFail.toLong(), statNs, statMaxNs)
            statOk = 0; statFail = 0; statNs = 0; statMaxNs = 0; r
        }
        if (ok + fail > 0) Log.i(TAG, "stats/s sent=$ok failed=$fail avgSendMs=%.2f maxSendMs=%.2f"
            .format(ns / 1e6 / (ok + fail), max / 1e6))
    }

    /** Scripted motion with no sensors involved: right then left, [step] counts per tick, [ticks] ticks each way. */
    fun runTestPattern(step: Int = 4, ticks: Int = 250) = Thread {
        Log.i(TAG, "pattern start step=$step ticks=$ticks")
        for (dir in intArrayOf(1, -1)) repeat(ticks) { move(step.toFloat() * dir, 0f); Thread.sleep(FLUSH_MS) }
        Log.i(TAG, "pattern end")
    }.start()

    private fun ui(block: () -> Unit) = main.post(block)

    companion object {
        private const val TAG = "MimicHid"
        /** ~125 Hz, the classic USB mouse polling rate. */
        private const val FLUSH_MS = 8L
        private const val REGISTER_TRIES = 4
        private const val REGISTER_STUCK_MS = 10_000L
    }
}
