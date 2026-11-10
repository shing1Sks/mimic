package dev.mimic.ui

import android.annotation.SuppressLint
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import dev.mimic.R
import dev.mimic.Settings
import dev.mimic.haptics.Feel
import dev.mimic.haptics.HapticEngine
import dev.mimic.hid.HidController
import dev.mimic.hid.HidDescriptor
import dev.mimic.hid.HidController.Status
import dev.mimic.ui.kit.Mode
import dev.mimic.ui.kit.Palette

/** Everything the app can show. Modes are controllers; Settings is a plain page. */
enum class Screen(val title: String, val blurb: String, val mode: Mode?) {
    Point("Point", "Air mouse. Hold it flat, point and click.", Mode.Point),
    Wand("Wand", "Motion controller. Swing, slash, aim.", Mode.Wand),
    Pad("Pad", "Gamepad. Two thumbs, sticks and buttons.", Mode.Pad),
    Grip("Grip", "One hand, phone in your fist. Point to aim, volume keys and flicks do the rest.", Mode.Grip),
    Settings("Settings", "", null),
    About("About", "", null),
}

@SuppressLint("MissingPermission")
@Composable
fun HomeScreen(
    hid: HidController,
    settings: Settings,
    haptics: HapticEngine,
    onPair: () -> Unit,
    onOpen: (Screen) -> Unit,
    /** The Nearby devices permission was refused: explain instead of showing a dead connection panel. */
    needsPermission: Boolean = false,
    permissionBlocked: Boolean = false,
    onAllow: () -> Unit = {},
) {
    var refresh by remember { mutableStateOf(0) }
    val bonded = remember(hid.status, refresh) {
        val all = hid.bondedDevices()
        all.filter { it.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.COMPUTER }.ifEmpty { all }
    }
    // Feel the link come and go without looking.
    var lastConnected by remember { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(hid.status) {
        val now = hid.status == Status.Connected
        if (lastConnected != null && lastConnected != now) haptics.play(if (now) Feel.ConnectUp else Feel.ConnectDown)
        lastConnected = now
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Image(painterResource(R.drawable.ic_mimic), contentDescription = null, modifier = Modifier.size(44.dp))
            Column(Modifier.weight(1f)) {
                Text("Mimic", style = Title)
                Text("The controller you left at home.", style = Caption)
            }
            Box(
                Modifier.size(40.dp).clip(CircleShape).clickable { onOpen(Screen.Settings) },
                contentAlignment = Alignment.Center,
            ) { GearGlyph() }
        }

        if (needsPermission) PermissionPanel(permissionBlocked, onAllow)
        else ConnectionPanel(hid, settings, bonded, onPair) { refresh++ }
        dev.mimic.update.UpdateCard()

        Screen.entries.filter { it.mode != null }.forEach { s ->
            val accent = Color(Palette.accent(settings.theme.value, s.mode))
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp))
                    .background(accent.copy(alpha = 0.06f))
                    .border(1.dp, accent.copy(alpha = 0.35f), RoundedCornerShape(20.dp))
                    .clickable { haptics.play(Feel.Click); onOpen(s) }
                    .padding(18.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                GripGlyph(s.mode!!, accent, Modifier.size(56.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(s.title, style = Title.copy(color = accent))
                    Text(s.blurb, style = Caption)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@SuppressLint("MissingPermission")
@Composable
private fun ConnectionPanel(hid: HidController, settings: Settings, bonded: List<BluetoothDevice>, onPair: () -> Unit, onRefresh: () -> Unit) =
    Panel {
        val (color, line) = when (hid.status) {
            Status.Connected -> Ink.good to "Connected to ${hid.host?.name ?: "laptop"}"
            Status.Ready -> Ink.warn to (hid.reconnecting?.let { "Reconnecting to $it..." } ?: "Not connected")
            Status.Registering -> Ink.warn to "Starting Bluetooth..."
            Status.Unsupported -> Ink.warn to "Bluetooth input not supported on this phone"
            Status.Off -> Ink.dim to "Bluetooth input off"
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatusDot(color)
            Text(line, style = Label)
        }
        hid.error?.let { Text(it, style = Caption.copy(color = Ink.warn)) }
        // Windows keeps the controls it learned at pairing; a changed descriptor needs a re-pair.
        if (hid.status == Status.Connected && settings.pairedDescriptor.value != HidDescriptor.version) {
            Text(
                "This version changed Mimic's Bluetooth controls. If buttons or vibration don't reach the laptop: " +
                    "on the laptop remove Mimic under Bluetooth devices, then pair again.",
                style = Caption.copy(color = Ink.warn),
            )
            ActionButton("Done, I paired again", Modifier.fillMaxWidth()) {
                settings.pairedDescriptor.value = HidDescriptor.version
            }
        }
        when (hid.status) {
            Status.Off -> ActionButton("Retry", Modifier.fillMaxWidth()) { hid.start() }
            Status.Connected -> ActionButton("Disconnect", Modifier.fillMaxWidth()) { hid.disconnect() }
            else -> {
                if (bonded.isNotEmpty() && hid.status == Status.Ready) {
                    bonded.forEach { d -> DeviceRow(d) { hid.connect(d); onRefresh() } }
                }
                ActionButton("Pair a new laptop", Modifier.fillMaxWidth(), enabled = hid.status == Status.Ready) { onPair() }
                Text("Then on the laptop: Settings > Bluetooth > Add device > this phone.", style = Caption)
            }
        }
    }

/** Why Mimic needs Nearby devices, and the one button that fixes it. */
@Composable
private fun PermissionPanel(blocked: Boolean, onAllow: () -> Unit) = Panel {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StatusDot(Ink.warn)
        Text("Mimic needs the Nearby devices permission", style = Label)
    }
    Text(
        "Mimic works by becoming a Bluetooth mouse and controller for your PC. Android calls that " +
            "\"Nearby devices\". Mimic uses it only to pair with and talk to your PC: it does not scan " +
            "for other devices, track your location or use the internet for it.",
        style = Caption,
    )
    if (blocked) Text(
        "Android won't ask again. In the settings page that opens, tap Permissions > Nearby devices > Allow, then come back.",
        style = Caption.copy(color = Ink.warn),
    )
    ActionButton(if (blocked) "Open app settings" else "Allow Nearby devices", Modifier.fillMaxWidth()) { onAllow() }
}

@SuppressLint("MissingPermission")
@Composable
private fun DeviceRow(d: BluetoothDevice, onClick: () -> Unit) = Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Ink.raised)
        .clickable(onClick = onClick).padding(14.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
) {
    Text(d.name ?: d.address, style = Label)
    Text("Connect", style = Caption.copy(color = Ink.good))
}

/** A tiny drawing of how the phone is held in each mode. */
@Composable
fun GripGlyph(mode: Mode, accent: Color, modifier: Modifier) = Canvas(modifier) {
    val st = Stroke(2.dp.toPx())
    val r = CornerRadius(6.dp.toPx())
    fun phone(w: Float, h: Float, angle: Float = 0f, extra: DrawScope.(Offset, Size) -> Unit = { _, _ -> }) {
        val tl = Offset(center.x - w / 2, center.y - h / 2)
        rotate(angle) {
            drawRoundRect(accent.copy(alpha = 0.12f), tl, Size(w, h), r)
            drawRoundRect(accent, tl, Size(w, h), r, style = st)
            extra(tl, Size(w, h))
        }
    }
    val u = size.minDimension
    when (mode) {
        // flat, tilted toward the screen, thumb at the bottom
        Mode.Point -> phone(u * 0.42f, u * 0.82f, -28f) { tl, s ->
            drawCircle(accent, u * 0.07f, Offset(tl.x + s.width * 0.6f, tl.y + s.height * 0.8f))
        }
        // upright, big A under the thumb
        Mode.Wand -> phone(u * 0.4f, u * 0.86f) { tl, s ->
            drawCircle(accent, u * 0.1f, Offset(tl.x + s.width / 2, tl.y + s.height * 0.45f), style = st)
        }
        // in the fist: top forward, a finger dot on the volume edge
        Mode.Grip -> phone(u * 0.86f, u * 0.36f, -8f) { tl, s ->
            drawCircle(accent, u * 0.06f, Offset(tl.x + s.width * 0.62f, tl.y + s.height + u * 0.1f))
        }
        // sideways, two thumbs
        Mode.Pad -> phone(u * 0.9f, u * 0.44f) { tl, s ->
            drawCircle(accent, u * 0.07f, Offset(tl.x + s.width * 0.22f, tl.y + s.height * 0.6f))
            drawCircle(accent, u * 0.07f, Offset(tl.x + s.width * 0.78f, tl.y + s.height * 0.45f))
        }
    }
}

@Composable
private fun GearGlyph() = Canvas(Modifier.size(22.dp)) {
    val st = Stroke(2.dp.toPx())
    drawCircle(Ink.dim, size.minDimension * 0.22f, style = st)
    for (i in 0 until 8) rotate(i * 45f) {
        drawLine(Ink.dim, Offset(center.x, size.height * 0.04f), Offset(center.x, size.height * 0.2f), 3.dp.toPx())
    }
    drawCircle(Ink.dim, size.minDimension * 0.36f, style = st)
}
