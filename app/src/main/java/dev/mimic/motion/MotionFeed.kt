package dev.mimic.motion

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import dev.mimic.Settings
import dev.mimic.dsu.DsuServer
import dev.mimic.hid.HidController
import dev.mimic.hid.MotionButton
import dev.mimic.hid.MotionSig
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Reads the phone's fused orientation, accelerometer and gyro.
 *
 * Bluetooth motion report axes (each -32767..32767):
 *   X, Y, Z    orientation quaternion x, y, z (w = sqrt(1 - x^2 - y^2 - z^2), always >= 0),
 *              in the phone's frame (x right, y toward the top, z out of the screen),
 *              relative to a level frame whose forward is where the phone pointed at the last
 *              Center press. Identity = flat, screen up, top pointing at the screen.
 *   Rx, Ry, Rz acceleration in the phone's frame including gravity, full scale = 8 g.
 *
 * DSU (Dolphin over Wi-Fi) gets gyro + accel in the controller frame it expects.
 */
class MotionFeed(
    ctx: Context, private val hid: HidController, private val dsu: DsuServer, private val s: Settings,
    /** Fired once per swing (angular speed crossing [SWING_RADS] upward), at most every 250 ms. */
    private val onSwing: () -> Unit = {},
    /** Who is speaking, marked in the axes' low bits (MotionSig): the Wand, or Grip. */
    private val sigMode: Int = MotionSig.WAND,
) : SensorEventListener {
    private val backTap = BackTap()
    private var tapUntilNs = 0L
    private var lastSwingNs = 0L
    private var lastGyroMag = 0f
    private val sm = ctx.getSystemService(SensorManager::class.java)
    private val acc = FloatArray(3)
    private val q = floatArrayOf(0f, 0f, 0f, 1f)        // latest raw orientation (x, y, z, w)
    private var ref = floatArrayOf(0f, 0f, 0f, 1f)      // yaw-only reference rotation
    private var haveQ = false
    private var centerNext = true
    @Volatile var buttons = 0
    /** Buttons as sent: the on-screen ones plus B while a back-tap is held. */
    private fun liveButtons(nowNs: Long) =
        if (nowNs < tapUntilNs) buttons or (1 shl MotionButton.B) else buttons

    fun start() {
        for (t in listOf(Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GYROSCOPE, Sensor.TYPE_GAME_ROTATION_VECTOR))
            sm.registerListener(this, sm.getDefaultSensor(t), SensorManager.SENSOR_DELAY_FASTEST)
    }

    fun stop() = sm.unregisterListener(this)

    fun recenter() { centerNext = true }

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                System.arraycopy(e.values, 0, acc, 0, 3)
                if (s.backTap.value && backTap.update(acc[2], lastGyroMag, e.timestamp)) tapUntilNs = e.timestamp + 80_000_000L
            }
            Sensor.TYPE_GAME_ROTATION_VECTOR -> {
                q[0] = e.values[0]; q[1] = e.values[1]; q[2] = e.values[2]
                q[3] = if (e.values.size > 3) e.values[3] else
                    kotlin.math.sqrt(maxOf(0f, 1f - q[0] * q[0] - q[1] * q[1] - q[2] * q[2]))
                haveQ = true
                if (centerNext) { ref = YawRef.of(q); centerNext = false }
                sendHid()
            }
            Sensor.TYPE_GYROSCOPE -> {
                val v = e.values
                val mag = kotlin.math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
                if (lastGyroMag < SWING_RADS && mag >= SWING_RADS && e.timestamp - lastSwingNs > 250_000_000L) {
                    lastSwingNs = e.timestamp; onSwing()
                }
                lastGyroMag = mag
                sendDsu(e)
            }
        }
    }

    private fun sendHid() {
        var r = mul(ref, q)
        if (r[3] < 0) r = floatArrayOf(-r[0], -r[1], -r[2], -r[3])
        val accScale = 32767f / (8f * SensorManager.GRAVITY_EARTH)
        hid.setMotion(
            liveButtons(android.os.SystemClock.elapsedRealtimeNanos()),
            MotionSig.sign(intArrayOf(
                (r[0] * 32767).roundToInt(), (r[1] * 32767).roundToInt(), (r[2] * 32767).roundToInt(),
                (acc[0] * accScale).roundToInt(), (acc[1] * accScale).roundToInt(), (acc[2] * accScale).roundToInt(),
            ), sigMode, hid.tag),
        )
    }

    private fun mul(a: FloatArray, b: FloatArray) = floatArrayOf(
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    )

    private fun sendDsu(e: SensorEvent) {
        val b = liveButtons(e.timestamp)
        fun has(bit: Int) = b and (1 shl bit) != 0
        fun bits(vararg pairs: Pair<Int, Int>) = pairs.fold(0) { acc, (from, to) -> if (has(from)) acc or (1 shl to) else acc }
        // DSU (DualShock layout) buttons1: share 0, options 3, up 4, right 5, down 6, left 7;
        // buttons2: R1 3, triangle 4, cross 6, square 7.
        dsu.buttons1 = bits(MotionButton.MINUS to 0, MotionButton.PLUS to 3, MotionButton.UP to 4,
            MotionButton.RIGHT to 5, MotionButton.DOWN to 6, MotionButton.LEFT to 7)
        dsu.buttons2 = bits(MotionButton.B to 3, MotionButton.TWO to 4, MotionButton.A to 6, MotionButton.ONE to 7)
        dsu.home = has(MotionButton.HOME)

        val g = SensorManager.GRAVITY_EARTH
        val deg = 57.29578f
        fun inv(on: Boolean) = if (on) -1f else 1f
        dsu.publish(
            DsuServer.Motion(
                accX = acc[0] / g, accY = acc[2] / g, accZ = -acc[1] / g,
                pitch = e.values[0] * deg * inv(s.dsuInvertPitch.value),
                yaw = e.values[2] * deg * inv(s.dsuInvertYaw.value),
                roll = -e.values[1] * deg * inv(s.dsuInvertRoll.value),
            ),
            e.timestamp / 1000,
        )
    }

    override fun onAccuracyChanged(s: Sensor?, a: Int) {}

    companion object { const val SWING_RADS = 7f }
}

