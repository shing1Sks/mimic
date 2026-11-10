package dev.mimic.ui.kit

import android.view.MotionEvent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInteropFilter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.sp
import dev.mimic.haptics.Feel
import dev.mimic.haptics.HapticEngine
import dev.mimic.input.TouchClaim
import kotlinx.coroutines.launch

/** The current mode's accent colour; set by the mode shell / theme. */
val LocalAccent = compositionLocalOf { Color(Palette.accent(ThemeName.Chameleon, null)) }

/**
 * Every pressable thing in Mimic. On touch-down, in the same input event: the vibration fires,
 * [onChange] reports the press, the control lights from inside and gives way slightly, and a
 * ring ripples outward. Release gives a lighter vibration. A resting palm never presses it.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun Control(
    label: String,
    modifier: Modifier,
    haptics: HapticEngine,
    shape: Shape = RoundedCornerShape(50),
    feel: Feel = Feel.Click,
    release: Feel = Feel.Release,
    alpha: Float = 1f,
    labelSize: Int = 16,
    onChange: (Boolean) -> Unit,
) {
    val accent = LocalAccent.current
    val xdpi = LocalContext.current.resources.displayMetrics.xdpi
    var down by remember { mutableStateOf(false) }
    var myPointer by remember { mutableStateOf(-1) }
    var boxSize by remember { mutableStateOf(IntSize.Zero) }
    val ripple = remember { Animatable(1f) }
    val scope = rememberCoroutineScope()
    val scale by animateFloatAsState(if (down) 0.94f else 1f, tween(if (down) 50 else 120), label = "press")

    fun press(d: Boolean) {
        if (d == down) return
        down = d
        haptics.play(if (d) feel else release)
        onChange(d)
        if (d) scope.launch { ripple.snapTo(0f); ripple.animateTo(1f, tween(450)) }
    }

    Box(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale; this.alpha = alpha }
            .drawBehind {
                val p = ripple.value
                if (p < 1f) scale(1f + 0.55f * p) {
                    drawOutline(shape.createOutline(size, layoutDirection, this), accent.copy(alpha = 0.8f * (1f - p)), style = Stroke(2.dp.toPx()))
                }
            }
            .clip(shape)
            .background(accent.copy(alpha = if (down) 0.30f else 0.06f))
            .border(if (down) 2.dp else 1.5.dp, accent.copy(alpha = if (down) 1f else 0.5f), shape)
            .onSizeChanged { boxSize = it }
            .pointerInteropFilter { e ->
                // Track our own finger: with several thumbs on the glass, events can carry
                // pointers that belong to other controls.
                val i = e.actionIndex
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                        if (!down && TouchClaim.canClaim(myPointer, e.getX(i), e.getY(i), boxSize.width, boxSize.height, e.getTouchMajor(i), xdpi)) {
                            myPointer = e.getPointerId(i); press(true)
                        }
                    }
                    MotionEvent.ACTION_POINTER_UP -> if (e.getPointerId(i) == myPointer) { myPointer = -1; press(false) }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { myPointer = -1; press(false) }
                }
                true
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = TextStyle(
                color = if (down) Color.White else accent.copy(alpha = 0.9f),
                fontSize = labelSize.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp,
            ),
        )
    }
}
