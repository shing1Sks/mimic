package dev.mimic.motion

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

/**
 * Grip's gesture sensors (the aim itself goes out in the motion report, see MotionFeed):
 * linear acceleration for the sideways flick, gravity for which way is up in your grip.
 */
class GripMotion(
    ctx: Context,
    /** Linear acceleration (gravity removed) and the up vector, both in phone axes. */
    private val onLinear: (FloatArray, FloatArray) -> Unit,
) : SensorEventListener {
    private val sm = ctx.getSystemService(SensorManager::class.java)
    // the fused gravity sensor ignores the jolt of a flick; plain accelerometer as fallback
    private val grav = sm.getDefaultSensor(Sensor.TYPE_GRAVITY) ?: sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val lin = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private val up = floatArrayOf(0f, 0f, 9.81f)

    fun start() {
        sm.registerListener(this, grav, SensorManager.SENSOR_DELAY_GAME)
        lin?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    fun stop() = sm.unregisterListener(this)

    override fun onSensorChanged(e: SensorEvent) {
        if (e.sensor.type == Sensor.TYPE_LINEAR_ACCELERATION) { onLinear(e.values, up); return }
        val k = if (e.sensor.type == Sensor.TYPE_GRAVITY) 1f else 0.1f   // low-pass the raw accelerometer
        for (i in 0..2) up[i] += (e.values[i] - up[i]) * k
    }

    override fun onAccuracyChanged(s: Sensor?, a: Int) {}
}
