package dev.mimic

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import dev.mimic.hid.HidController
import java.io.File

/**
 * Debug hooks driven from the laptop over adb, so the pipeline can be measured without a
 * human tapping the phone:
 *   adb shell am broadcast -a dev.mimic.TEST_PATTERN [--ei step 4 --ei ticks 250]   scripted HID motion
 *   adb shell am broadcast -a dev.mimic.RECORD --ei seconds 5                        raw sensors -> files/rec.csv
 *   adb shell am broadcast -a dev.mimic.HAPTICS                                  log what the vibration motor supports
 *   adb shell am broadcast -a dev.mimic.OPEN --es screen Point|Wand|Pad|Grip|Settings|About|home  switch screen
 * Pull the recording with: adb exec-out run-as dev.mimic cat files/rec.csv
 */
class Diagnostics(
    private val ctx: Context,
    private val hid: HidController,
    private val onOpen: (screen: String) -> Unit,
) {
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (i.action) {
                TEST_PATTERN -> hid.runTestPattern(i.getIntExtra("step", 4), i.getIntExtra("ticks", 250))
                RECORD -> record(i.getIntExtra("seconds", 5))
                OPEN -> onOpen(i.getStringExtra("screen") ?: "home")
                HAPTICS -> Log.i(TAG, "haptics " + dev.mimic.haptics.HapticEngine(ctx) { 1f }.describe())
            }
        }
    }

    fun register() = ctx.registerReceiver(
        receiver, IntentFilter().apply { addAction(TEST_PATTERN); addAction(RECORD); addAction(OPEN); addAction(HAPTICS) },
        Context.RECEIVER_EXPORTED,
    )

    fun unregister() = ctx.unregisterReceiver(receiver)

    /**
     * Columns: sensor, timestamp ns, values.
     * g = gyro (rad/s), a = accel (m/s^2), l = linear accel (m/s^2),
     * r = game rotation vector quaternion x,y,z,w (gyro-fused orientation, no magnetometer).
     */
    private fun record(seconds: Int) {
        val sm = ctx.getSystemService(SensorManager::class.java)
        val out = StringBuilder()
        val l = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                val tag = when (e.sensor.type) {
                    Sensor.TYPE_GYROSCOPE -> 'g'
                    Sensor.TYPE_ACCELEROMETER -> 'a'
                    Sensor.TYPE_GAME_ROTATION_VECTOR -> 'r'
                    else -> 'l'
                }
                synchronized(out) {
                    out.append(tag).append(',').append(e.timestamp).append(',')
                        .append(e.values.take(4).joinToString(",")).append('\n')
                }
            }
            override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        }
        for (t in intArrayOf(
            Sensor.TYPE_GYROSCOPE, Sensor.TYPE_ACCELEROMETER,
            Sensor.TYPE_LINEAR_ACCELERATION, Sensor.TYPE_GAME_ROTATION_VECTOR,
        )) sm.registerListener(l, sm.getDefaultSensor(t), SensorManager.SENSOR_DELAY_FASTEST)
        Log.i(TAG, "record start ${seconds}s")
        Handler(Looper.getMainLooper()).postDelayed({
            sm.unregisterListener(l)
            val text = synchronized(out) { out.toString() }
            File(ctx.filesDir, "rec.csv").writeText(text)
            Log.i(TAG, "record done lines=${text.count { it == '\n' }}")
        }, seconds * 1000L)
    }

    companion object {
        private const val TAG = "MimicDiag"
        const val TEST_PATTERN = "dev.mimic.TEST_PATTERN"
        const val RECORD = "dev.mimic.RECORD"
        const val OPEN = "dev.mimic.OPEN"
        const val HAPTICS = "dev.mimic.HAPTICS"
    }
}
