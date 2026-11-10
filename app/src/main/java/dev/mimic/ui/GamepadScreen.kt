package dev.mimic.ui

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.view.MotionEvent
import android.view.Surface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInteropFilter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.mimic.Settings
import dev.mimic.haptics.Feel
import dev.mimic.haptics.HapticEngine
import dev.mimic.hid.HidController
import dev.mimic.hid.PadButton
import dev.mimic.hid.PadState
import dev.mimic.input.AnchoredStick
import dev.mimic.input.TouchClaim
import dev.mimic.input.Dpad
import dev.mimic.input.Area
import dev.mimic.input.PadLayout
import androidx.compose.ui.layout.onSizeChanged
import dev.mimic.input.StickEvent
import dev.mimic.motion.GyroAim
import dev.mimic.ui.kit.Control
import dev.mimic.ui.kit.LocalAccent
import kotlin.math.roundToInt

/** Live gamepad state; every change is pushed to Bluetooth as one report. */
private class PadModel {
    var buttons by mutableIntStateOf(0)
    var hat by mutableIntStateOf(8)
    var dpad = 0                       // held D-pad keys (Dpad bits)
    var lx by mutableFloatStateOf(0f); var ly by mutableFloatStateOf(0f)
    var rx by mutableFloatStateOf(0f); var ry by mutableFloatStateOf(0f)
    var aimX by mutableFloatStateOf(0f); var aimY by mutableFloatStateOf(0f)

    fun set(bit: Int, down: Boolean) {
        buttons = if (down) buttons or (1 shl bit) else buttons and (1 shl bit).inv()
    }
    fun isDown(bit: Int) = buttons and (1 shl bit) != 0

    fun toState(): PadState {
        fun ax(v: Float) = (128 + v.coerceIn(-1f, 1f) * 127).roundToInt().coerceIn(0, 255)
        return PadState(
            buttons = buttons, hat = hat,
            // HID Y grows downward; our sticks are +y up.
            lx = ax(lx), ly = ax(-ly), rx = ax(rx + aimX), ry = ax(-(ry + aimY)),
            lt = if (isDown(PadButton.L2)) 255 else 0,
            rt = if (isDown(PadButton.R2)) 255 else 0,
        )
    }
}

/**
 * Pad: landscape, two thumbs, laid out symmetrically by PadLayout. Each stick appears where
 * the thumb lands inside its round zone and stays anchored there; face buttons mirror the left
 * stick; shoulders sit under the index fingers, clear of the top edge. Every control vibrates in its own way.
 */
