package dev.mimic.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.mimic.ui.kit.LocalAccent

/** One small, consistent set of colours and components for every screen. */
object Ink {
    val bg = Color(0xFF0A0B0D)
    val panel = Color(0xFF17191E)
    val raised = Color(0xFF22252C)
    val line = Color(0xFF2C3038)
    val text = Color(0xFFE8EAEE)
    val dim = Color(0xFF8A909C)
    val accent = Color(0xFF7CC4FF)
    val good = Color(0xFF6FD39A)
    val warn = Color(0xFFF2B866)
    val pressed = Color(0xFF34506A)
}

@Composable
fun MimicTheme(content: @Composable () -> Unit) = MaterialTheme(
    colorScheme = darkColorScheme(
        primary = LocalAccent.current, background = Ink.bg, surface = Ink.panel,
        onPrimary = Ink.bg, onBackground = Ink.text, onSurface = Ink.text,
    ),
    content = content,
)

/**
 * The back button of the list screens (Settings, About): the system back gesture is invisible, so
 * these screens show one too. Modes have none on purpose: they leave only with hold-to-exit, so a
 * grip or a swing never exits by accident.
 */
@Composable
fun BackButton(onBack: () -> Unit) = Box(
    Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(Ink.raised).clickable(onClick = onBack)
        .semantics { contentDescription = "Back"; role = Role.Button },
    contentAlignment = Alignment.Center,
) {
    Canvas(Modifier.size(16.dp)) {
        val w = size.width; val h = size.height
        val p = Path().apply { moveTo(w * 0.68f, h * 0.08f); lineTo(w * 0.24f, h * 0.5f); lineTo(w * 0.68f, h * 0.92f) }
        drawPath(p, Ink.text, style = Stroke(2.4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

val Title = TextStyle(color = Ink.text, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
val Label = TextStyle(color = Ink.text, fontSize = 15.sp, fontWeight = FontWeight.Medium)
val Caption = TextStyle(color = Ink.dim, fontSize = 13.sp)

@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable () -> Unit) = Column(
    modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Ink.panel).padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
) { content() }

@Composable
fun ActionButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) =
    Box(
        modifier.clip(RoundedCornerShape(12.dp))
            .background(if (enabled) Ink.raised else Ink.panel)
            .border(1.dp, Ink.line, RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = Label.copy(color = if (enabled) Ink.text else Ink.dim)) }

@Composable
fun SliderRow(label: String, value: Float, range: ClosedFloatingPointRange<Float>, onChange: (Float) -> Unit) =
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = Label)
            Text("%.2f".format(value), style = Caption)
        }
        Slider(
            value, onChange, valueRange = range,
            colors = SliderDefaults.colors(thumbColor = LocalAccent.current, activeTrackColor = LocalAccent.current, inactiveTrackColor = Ink.line),
        )
    }

@Composable
fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) = Row(
    Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween,
) {
    Text(label, style = Label, modifier = Modifier.weight(1f))
    Switch(
        checked, onChange,
        colors = SwitchDefaults.colors(checkedTrackColor = LocalAccent.current, checkedThumbColor = Ink.bg),
    )
}

@Composable
fun StatusDot(color: Color) = Box(Modifier.size(10.dp).clip(RoundedCornerShape(50)).background(color))
