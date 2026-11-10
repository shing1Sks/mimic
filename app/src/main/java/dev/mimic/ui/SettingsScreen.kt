package dev.mimic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.mimic.Settings
import dev.mimic.haptics.Feel
import dev.mimic.haptics.HapticEngine
import dev.mimic.ui.kit.Mode
import dev.mimic.ui.kit.Palette
import dev.mimic.ui.kit.ThemeName

@Composable
fun SettingsScreen(s: Settings, haptics: HapticEngine, onAbout: () -> Unit) = Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp),
) {
    var confirmReset by remember { mutableStateOf(false) }
    Text("Settings", style = Title)

    Text("Look", style = Caption)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        ThemeName.entries.forEach { t ->
            ThemeCard(t, selected = s.theme.value == t, Modifier.weight(1f)) { s.theme.value = t; haptics.play(Feel.Click) }
        }
    }

    Text("Feel", style = Caption)
    Panel {
        ToggleRow("Vibration (buttons and game rumble)", s.haptics.value) { s.haptics.value = it; if (it) haptics.play(Feel.Click) }
        if (s.haptics.value) {
            SliderRow("Vibration strength", s.hapticStrength.value, 0f..1f) { s.hapticStrength.value = it }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ActionButton("Try click", Modifier.weight(1f)) { haptics.play(Feel.Click) }
                ActionButton("Try thud", Modifier.weight(1f)) { haptics.play(Feel.Thud) }
                ActionButton("Try hit", Modifier.weight(1f)) { haptics.rumble(255, 120, 0) }
            }
        }
        ToggleRow("Left-handed (mirror layouts)", s.leftHanded.value) { s.leftHanded.value = it }
    }

    Text("Point", style = Caption)
    Panel {
        SliderRow("Pointer speed", s.sensitivity.value, 0.2f..4f) { s.sensitivity.value = it }
        ToggleRow("Sleep when put down", s.pointerSleep.value) { s.pointerSleep.value = it }
        ToggleRow("Invert X", s.invertX.value) { s.invertX.value = it }
        ToggleRow("Invert Y", s.invertY.value) { s.invertY.value = it }
    }

    Text("Pad", style = Caption)
    Panel {
        SliderRow("Button size", s.padScale.value, 0.8f..1.3f) { s.padScale.value = it }
        SliderRow("Button visibility", s.padOpacity.value, 0.3f..1f) { s.padOpacity.value = it }
        ToggleRow("Stick follows thumb past the edge", s.stickFollow.value) { s.stickFollow.value = it }
        ToggleRow("Feel stick directions", s.stickTicks.value) { s.stickTicks.value = it }
        ToggleRow("Aim right stick by turning the phone", s.gyroAim.value) { s.gyroAim.value = it }
        ToggleRow("Steer left stick by tilting", s.tiltSteer.value) { s.tiltSteer.value = it }
    }

    Text("Wand and Grip", style = Caption)
    Panel {
        ToggleRow("Wand: tap the back of the phone for B (experimental)", s.backTap.value) { s.backTap.value = it }
        // No speed slider on purpose: these send the phone's real angle and the game maps it 1:1.
        Text("Wand and Grip send the phone's real angle, so aim speed is set in each game, not here.", style = Caption)
    }

    Panel {
        ActionButton(if (confirmReset) "Tap again to reset" else "Reset settings to defaults", Modifier.fillMaxWidth()) {
            if (confirmReset) { s.resetToDefaults(); confirmReset = false; haptics.play(Feel.Thud) } else confirmReset = true
        }
        Text(
            if (confirmReset) "Resets everything on this page. Your paired PC stays paired."
            else "Look, vibration, pointer and pad settings go back to how they were at install.",
            style = Caption,
        )
    }

    Panel {
        ActionButton("About, help and licences", Modifier.fillMaxWidth(), onClick = onAbout)
        Text("Mimic ${dev.mimic.BuildConfig.VERSION_NAME}. How to pair, update check, links.", style = Caption)
    }
    Box(Modifier.height(12.dp))
}

/** Shows each theme as its three mode colours, so the choice is visible, not described. */
@Composable
private fun ThemeCard(t: ThemeName, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val home = Color(Palette.accent(t, null))
    Column(
        modifier.clip(RoundedCornerShape(14.dp)).background(Ink.panel)
            .border(if (selected) 2.dp else 1.dp, if (selected) home else Ink.line, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Mode.entries.forEach { m ->
                Box(Modifier.size(14.dp).clip(CircleShape).background(Color(Palette.accent(t, m))))
            }
        }
        Text(t.name, style = Label.copy(color = if (selected) home else Ink.text))
    }
}