@Composable
fun GamepadScreen(hid: HidController, s: Settings, haptics: HapticEngine) {
    val pad = remember { PadModel() }
    val ctx = LocalContext.current

    LaunchedEffect(Unit) { snapshotFlow { pad.toState() }.collect { hid.setPad(it) } }
    WhileForeground(onPause = { hid.setPad(PadState()) }, onResume = { hid.setPad(pad.toState()) })
    DisposableEffect(Unit) {
        hid.onRumble = { r -> haptics.rumble(r.strength, r.ms, r.pattern) }
        onDispose { hid.onRumble = null; hid.setPad(PadState()) }
    }
    if (s.tiltSteer.value) TiltSteer(ctx) { pad.lx = it }
    if (s.gyroAim.value) GyroAimFeed(ctx) { x, y -> pad.aimX = x; pad.aimY = y }

    fun key(bit: Int): (Boolean) -> Unit = { d -> pad.set(bit, d) }
    val a = s.padOpacity.value

    // Fills the area inside the cutout (padded equally both sides by MainActivity), so the
    // layout's centre is the screen's centre. See PadLayout for the rules.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val p = remember(maxWidth, maxHeight, s.padScale.value, s.leftHanded.value) {
            PadLayout(maxWidth.value, maxHeight.value, s.padScale.value, s.leftHanded.value)
        }
        fun Modifier.at(r: Area) = offset(r.x.dp, r.y.dp).size(r.w.dp, r.h.dp)

        val sh = RoundedCornerShape(14.dp)
        Control("L1", Modifier.at(p.l1), haptics, sh, Feel.Click, alpha = a, labelSize = 13, onChange = key(PadButton.L1))
        Control("L2", Modifier.at(p.l2), haptics, sh, Feel.Thud, alpha = a, labelSize = 13, onChange = key(PadButton.L2))
        Control("R2", Modifier.at(p.r2), haptics, sh, Feel.Thud, alpha = a, labelSize = 13, onChange = key(PadButton.R2))
        Control("R1", Modifier.at(p.r1), haptics, sh, Feel.Click, alpha = a, labelSize = 13, onChange = key(PadButton.R1))

        Control("SELECT", Modifier.at(p.select), haptics, sh, Feel.Notch, alpha = a, labelSize = 10, onChange = key(PadButton.SELECT))
        Control("HOME", Modifier.at(p.home), haptics, sh, Feel.Thud, alpha = a, labelSize = 10, onChange = key(PadButton.HOME))
        Control("START", Modifier.at(p.start), haptics, sh, Feel.Notch, alpha = a, labelSize = 10, onChange = key(PadButton.START))

        StickZone(Modifier.at(p.leftZone), radius = p.leftRadius.dp, s = s, haptics = haptics, alpha = a, label = "STICK") { sx, sy ->
            if (!s.tiltSteer.value) pad.lx = sx; pad.ly = sy
        }

        // each key held on its own: two at once is a diagonal, releasing one keeps the other
        val dsq = RoundedCornerShape(10.dp)
        fun hat(key: Int): (Boolean) -> Unit = { d -> pad.dpad = Dpad.set(pad.dpad, key, d); pad.hat = Dpad.hat(pad.dpad) }
        Control("", Modifier.at(p.dUp), haptics, dsq, Feel.Notch, alpha = a, onChange = hat(Dpad.UP))
        Control("", Modifier.at(p.dLeft), haptics, dsq, Feel.Notch, alpha = a, onChange = hat(Dpad.LEFT))
        Control("", Modifier.at(p.dRight), haptics, dsq, Feel.Notch, alpha = a, onChange = hat(Dpad.RIGHT))
        Control("", Modifier.at(p.dDown), haptics, dsq, Feel.Notch, alpha = a, onChange = hat(Dpad.DOWN))

        StickZone(Modifier.at(p.rightZone), radius = p.rightRadius.dp, s = s, haptics = haptics, alpha = a, label = "LOOK") { sx, sy ->
            pad.rx = sx; pad.ry = sy
        }

        // Face buttons: a diamond, A at the bottom under the thumb's natural rest.
        Control("Y", Modifier.at(p.y), haptics, feel = Feel.Click, alpha = a, onChange = key(PadButton.Y))
        Control("X", Modifier.at(p.x), haptics, feel = Feel.Click, alpha = a, onChange = key(PadButton.X))
        Control("B", Modifier.at(p.b), haptics, feel = Feel.Thud, alpha = a, onChange = key(PadButton.B))
        Control("A", Modifier.at(p.a), haptics, feel = Feel.Click, alpha = a, onChange = key(PadButton.A))
    }
}

