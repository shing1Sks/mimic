package dev.mimic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.mimic.Settings
import dev.mimic.dsu.DsuServer
import dev.mimic.haptics.Feel
import dev.mimic.haptics.HapticEngine
import dev.mimic.hid.HidController
import dev.mimic.hid.MotionButton
import dev.mimic.motion.MotionFeed
import dev.mimic.ui.kit.Control
import kotlinx.coroutines.delay

/**
 * Wand: the motion controller. Held upright like a remote, top toward the screen. The thumb
 * sweeps the middle of the screen: D-pad above, A and B under the thumb, small buttons below,
 * Center at the bottom. Orientation and buttons go over Bluetooth; game rumble comes back.
 */
@Composable
fun WandScreen(hid: HidController, dsu: DsuServer, s: Settings, haptics: HapticEngine) {
    val ctx = LocalContext.current
    var buttons by remember { mutableIntStateOf(0) }
    var advanced by remember { mutableStateOf(false) }
    val feed = remember { MotionFeed(ctx, hid, dsu, s, onSwing = { haptics.play(Feel.Swing) }) }

    WhileForeground(
        onPause = { feed.stop(); feed.buttons = 0; buttons = 0; hid.setMotion(0, IntArray(6)) },
        onResume = { feed.start() },
    )
    DisposableEffect(Unit) {
        dsu.start()   // the motion feed is started by WhileForeground (replays ON_RESUME)
        hid.onRumble = { r -> haptics.rumble(r.strength, r.ms, r.pattern) }
        onDispose {
            hid.onRumble = null
            feed.stop(); feed.buttons = 0; hid.setMotion(0, IntArray(6))
        }
    }

    fun key(bit: Int): (Boolean) -> Unit = { d ->
        buttons = if (d) buttons or (1 shl bit) else buttons and (1 shl bit).inv()
        feed.buttons = buttons
        if (bit == MotionButton.CENTER && d) feed.recenter()
    }
    val sq = RoundedCornerShape(16.dp)
    val left = s.leftHanded.value

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("point the top at the screen", style = Caption, modifier = Modifier.padding(top = 18.dp))
            Spacer(Modifier.weight(0.6f))
            // D-pad: a cross, above where the thumb rests.
            Box(Modifier.size(168.dp)) {
                Control("UP", Modifier.size(58.dp).align(Alignment.TopCenter), haptics, sq, Feel.Notch, labelSize = 11, onChange = key(MotionButton.UP))
                Control("LEFT", Modifier.size(58.dp).align(Alignment.CenterStart), haptics, sq, Feel.Notch, labelSize = 11, onChange = key(MotionButton.LEFT))
                Control("RIGHT", Modifier.size(58.dp).align(Alignment.CenterEnd), haptics, sq, Feel.Notch, labelSize = 11, onChange = key(MotionButton.RIGHT))
                Control("DOWN", Modifier.size(58.dp).align(Alignment.BottomCenter), haptics, sq, Feel.Notch, labelSize = 11, onChange = key(MotionButton.DOWN))
            }
            Spacer(Modifier.height(26.dp))
            // A and B: the big ones, where the thumb lives. B sits toward the thumb's base.
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.Bottom) {
                val a: @Composable () -> Unit = { Control("A", Modifier.size(128.dp), haptics, feel = Feel.Click, labelSize = 30, onChange = key(MotionButton.A)) }
                val b: @Composable () -> Unit = { Control("B", Modifier.padding(top = 40.dp).size(100.dp), haptics, feel = Feel.Thud, labelSize = 24, onChange = key(MotionButton.B)) }
                if (left) { b(); a() } else { a(); b() }
            }
            Spacer(Modifier.height(26.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Control("-", Modifier.size(70.dp, 40.dp), haptics, feel = Feel.Notch, onChange = key(MotionButton.MINUS))
                Control("HOME", Modifier.size(80.dp, 40.dp), haptics, feel = Feel.Thud, labelSize = 12, onChange = key(MotionButton.HOME))
                Control("+", Modifier.size(70.dp, 40.dp), haptics, feel = Feel.Notch, onChange = key(MotionButton.PLUS))
            }
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                Control("1", Modifier.size(58.dp), haptics, onChange = key(MotionButton.ONE))
                Control("2", Modifier.size(58.dp), haptics, onChange = key(MotionButton.TWO))
            }
            Spacer(Modifier.weight(0.4f))
            Control("CENTER", Modifier.fillMaxWidth().height(52.dp), haptics, RoundedCornerShape(26.dp),
                feel = Feel.Thud, labelSize = 13, onChange = key(MotionButton.CENTER))
            Text(
                "Advanced: Dolphin over Wi-Fi", style = Caption,
                modifier = Modifier.padding(top = 10.dp).clickable { advanced = true },
            )
        }
        if (advanced) DolphinSheet(dsu, s) { advanced = false }
    }
}

/** Optional true-gyro link for Dolphin (DSU over Wi-Fi), tucked away from the controller. */
@Composable
private fun DolphinSheet(dsu: DsuServer, s: Settings, onClose: () -> Unit) {
    var clients by remember { mutableIntStateOf(0) }
    val ip = remember { DsuServer.localIp() }
    LaunchedEffect(Unit) { while (true) { clients = dsu.clientCount; delay(500) } }
    Box(Modifier.fillMaxSize().background(Color(0xF00A0B0D)).clickable(onClick = onClose)) {
        Column(
            Modifier.fillMaxWidth().align(Alignment.BottomCenter).verticalScroll(rememberScrollState()).padding(16.dp)
                .clickable(enabled = false) {},
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Panel {
                Text("Dolphin over Wi-Fi", style = Label)
                Text(
                    "Only needed for Wii games that use true gyro (MotionPlus). Bluetooth already covers " +
                        "buttons, pointing, tilt and swing. In Dolphin: Controllers > Alternate Input Sources > " +
                        "DSU Client, add ${ip ?: "(no Wi-Fi)"} : ${DsuServer.DEFAULT_PORT}.",
                    style = Caption,
                )
                Text(if (clients > 0) "Dolphin connected" else "Dolphin not connected", style = Caption.copy(color = if (clients > 0) Ink.good else Ink.dim))
                ToggleRow("Invert pitch", s.dsuInvertPitch.value) { s.dsuInvertPitch.value = it }
                ToggleRow("Invert yaw", s.dsuInvertYaw.value) { s.dsuInvertYaw.value = it }
                ToggleRow("Invert roll", s.dsuInvertRoll.value) { s.dsuInvertRoll.value = it }
                ActionButton("Close", Modifier.fillMaxWidth(), onClick = onClose)
            }
        }
    }
}
