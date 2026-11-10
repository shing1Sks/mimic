package dev.mimic.ui

import android.app.Activity
import android.graphics.Rect
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import dev.mimic.Settings
import dev.mimic.haptics.Feel
import dev.mimic.haptics.HapticEngine
import dev.mimic.ui.kit.LocalAccent
import dev.mimic.ui.kit.Mode
import dev.mimic.ui.kit.Palette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val EXIT_HOLD_MS = 600
private const val DIM_AFTER_MS = 20_000L
private const val DIM_LEVEL = 0.15f

/**
 * Wraps every controller mode: full screen and near-black, the mode's accent colour, no
 * accidental exits (system back is swallowed and edge-swipe gestures are excluded where the
 * controls are), a hold-to-exit corner button, a "hold it like this" card the first few times,
 * and the screen dims when untouched to save battery.
 *
 * [exclusionBand] is the vertical span (fraction of height) where edge swipes must not
 * trigger system back: Android allows 200 dp per edge, so put it over the controls.
 */
@Composable
fun ModeShell(
    mode: Mode,
    settings: Settings,
    haptics: HapticEngine,
    onExit: () -> Unit,
    exclusionBand: ClosedFloatingPointRange<Float> = 0.6f..0.95f,
    /** Two-handed modes put exit at the top centre; one-handed ones at the thumb-side corner. */
    exitAtTopCentre: Boolean = false,
    content: @Composable () -> Unit,
) {
    val activity = LocalContext.current as Activity
    val view = LocalView.current
    val density = LocalDensity.current
    val accent = Color(Palette.accent(settings.theme.value, mode))
    var lastTouch by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var dimmed by remember { mutableStateOf(false) }

    // Immersive: no status or navigation bars while playing.
    DisposableEffect(Unit) {
        val c = WindowCompat.getInsetsController(activity.window, view)
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        c.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            c.show(WindowInsetsCompat.Type.systemBars())
            view.systemGestureExclusionRects = emptyList()
            setBrightness(activity, null)
        }
    }

    // Dim after a while untouched; any touch brings full brightness back.
    LaunchedEffect(lastTouch) {
        if (dimmed) { setBrightness(activity, null); dimmed = false }
        delay(DIM_AFTER_MS)
        setBrightness(activity, DIM_LEVEL); dimmed = true
    }

    BackHandler(enabled = true) { /* swallowed: leave with the hold-to-exit button */ }

    CompositionLocalProvider(LocalAccent provides accent) {
        Box(
            Modifier.fillMaxSize().background(Color(Palette.bg))
                .onGloballyPositioned { c ->
                    val h = c.size.height; val w = c.size.width
                    val maxBand = with(density) { 200.dp.roundToPx() }
                    val top = (h * exclusionBand.start).toInt()
                    val bottom = minOf((h * exclusionBand.endInclusive).toInt(), top + maxBand)
                    val edge = with(density) { 32.dp.roundToPx() }
                    view.systemGestureExclusionRects = listOf(Rect(0, top, edge, bottom), Rect(w - edge, top, w, bottom))
                }
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) { awaitPointerEvent(PointerEventPass.Initial); lastTouch = System.currentTimeMillis() }
                    }
                },
        ) {
            content()
            // Thumb-side top corner: reachable one-handed; hold-to-exit makes brushes harmless.
            val corner = when {
                exitAtTopCentre -> Alignment.TopCenter
                settings.leftHanded.value -> Alignment.TopStart
                else -> Alignment.TopEnd
            }
            ExitButton(Modifier.align(corner).padding(10.dp), haptics, onExit)
            GripCard(mode, settings)
        }
    }
}

private fun setBrightness(a: Activity, level: Float?) {
    val lp = a.window.attributes
    lp.screenBrightness = level ?: WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
    a.window.attributes = lp
}

