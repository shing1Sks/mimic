package dev.mimic.motion

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.abs
import kotlin.math.sign

/** Something that turns phone movement into mouse counts and hands them to [out]. */
interface MouseMotion {
    fun start()
    fun stop()
}

typealias MoveSink = (dx: Float, dy: Float) -> Unit

/**
 * Air mouse: hold the phone like a remote (screen up, top pointing at the laptop).
 * Turning left/right (rotation about the screen normal, gyro Z) moves X;
 * tilting the top up/down (rotation about the phone's X axis) moves Y.
 * Rotation *rate* maps straight to cursor speed — no integration, so no drift.
 */
class AirMouse(
    ctx: Context,
    private val out: MoveSink,
    /** Sleep when set down; read live so the setting applies immediately. */
    private val sleepEnabled: () -> Boolean = { false },
    private val onSleep: (Boolean) -> Unit = {},
) : MouseMotion, SensorEventListener {
    private val sm = ctx.getSystemService(SensorManager::class.java)
    private val gyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val sleep = PointerSleep()
    private var gravityZ = 9.8f
    private var asleep = false
    private var lastNs = 0L

    override fun start() {
        lastNs = 0L
        sm.registerListener(this, gyro, SensorManager.SENSOR_DELAY_FASTEST)
        sm.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
    }

    override fun stop() = sm.unregisterListener(this)

    override fun onSensorChanged(e: SensorEvent) {
        if (e.sensor.type == Sensor.TYPE_ACCELEROMETER) { gravityZ = e.values[2]; return }
        if (lastNs == 0L) { lastNs = e.timestamp; return }
        val dt = (e.timestamp - lastNs) / 1e9f
        lastNs = e.timestamp
        if (dt <= 0f || dt > 0.1f) return
        val v = e.values
        val nowAsleep = sleepEnabled() &&
            sleep.update(kotlin.math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]), gravityZ, (dt * 1000).toInt())
        if (nowAsleep != asleep) { asleep = nowAsleep; onSleep(asleep) }
        if (asleep) return
        out(-shape(v[2]) * GAIN * dt, -shape(v[0]) * GAIN * dt)
    }

    /** Dead zone kills hand tremor; mild acceleration gives precision slow, reach fast. */
    private fun shape(w: Float): Float {
        val m = abs(w)
        if (m < DEAD) return 0f
        val v = m - DEAD
        return sign(w) * v * (1f + ACCEL * v)
    }

    override fun onAccuracyChanged(s: Sensor?, a: Int) {}

    companion object {
        const val GAIN = 1800f  // counts per radian: ~40 deg of wrist turn crosses a 1536 px screen with Windows EPP on (measured)
        const val DEAD = 0.015f // rad/s
        const val ACCEL = 0.3f  // Windows already accelerates; keep ours mild
    }
}
