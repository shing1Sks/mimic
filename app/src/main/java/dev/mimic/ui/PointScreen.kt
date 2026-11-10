package dev.mimic.ui

import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.mimic.Settings
import dev.mimic.haptics.Feel
import dev.mimic.haptics.HapticEngine
import dev.mimic.hid.HidController
import dev.mimic.hid.KeySet
import dev.mimic.input.KeyRouter
import dev.mimic.input.ScrollNotches
import dev.mimic.motion.AirMouse
import dev.mimic.motion.MoveSink
import dev.mimic.ui.kit.Control
import dev.mimic.ui.kit.LocalAccent

/** Mouse buttons 4 and 5 (back / forward) in the HID mouse report. */
private const val BTN_BACK = 3
private const val BTN_FORWARD = 4

/**
 * Point: the air mouse. Held flat in one hand like a TV remote, top toward the laptop, thumb
 * resting at the bottom. Everything touchable is in the bottom part of the screen where the
 * thumb already is; the top is status only. Volume keys become back / forward.
 */
@Composable
fun PointScreen(activity: ComponentActivity, hid: HidController, s: Settings, haptics: HapticEngine, keys: KeyRouter) {
    var asleep by remember { mutableStateOf(false) }
    val sink: MoveSink = remember {
        { dx, dy ->
            val k = s.sensitivity.value
            hid.move(dx * k * (if (s.invertX.value) -1 else 1), dy * k * (if (s.invertY.value) -1 else 1))
        }
    }

    val m = remember { AirMouse(activity, sink, sleepEnabled = { s.pointerSleep.value }, onSleep = { asleep = it }) }
    WhileForeground(
        onPause = { m.stop(); for (b in 0..4) hid.setMouseButton(b, false); hid.releaseKeys() },
        onResume = { m.start() },
    )
    DisposableEffect(Unit) {
        // sensors are started by WhileForeground (it replays ON_RESUME when attached)
        keys.handler = { code, down ->
            val bit = when (code) {
                KeyEvent.KEYCODE_VOLUME_DOWN -> BTN_BACK
                KeyEvent.KEYCODE_VOLUME_UP -> BTN_FORWARD
                else -> null
            }
            if (bit != null) { if (down) haptics.play(Feel.Click); hid.setMouseButton(bit, down) }
            bit != null
        }
        onDispose {
            keys.handler = null
            m.stop()
            for (b in 0..4) hid.setMouseButton(b, false)   // never leave a button stuck down
            hid.releaseKeys()
        }
    }

    val accent = LocalAccent.current
    val left = s.leftHanded.value
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        // Top: status, plus one deliberate CENTRE button at the far end from the thumb zone.
        // It taps F9, which the Mimic tray (Windows) turns into "cursor to the middle of the screen".
        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            CentreButton(Modifier.align(Alignment.TopCenter).padding(top = 8.dp), haptics,
                onCentre = { hid.setKey(KeySet.F9, true) },
                onLift = { hid.setKey(KeySet.F9, false) })
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (asleep) "Asleep" else "Pointing", style = Title.copy(color = if (asleep) Ink.dim else accent))
                Text(
                    if (asleep) "Pick the phone up to wake the pointer."
                    else "Turn your wrist to move. Volume keys: back and forward.\nCentre: cursor to the middle (with the Mimic tray).",
                    style = Caption.copy(textAlign = TextAlign.Center),
                )
            }
        }
        // Bottom: the thumb zone.
        Row(
            Modifier.fillMaxWidth().height(300.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (left) ScrollStrip(hid, haptics, Modifier.width(60.dp).fillMaxHeight())
            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Control("RIGHT CLICK", Modifier.fillMaxWidth().height(84.dp), haptics, RoundedCornerShape(22.dp),
                    feel = Feel.Thud, labelSize = 14) { hid.setMouseButton(1, it) }
                Control("CLICK", Modifier.fillMaxWidth().weight(1f), haptics, RoundedCornerShape(28.dp),
                    feel = Feel.Click, labelSize = 18) { hid.setMouseButton(0, it) }
            }
            if (!left) ScrollStrip(hid, haptics, Modifier.width(60.dp).fillMaxHeight())
        }
    }
}

/** A thumb-drag wheel with detents: one notch = one scroll step = one fine tick. */
@Composable
private fun ScrollStrip(hid: HidController, haptics: HapticEngine, modifier: Modifier) {
    val accent = LocalAccent.current
    val notchPx = with(LocalDensity.current) { 18.dp.toPx() }
    val notches = remember { ScrollNotches(notchPx) }
    var offset by remember { mutableFloatStateOf(0f) }
    var active by remember { mutableStateOf(false) }
    Box(
        modifier.clip(RoundedCornerShape(30.dp))
            .background(accent.copy(alpha = if (active) 0.16f else 0.05f))
            .border(1.5.dp, accent.copy(alpha = if (active) 0.9f else 0.4f), RoundedCornerShape(30.dp))
            .pointerInput(Unit) {
                awaitEachGesture {
                    var last = awaitFirstDown().position.y
                    active = true; notches.reset()
                    while (true) {
                        val ev = awaitPointerEvent()
                        val c = ev.changes.firstOrNull() ?: break
                        if (!c.pressed) break
                        val dy = c.position.y - last; last = c.position.y
                        offset += dy
                        val n = notches.drag(dy)
                        if (n != 0) {
                            hid.scroll(n.toFloat())
                            repeat(kotlin.math.abs(n)) { haptics.play(Feel.Notch) }
                        }
                        c.consume()
                    }
                    active = false
                }
            },
    ) {
        // Notch lines that slide with the thumb, like a wheel's ridges.
        Canvas(Modifier.fillMaxSize()) {
            val step = notchPx
            var y = ((offset % step) + step) % step
            while (y < size.height) {
                drawLine(accent.copy(alpha = 0.35f), Offset(size.width * 0.3f, y), Offset(size.width * 0.7f, y), 2.dp.toPx())
                y += step
            }
        }
    }
}