/**
 * Recenter: which way is "straight ahead" for the phone's pose q (x, y, z, w; Android world
 * frame, z up; phone x right, y top, z out of the screen). Pure.
 *
 * The phone's TOP decides, projected on the floor: pointing a Wand at the screen, or a Grip fist
 * with the forearm (the top) swung forward. Only when the top is near vertical, where its floor
 * direction vanishes, does the back (the screen normal) take over, blended in continuously:
 *
 *   V = top_h + k * max(0, 1 - |top_h| / H)^2 * back_h
 *
 * Top down (a hanging arm, phone in a fist: the back faces sideways): k 0.08, H 0.2, so the back
 * only matters within ~3 deg of vertical (the old switch at 17 deg turned the world 90 deg).
 * Top up (a Wand held upright like a remote, screen toward you, the back toward the screen): k 2,
 * H 0.6, so upright (and leaning back up to ~20 deg) still means the back, as before. k and H
 * slide with how far up the top points, so nothing jumps. (A heading that turns with the world
 * cannot be continuous for every pose; its one flip sits at "upright, leaning back ~20 deg".)
 */
object YawRef {
    /** Heading (rad, from world +Y, anticlockwise from above) of the direction recenter calls forward. */
    fun heading(q: FloatArray): Float {
        val x = q[0]; val y = q[1]; val z = q[2]; val w = q[3]
        // top (phone +y) and back (phone -z) in world coordinates
        val tx = 2 * (x * y - z * w); val ty = 1 - 2 * (x * x + z * z); val tz = 2 * (y * z + x * w)
        val bx = -2 * (x * z + y * w); val by = -2 * (y * z - x * w)
        val h = hypot(tx, ty)
        val s = ((tz + 1) / 2).coerceIn(0f, 1f)            // 0 top down .. 1 top up
        val k = 0.08f + (2f - 0.08f) * s
        val hh = 0.2f + (0.6f - 0.2f) * s
        val f = (1 - h / hh).coerceAtLeast(0f)
        val wb = k * f * f
        val fx = tx + wb * bx; val fy = ty + wb * by
        return atan2(-fx, fy)
    }

    /** Rotation about world up that turns that direction to forward (heading 0). */
    fun of(q: FloatArray): FloatArray {
        val half = -heading(q) / 2
        return floatArrayOf(0f, 0f, sin(half), cos(half))
    }
}
