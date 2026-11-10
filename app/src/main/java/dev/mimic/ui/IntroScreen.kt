package dev.mimic.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.mimic.R
import dev.mimic.ui.kit.LocalAccent

/** First launch only: who Mimic is, then how to pair, in three steps. */
@Composable
fun IntroScreen(onPair: () -> Unit, onDone: () -> Unit) {
    var page by remember { mutableIntStateOf(0) }
    val accent = LocalAccent.current
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Spacer(Modifier.weight(1f))
        if (page == 0) {
            Image(painterResource(R.drawable.ic_mimic), null, Modifier.size(160.dp))
            Text("Mimic", style = Title.copy(fontSize = 34.sp, color = accent))
            Text(
                "Like the octopus that shape-shifts into other creatures, your phone becomes " +
                    "the mouse, motion controller or gamepad you left at home.",
                style = Label.copy(textAlign = TextAlign.Center, color = Ink.dim),
            )
        } else {
            Text("Pair with your laptop", style = Title)
            Step(1, "Tap \"Make this phone visible\" below and allow it. It stays visible for 2 minutes.")
            Step(2, "On the laptop: Settings > Bluetooth & devices > Add device > Bluetooth, then pick this phone.")
            Step(3, "Confirm the same code on both screens. Done, the laptop now sees a mouse, a gamepad and a motion controller.")
            ActionButton("Make this phone visible", Modifier.fillMaxWidth()) { onPair() }
            Text(
                "Paired this phone with Mimic before, or the PC can't see it? Remove the phone under Bluetooth " +
                    "devices on the PC, then pair again. Help is also in Settings > About.",
                style = Caption.copy(textAlign = TextAlign.Center),
            )
        }
        Spacer(Modifier.weight(1f))
        ActionButton(if (page == 0) "Next" else "Start", Modifier.fillMaxWidth()) {
            if (page == 0) page = 1 else onDone()
        }
        if (page == 1) Text("Already paired? Tap Start.", style = Caption)
    }
}

@Composable
private fun Step(n: Int, text: String) = Row(
    Modifier.fillMaxWidth(),
    horizontalArrangement = Arrangement.spacedBy(14.dp),
    verticalAlignment = Alignment.Top,
) {
    Box(
        Modifier.size(28.dp).clip(CircleShape).background(LocalAccent.current.copy(alpha = 0.18f)),
        contentAlignment = Alignment.Center,
    ) { Text("$n", style = Label.copy(color = LocalAccent.current)) }
    Text(text, style = Label, modifier = Modifier.weight(1f).padding(top = 3.dp))
}
