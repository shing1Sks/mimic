package dev.mimic.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.mimic.BuildConfig
import dev.mimic.ui.ActionButton
import dev.mimic.ui.Caption
import dev.mimic.ui.Ink
import dev.mimic.ui.Label
import dev.mimic.ui.Panel
import kotlinx.coroutines.launch
import java.io.File

private sealed interface Step {
    data object Offer : Step
    data class Downloading(val progress: Float) : Step
    /** Downloaded and verified; Android still needs "allow from this source". */
    data class NeedsPermission(val apk: File) : Step
    data class Failed(val message: String) : Step
}

/**
 * "Update available" card for Home. Draws nothing unless a newer release exists (and never in
 * debug builds, which are signed with a different key and could not take the update).
 */
@Composable
fun UpdateCard() {
    if (!BuildConfig.UPDATE_CHECK) return
    val ctx = LocalContext.current.applicationContext
    val updater = remember { Updater(ctx) }
    var info by remember { mutableStateOf<UpdateInfo?>(null) }
    var step by remember { mutableStateOf<Step>(Step.Offer) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { info = updater.check() }
    val u = info ?: return

    fun installOrAsk(apk: File) {
        if (updater.canInstall()) {
            runCatching { updater.install(apk) }
                .onSuccess { step = Step.Offer }
                .onFailure { step = Step.Failed(it.message ?: "Could not open the installer") }
        } else {
            step = Step.NeedsPermission(apk)
            updater.openInstallPermission()
        }
    }

    Panel {
        Text("Update available: Mimic ${u.versionName}", style = Label)
        if (u.notes.isNotBlank()) Text(u.notes.lineSequence().take(3).joinToString("\n"), style = Caption)
        when (val s = step) {
            is Step.Downloading -> Text("Downloading... ${(s.progress * 100).toInt()}%", style = Caption)
            is Step.NeedsPermission -> Text(
                "Allow Mimic to install apps on the page that opened, then come back and tap Install.",
                style = Caption.copy(color = Ink.warn),
            )
            is Step.Failed -> Text(s.message, style = Caption.copy(color = Ink.warn))
            Step.Offer -> {}
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val busy = step is Step.Downloading
            val primary = when {
                u.sha256 == null -> "Open release page"
                step is Step.NeedsPermission -> "Install"
                else -> "Update"
            }
            ActionButton(primary, Modifier.weight(1f), enabled = !busy) {
                val s = step
                when {
                    u.sha256 == null -> updater.openPage(u.pageUrl ?: "https://github.com/${UpdateSource.GITHUB_REPO}/releases/latest")
                    s is Step.NeedsPermission -> installOrAsk(s.apk)
                    else -> scope.launch {
                        step = Step.Downloading(0f)
                        runCatching { updater.download(u) { p -> step = Step.Downloading(p) } }
                            .onSuccess { installOrAsk(it) }
                            .onFailure { step = Step.Failed(it.message ?: "Download failed") }
                    }
                }
            }
            ActionButton("Later", enabled = !busy) {
                updater.dismiss(u)
                info = null
            }
        }
    }
}
