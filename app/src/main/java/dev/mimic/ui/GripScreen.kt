package dev.mimic.ui

import android.util.Log
import android.view.KeyEvent
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.pointerInput
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import dev.mimic.input.DeliberateTap
import dev.mimic.input.HeldBits
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.mimic.Settings
import dev.mimic.haptics.Feel
import dev.mimic.haptics.HapticEngine
import dev.mimic.hid.HidController
import dev.mimic.dsu.DsuServer
import dev.mimic.hid.MotionSig
import dev.mimic.motion.MotionFeed
import dev.mimic.input.GripGestures
import dev.mimic.input.GripGestures.Out
import dev.mimic.input.KeyRouter
import dev.mimic.motion.GripMotion
import dev.mimic.ui.kit.LocalAccent
import kotlinx.coroutines.delay

/**
 * Grip: one hand, the phone held in a fist: shooters, bowling, swinging games. In that grip only
 * the volume keys are under the fingers, so there are no on-screen buttons to hunt for.
 *
 * Grip always sends the Wand's motion report (marked as Grip in the axes' low bits, see
 * MotionSig), so every Mimic game reads it the same way. Point mode is the mouse.
 *   Vol Down = a (held); Vol Up tap = b, hold = center (align), double tap = one;
 *   flick sideways = two (dodge).
 * Centre button (top, away from the grip) = center: hold it how you like, press, that is
 * straight ahead.
 */