/**
 * A round zone around the stick's base: the stick appears under the first finger that lands
 * inside the circle (palms ignored) and stays anchored there until that finger lifts. Touches
 * outside the circle are never taken, so nearby buttons keep theirs. Each stick event has its own vibration.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun StickZone(
    modifier: Modifier,
    radius: Dp,
    s: Settings,
    haptics: HapticEngine,
    alpha: Float,
    label: String,
    onMove: (Float, Float) -> Unit,
) {
    val accent = LocalAccent.current
    val rPx = with(LocalDensity.current) { radius.toPx() }
    val xdpi = LocalContext.current.resources.displayMetrics.xdpi
    val stick = remember(rPx) { AnchoredStick(rPx) }
    var pointer by remember { mutableIntStateOf(-1) }
    var knob by remember { mutableStateOf<Offset?>(null) }
    var base by remember { mutableStateOf(Offset.Zero) }
    var zoneSize by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }

    fun emit(o: dev.mimic.input.StickOut) {
        onMove(o.x, o.y)
        for (e in o.events) when (e) {
            StickEvent.Engage -> haptics.play(Feel.StickEngage)
            is StickEvent.Direction -> haptics.play(Feel.StickDirection)
            StickEvent.Rim -> haptics.play(Feel.StickRim)
            StickEvent.Neutral -> haptics.play(Feel.Release)
        }
    }

    Box(
        modifier.graphicsLayer { this.alpha = alpha }
            .onSizeChanged { zoneSize = it }
            .pointerInteropFilter { e ->
            val i = e.actionIndex
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> if (TouchClaim.canClaim(
                    pointer, e.getX(i), e.getY(i), zoneSize.width, zoneSize.height, e.getTouchMajor(i), xdpi) &&
                    PadLayout.inStickZone(e.getX(i), e.getY(i), zoneSize.width.toFloat(), zoneSize.height.toFloat())) {
                    pointer = e.getPointerId(i)
                    stick.follow = s.stickFollow.value; stick.ticks = s.stickTicks.value
                    stick.down(e.getX(i), e.getY(i))
                    base = Offset(stick.anchorX, stick.anchorY); knob = base
                }
                MotionEvent.ACTION_MOVE -> {
                    val j = e.findPointerIndex(pointer)
                    if (j >= 0) {
                        val o = stick.move(e.getX(j), e.getY(j))
                        base = Offset(stick.anchorX, stick.anchorY)
                        knob = Offset(base.x + o.x * rPx, base.y - o.y * rPx)
                        emit(o)
                    }
                }
                MotionEvent.ACTION_POINTER_UP -> if (e.getPointerId(i) == pointer) { pointer = -1; knob = null; emit(stick.up()) }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (pointer != -1) { pointer = -1; knob = null; emit(stick.up()) }
            }
            true
        },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val k = knob
            // The touch area: a very faint disc, so it is clear where the stick takes a thumb.
            drawCircle(accent.copy(alpha = 0.04f), size.minDimension / 2, center)
            if (k == null) {
                // Idle: a faint hint of where the stick lives.
                drawCircle(accent.copy(alpha = 0.18f), rPx, center, style = Stroke(1.5.dp.toPx()))
            } else {
                drawCircle(accent.copy(alpha = 0.10f), rPx, base)
                drawCircle(accent.copy(alpha = 0.6f), rPx, base, style = Stroke(2.dp.toPx()))
                drawCircle(accent.copy(alpha = 0.35f), rPx * 0.12f, base, style = Stroke(1.dp.toPx()))
                drawCircle(accent.copy(alpha = 0.85f), rPx * 0.42f, k)
            }
        }
        if (knob == null) Text(label, style = Caption.copy(color = accent.copy(alpha = 0.4f)), modifier = Modifier.align(Alignment.Center))
    }
}

/**
 * Tilt-to-steer: hold the phone like a wheel (landscape). Rolling it shifts gravity onto the
 * phone's Y axis; that becomes the left stick's X.
 */
@Composable
private fun TiltSteer(ctx: Context, onSteer: (Float) -> Unit) {
    DisposableEffect(Unit) {
        val sm = ctx.getSystemService(SensorManager::class.java)
        val l = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                onSteer((e.values[1] / SensorManager.GRAVITY_EARTH * 1.8f).coerceIn(-1f, 1f))
            }
            override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        }
        sm.registerListener(l, sm.getDefaultSensor(Sensor.TYPE_GRAVITY), SensorManager.SENSOR_DELAY_GAME)
        onDispose { sm.unregisterListener(l); onSteer(0f) }
    }
}

/**
 * Gyro aim feed for landscape. Which way the phone is turned (top to the left or right)
 * flips the axes, so the display rotation picks the signs.
 */
@Composable
private fun GyroAimFeed(ctx: Context, onAim: (Float, Float) -> Unit) {
    val view = LocalView.current
    DisposableEffect(Unit) {
        val sm = ctx.getSystemService(SensorManager::class.java)
        val aim = GyroAim()
        var last = 0L
        val l = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                val dt = if (last == 0L) 0.005f else (e.timestamp - last) / 1e9f
                last = e.timestamp
                val sign = if (view.display?.rotation == Surface.ROTATION_270) -1f else 1f
                val (x, y) = aim.update(yawRate = e.values[0] * sign, pitchRate = -e.values[1] * sign, dt = dt)
                onAim(x, y)
            }
            override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        }
        sm.registerListener(l, sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE), SensorManager.SENSOR_DELAY_GAME)
        onDispose { sm.unregisterListener(l); onAim(0f, 0f) }
    }
}