/** Small corner button: hold for [EXIT_HOLD_MS] while a ring fills. A brush never exits. */
@Composable
private fun ExitButton(modifier: Modifier, haptics: HapticEngine, onExit: () -> Unit) {
    val accent = LocalAccent.current
    val fill = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    Box(
        modifier.size(40.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.04f))
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    haptics.play(Feel.Release)
                    val job = scope.launch {
                        fill.animateTo(1f, tween(EXIT_HOLD_MS, easing = LinearEasing))
                        haptics.play(Feel.Thud); onExit()
                    }
                    waitForUpOrCancellation()
                    if (fill.value < 1f) { job.cancel(); scope.launch { fill.snapTo(0f) } }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(28.dp)) {
            val st = 2.dp.toPx()
            drawCircle(accent.copy(alpha = 0.25f), style = Stroke(st))
            drawArc(accent, -90f, 360f * fill.value, false, style = Stroke(st),
                topLeft = Offset(st / 2, st / 2), size = Size(size.width - st, size.height - st))
            val c = 4.dp.toPx(); val m = center
            drawLine(accent.copy(alpha = 0.7f), Offset(m.x - c, m.y - c), Offset(m.x + c, m.y + c), st)
            drawLine(accent.copy(alpha = 0.7f), Offset(m.x + c, m.y - c), Offset(m.x - c, m.y + c), st)
        }
    }
}

private fun gripText(mode: Mode) = when (mode) {
    Mode.Point -> "Hold it flat like a remote, top toward the laptop.\nYour thumb rests at the bottom."
    Mode.Wand -> "Hold it upright like a remote.\nPoint the top at the screen and tap Center."
    Mode.Pad -> "Turn it sideways and hold it in both hands.\nThe stick appears where your left thumb lands."
    Mode.Grip -> "Hold it in your fist, top toward the screen,\nvolume keys under your finger. Vol down fires, vol up reloads."
}

/** "Hold it like this", shown the first 3 times a mode opens, for 2.5 s or until tapped. */
@Composable
private fun GripCard(mode: Mode, settings: Settings) {
    var show by remember { mutableStateOf(settings.gripCardShown(mode) < 3) }
    LaunchedEffect(Unit) {
        if (show) { settings.markGripCardShown(mode); delay(2500); show = false }
    }
    if (!show) return
    val accent = LocalAccent.current
    Box(
        Modifier.fillMaxSize().background(Color(0xE60A0B0D)).clickable { show = false },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(mode.name.uppercase(), style = Title.copy(color = accent))
            Text(gripText(mode), style = Label.copy(textAlign = TextAlign.Center), modifier = Modifier.padding(horizontal = 32.dp))
            Text("tap to start", style = Caption)
        }
    }
}

/**
 * Runs [onPause] when the app leaves the foreground (screen lock, app switch) and [onResume]
 * when it comes back. Controllers must go quiet when you aren't looking at them: no pointer
 * drift from a pocketed phone, no button left held down on the laptop.
 */
@Composable
fun WhileForeground(onPause: () -> Unit, onResume: () -> Unit) {
    val owner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, ev ->
            when (ev) {
                androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> onPause()
                androidx.lifecycle.Lifecycle.Event.ON_RESUME -> onResume()
                else -> {}
            }
        }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }
}

/**
 * Small "reconnecting" note inside a mode while the link to the laptop is down (the keeper in
 * HidController retries on its own; nothing to press). Top corner opposite the exit button.
 */
@Composable
fun BoxScope.ReconnectBadge(hid: dev.mimic.hid.HidController, leftHanded: Boolean) {
    if (hid.status == dev.mimic.hid.HidController.Status.Connected) return
    val text = if (hid.reconnecting != null) "reconnecting..." else "not connected"
    Text(
        text, style = Caption.copy(fontSize = 11.sp, color = Ink.warn),
        modifier = Modifier.align(if (leftHanded) Alignment.TopEnd else Alignment.TopStart).padding(14.dp),
    )
}
