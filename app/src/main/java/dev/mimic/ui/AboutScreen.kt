package dev.mimic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.mimic.BuildConfig
import dev.mimic.R
import dev.mimic.update.CheckResult
import dev.mimic.update.UpdateSource
import dev.mimic.update.Updater
import kotlinx.coroutines.launch

private const val SITE_URL = "https://mimic.shing.in"
private const val REPO_URL = "https://github.com/${UpdateSource.GITHUB_REPO}"
private const val RELEASES_URL = "$REPO_URL/releases/latest"
private const val TRAY_URL = "$REPO_URL#windows-tray-helper-windows"

/** What the update row shows. */
private sealed interface UpdateRow {
    data object Idle : UpdateRow
    data object Checking : UpdateRow
    data class Done(val result: CheckResult) : UpdateRow
}

/**
 * About and help: version, update check, how to pair, what the less obvious buttons do, links,
 * and the licences. Reached from Settings.
 */
@Composable
fun AboutScreen(onShowUpdateOnHome: () -> Unit, onBack: () -> Unit) {
    val ctx = LocalContext.current.applicationContext
    val updater = remember { Updater(ctx) }
    val scope = rememberCoroutineScope()
    var row by remember { mutableStateOf<UpdateRow>(UpdateRow.Idle) }
    var showMit by remember { mutableStateOf(false) }
    var showApache by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        BackButton(onBack)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Image(painterResource(R.drawable.ic_mimic), contentDescription = null, modifier = Modifier.size(44.dp))
            Column {
                Text("About Mimic", style = Title)
                Text(
                    "Version ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})" +
                        if (BuildConfig.DEBUG) ", debug build" else "",
                    style = Caption,
                )
            }
        }

        Text("Updates", style = Caption)
        Panel {
            val (line, warn) = when (val r = row) {
                UpdateRow.Idle -> (if (BuildConfig.UPDATE_CHECK) "Checks once a day." else "Debug build: no automatic updates.") to false
                UpdateRow.Checking -> "Checking..." to false
                is UpdateRow.Done -> when (val res = r.result) {
                    CheckResult.UpToDate -> "You have the latest version." to false
                    is CheckResult.Available -> "Mimic ${res.info.versionName} is available." to false
                    CheckResult.Failed -> "Couldn't connect. Try again later." to true
                }
            }
            Text(line, style = Label.copy(color = if (warn) Ink.warn else Ink.text))
            val available = (row as? UpdateRow.Done)?.result as? CheckResult.Available
            if (available != null) {
                if (BuildConfig.UPDATE_CHECK && available.info.sha256 != null) {
                    ActionButton("Update from Home", Modifier.fillMaxWidth()) { updater.undismiss(); onShowUpdateOnHome() }
                } else {
                    ActionButton("Open the release page", Modifier.fillMaxWidth()) {
                        openUrl(ctx, available.info.pageUrl ?: RELEASES_URL)
                    }
                }
            }
            ActionButton("Check for updates", Modifier.fillMaxWidth(), enabled = row != UpdateRow.Checking) {
                row = UpdateRow.Checking
                scope.launch { row = UpdateRow.Done(updater.checkNow()) }
            }
        }

        Text("How to pair", style = Caption)
        Panel {
            Text("1. On Home, tap Pair a new laptop.", style = Label)
            Text("2. On Windows: Settings > Bluetooth > Add device, pick this phone.", style = Label)
            Text("3. Confirm the code. Mimic reconnects by itself after that.", style = Label)
            Text("Not showing up? Remove the phone on the PC and pair again.", style = Caption)
        }

        Text("Point's CENTRE button", style = Caption)
        Panel {
            Text("Needs the Mimic tray app on Windows.", style = Label)
            LinkRow("Get the tray app") { openUrl(ctx, TRAY_URL) }
        }

        Text("Links", style = Caption)
        Panel {
            LinkRow("mimic.shing.in") { openUrl(ctx, SITE_URL) }
            LinkRow("Source code") { openUrl(ctx, REPO_URL) }
            LinkRow("Report a problem") { openUrl(ctx, "$REPO_URL/issues") }
        }

        Text("Licences", style = Caption)
        Panel {
            Text("Mimic is open source (MIT). It uses Kotlin, AndroidX and Jetpack Compose (Apache 2.0).", style = Caption)
            LinkRow(if (showMit) "Hide MIT licence" else "MIT licence") { showMit = !showMit }
            if (showMit) LicenceText(ctx, R.raw.licence_mit)
            LinkRow(if (showApache) "Hide Apache 2.0 licence" else "Apache 2.0 licence") { showApache = !showApache }
            if (showApache) LicenceText(ctx, R.raw.apache_2_0)
        }
        Box(Modifier.height(12.dp))
    }
}

@Composable
private fun LinkRow(text: String, onClick: () -> Unit) = Text(
    text,
    style = Label.copy(color = dev.mimic.ui.kit.LocalAccent.current),
    modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 6.dp),
)

@Composable
private fun LicenceText(ctx: Context, res: Int) {
    val text = remember(res) {
        // The files are wrapped at 80 columns for a terminal; join each paragraph so it reflows on a phone.
        runCatching { ctx.resources.openRawResource(res).bufferedReader().use { it.readText() } }.getOrDefault("")
            .replace("\r", "").trim()
            .split(Regex("\n\\s*\n"))
            .joinToString("\n\n") { it.lines().joinToString(" ") { l -> l.trim() } }
    }
    Text(text, style = Caption.copy(fontSize = 12.sp))
}

private fun openUrl(ctx: Context, url: String) {
    runCatching {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