@Composable
fun GripScreen(activity: ComponentActivity, hid: HidController, s: Settings, haptics: HapticEngine, keys: KeyRouter) {
    var holding by remember { mutableStateOf(false) }
    var last by remember { mutableStateOf("") }
    val gestures = remember { GripGestures() }
    var mButtons by remember { mutableIntStateOf(0) }
    var volUpDown by remember { mutableStateOf(false) }
    val feed = remember { MotionFeed(activity, hid, DsuServer(), s, sigMode = MotionSig.GRIP) }

    // gesture bits (centre, b, one, two) last the whole press and at least HeldBits.MIN_MS, so a
    // Bluetooth stall cannot swallow them; a (Vol Down) is the raw key
    val held = remember { HeldBits() }
    fun now() = System.currentTimeMillis()
    fun sync() { feed.buttons = mButtons or held.bits(now()) }
    fun setBit(bit: Int, down: Boolean) {
        mButtons = if (down) mButtons or (1 shl bit) else mButtons and (1 shl bit).inv()
        sync()
    }
    /** [lasting]: the gesture's press is still going on (Vol Up held, CENTRE touched): hold the bit until it ends. */
    fun handle(outs: List<Out>, lasting: Boolean = false) = outs.forEach {
        val bit = GripGestures.button(it)
        Log.i("MimicGrip", "$it -> motion button $bit")
        // a tap (b) or a flick (two) has no press left to follow: those are always a pulse
        if (lasting && (it == Out.ALIGN || it == Out.SWITCH)) held.press(bit, now()) else held.pulse(bit, now())
        when (it) {
            Out.RELOAD -> { haptics.play(Feel.Click); last = "b (reload)" }
            Out.ALIGN -> { feed.recenter(); haptics.play(Feel.ConnectUp); last = "Aligned" }
            Out.SWITCH -> { haptics.play(Feel.Notch); last = "one (switch)" }
            Out.DODGE -> { haptics.play(Feel.Swing); last = "two (dodge)" }
        }
        sync()
    }
    /** The press behind a lasting gesture ended: its bit drops (once it has been up HeldBits.MIN_MS). */
    fun ended(vararg bits: Int) { bits.forEach { held.release(it, now()) }; sync() }
    val motion = remember {
        GripMotion(activity) { a, up -> handle(gestures.motion(a, now(), up)) }
    }
    fun stop() {
        motion.stop(); feed.stop()
        holding = false; mButtons = 0; held.clear(); feed.buttons = 0
        hid.setMotion(0, IntArray(6))   // neutral: games see no motion controller sending
    }

    WhileForeground(onPause = { stop() }, onResume = { stop(); feed.start(); motion.start() })
    LaunchedEffect(Unit) {
        while (true) {
            handle(gestures.tick(now()), lasting = volUpDown)   // a hold's align lasts while Vol Up stays down
            sync()                                           // drop bits whose time is up
            delay(30)
        }
    }
    DisposableEffect(Unit) {
        hid.onRumble = { r -> haptics.rumble(r.strength, r.ms, r.pattern) }
        keys.handler = { code, down ->
            when (code) {
                KeyEvent.KEYCODE_VOLUME_DOWN -> {          // a, held
                    if (down) haptics.play(Feel.Thud)
                    gestures.keyActivity(now())   // the press jolts the phone: not a dodge
                    setBit(GripGestures.TRIGGER, down)
                    holding = down; true
                }
                KeyEvent.KEYCODE_VOLUME_UP -> {
                    volUpDown = down
                    handle(gestures.volUp(down, now()), lasting = down)   // a double tap's switch lasts while held
                    if (!down) ended(GripGestures.button(Out.ALIGN), GripGestures.button(Out.SWITCH))
                    true
                }
                else -> false
            }
        }
        onDispose {
            hid.onRumble = null; keys.handler = null
            stop()
        }
    }

    val accent = LocalAccent.current
    Box(Modifier.fillMaxSize().padding(24.dp)) {
        // Top: at the barrel end, away from the hand wrapped round the bottom and the fingers on
        // the volume keys, so it is only pressed on purpose.
        CentreButton(Modifier.align(Alignment.TopCenter).padding(top = 12.dp), haptics,
            onCentre = { handle(listOf(Out.ALIGN), lasting = true) },
            onLift = { ended(GripGestures.button(Out.ALIGN)) })
        Column(
            Modifier.align(Alignment.Center),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(if (holding) "HOLDING" else "Ready", style = Title.copy(color = accent, fontSize = 30.sp))
            Text("Hold it the way you want to aim, point at the middle of the screen, then press Centre (or hold Vol Up).",
                style = Caption.copy(textAlign = TextAlign.Center))
            Box(Modifier.padding(top = 18.dp).background(accent.copy(alpha = 0.08f)).padding(16.dp)) {
                Text(
                    "Vol Down   a: fire / grab (hold)\n" +
                        "Vol Up     tap: b (reload)\n" +
                        "           hold: centre\n" +
                        "           double tap: one (switch)\n" +
                        "Flick sideways   two (dodge)",
                    style = Caption.copy(fontSize = 14.sp),
                )
            }
            Text(last, style = Caption.copy(color = accent))
        }
        Text(
            "For Mimic games in the browser. Want the laptop's mouse? Use Point mode.",
            style = Caption.copy(textAlign = TextAlign.Center, fontSize = 12.sp),
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * The one on-screen button: centre the aim. Normal button size; it fires once the press is a
 * real one (at least DeliberateTap.MIN_MS on the button), so a brushing finger never re-centres,
 * and the centre bit then stays up until the finger lifts (at least HeldBits.MIN_MS). No palm
 * check: the button sits at the top, away from the hand, and on some phones (POCO / HyperOS) a thumb reports a palm-sized contact, which silently ate every press.
 * Every touch lights the button and ticks, so a press can never look like nothing happened.
 */
@Composable
internal fun CentreButton(modifier: Modifier, haptics: HapticEngine, onCentre: () -> Unit, onLift: () -> Unit) {
    val accent = LocalAccent.current
    var down by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(18.dp)
    Box(
        modifier.size(176.dp, 60.dp).clip(shape)
            .background(accent.copy(alpha = if (down) 0.28f else 0.08f))
            .border(if (down) 2.dp else 1.5.dp, accent.copy(alpha = if (down) 1f else 0.55f), shape)
            .pointerInput(Unit) {
                awaitEachGesture {
                    val first = awaitFirstDown(requireUnconsumed = false)
                    val tap = DeliberateTap()
                    tap.down(first.uptimeMillis, palm = false)
                    down = true
                    haptics.play(Feel.Release)
                    Log.i("MimicGrip", "centre down")
                    // centre goes up as soon as the press is a real one (held DeliberateTap.MIN_MS on
                    // the button) and stays up until the finger lifts or slides off
                    var fired = false
                    var lastT = first.uptimeMillis
                    fun fire() { if (!fired) { fired = true; Log.i("MimicGrip", "centre on"); onCentre() } }
                    while (true) {
                        val wait = DeliberateTap.MIN_MS - (lastT - first.uptimeMillis)
                        val ev = if (fired || wait <= 0) awaitPointerEvent() else withTimeoutOrNull(wait) { awaitPointerEvent() }
                        if (ev == null) { fire(); continue }   // held long enough
                        val c = ev.changes.firstOrNull { it.id == first.id } ?: break
                        lastT = c.uptimeMillis
                        val inside = c.position.x >= 0f && c.position.y >= 0f &&
                            c.position.x <= size.width && c.position.y <= size.height
                        if (!c.pressed) { if (tap.up(c.uptimeMillis, inside)) fire(); c.consume(); break }
                        if (!inside) { tap.cancel(); break }
                        if (tap.ready(c.uptimeMillis)) fire()
                    }
                    down = false
                    Log.i("MimicGrip", "centre up fired=$fired")
                    if (fired) onLift()
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text("CENTRE", style = Label.copy(color = if (down) Color.White else accent))
    }
}
