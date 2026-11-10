package dev.mimic

import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.mimic.dsu.DsuServer
import dev.mimic.hid.HidController
import dev.mimic.ui.GamepadScreen
import dev.mimic.ui.GripScreen
import dev.mimic.ui.ReconnectBadge
import dev.mimic.haptics.HapticEngine
import dev.mimic.ui.HomeScreen
import dev.mimic.ui.Ink
import dev.mimic.ui.MimicTheme
import dev.mimic.ui.ModeShell
import dev.mimic.ui.kit.Mode
import dev.mimic.ui.kit.LocalAccent
import dev.mimic.ui.kit.Palette
import dev.mimic.ui.IntroScreen
import dev.mimic.ui.SettingsScreen
import dev.mimic.ui.AboutScreen
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import dev.mimic.ui.WandScreen
import dev.mimic.ui.PointScreen
import dev.mimic.input.KeyRouter
import android.view.KeyEvent
import androidx.lifecycle.Lifecycle
import dev.mimic.ui.Screen

class MainActivity : ComponentActivity() {
    private lateinit var hid: HidController
    private lateinit var settings: Settings
    private lateinit var haptics: HapticEngine
    private val dsu = DsuServer()
    private lateinit var diagnostics: Diagnostics
    // The adb hooks (test pattern, recording, screen switching) can drive the laptop's pointer,
    // and any app could send them. Only development builds listen.
    private val debuggable get() = applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
    private var screen by mutableStateOf<Screen?>(null)
    private val keys = KeyRouter()

    private val foreground get() = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)

    // Hardware keys go to the open mode (Point takes volume as back/forward); otherwise normal.
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (event.repeatCount > 0 && keys.handler != null && foreground &&
            (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)) return true
        return keys.onKey(keyCode, true, foreground) || super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean =
        keys.onKey(keyCode, false, foreground) || super.onKeyUp(keyCode, event)

    // Empty on Android 10/11, where Bluetooth needs no runtime permission (see BtPermissions).
    private val btPerms = BtPermissions.runtime(Build.VERSION.SDK_INT)
    /** Home shows a "why Mimic needs this" panel instead of the connection panel while false. */
    private var btGranted by mutableStateOf(true)
    /** Android stopped showing the dialog (denied twice, or "don't ask again"): only app settings can grant it. */
    private var btBlocked by mutableStateOf(false)

    private val askBt = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
        btGranted = BtPermissions.granted(this)
        if (btGranted) hid.start()
        else btBlocked = btPerms.none { shouldShowRequestPermissionRationale(it) }
    }

    /** The permission panel's button: ask again, or open Mimic's app settings once Android won't. */
    private fun allowBluetooth() {
        if (!btBlocked) { askBt.launch(btPerms); return }
        runCatching {
            startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        }
    }


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        settings = Settings(applicationContext)
        hid = HidController(applicationContext, settings.lastHost)
        haptics = HapticEngine(applicationContext) { settings.effectiveHaptics() }
        diagnostics = Diagnostics(applicationContext, hid) { name ->
            screen = Screen.entries.firstOrNull { it.name.equals(name, true) }
        }.also { if (debuggable) it.register() }

        btGranted = BtPermissions.granted(this)
        if (btGranted) hid.start() else askBt.launch(btPerms)

        setContent {
            MimicTheme {
                BackHandler(enabled = screen != null) { screen = if (screen == Screen.About) Screen.Settings else null }
                LaunchedEffect(screen) {
                    requestedOrientation = if (screen == Screen.Pad)
                        ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                }
                CompositionLocalProvider(LocalAccent provides Color(Palette.accent(settings.theme.value, null))) {
                    Box(Modifier.fillMaxSize().background(Ink.bg).screenInsets(symmetric = screen == Screen.Pad)) {
                        if (!settings.introDone.value) {
                            IntroScreen(onPair = ::makeDiscoverable, onDone = { settings.introDone.value = true })
                            return@Box
                        }
                        when (screen) {
                            null -> HomeScreen(hid, settings, haptics, onPair = ::makeDiscoverable, onOpen = { screen = it },
                                needsPermission = !btGranted, permissionBlocked = btBlocked, onAllow = ::allowBluetooth)
                            Screen.Settings -> SettingsScreen(settings, haptics, onAbout = { screen = Screen.About }, onBack = { screen = null })
                            Screen.About -> AboutScreen(onShowUpdateOnHome = { screen = null }, onBack = { screen = Screen.Settings })
                            Screen.Point -> ModeShell(Mode.Point, settings, haptics, onExit = { screen = null }) {
                                PointScreen(this@MainActivity, hid, settings, haptics, keys)
                            }
                            Screen.Pad -> ModeShell(Mode.Pad, settings, haptics, onExit = { screen = null }, exclusionBand = 0.2f..0.95f, exitAtTopCentre = true) {
                                GamepadScreen(hid, settings, haptics)
                            }
                            Screen.Grip -> ModeShell(Mode.Grip, settings, haptics, onExit = { screen = null }) {
                                GripScreen(this@MainActivity, hid, settings, haptics, keys)
                            }
                            Screen.Wand -> ModeShell(Mode.Wand, settings, haptics, onExit = { screen = null }, exclusionBand = 0.3f..0.75f) {
                                WandScreen(hid, dsu, settings, haptics)
                            }
                        }
                        if (screen?.mode != null) ReconnectBadge(hid, settings.leftHanded.value)
                    }
                }
            }
        }
    }

    /** Lets Windows find the phone for the first pairing (2 minutes). */
    private fun makeDiscoverable() {
        // A fresh pairing picks up this build's HID descriptor, so the re-pair hint can go.
        settings.pairedDescriptor.value = dev.mimic.hid.HidDescriptor.version
        // Throws without the Nearby devices permission (Android 12+) or on a phone with no such page.
        try {
            startActivity(
                Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE)
                    .putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 120)
            )
        } catch (e: Exception) {
            android.util.Log.w("Mimic", "cannot request discoverable", e)
            if (!BtPermissions.granted(this)) btGranted = false
        }
    }

    // Always-on reconnect while Mimic is on screen (power button, app switch, laptop sleep).
    override fun onResume() {
        super.onResume()
        // Back from app settings with the permission granted: start without a restart.
        if (!btGranted && BtPermissions.granted(this)) { btGranted = true; btBlocked = false; hid.start() }
        hid.setForeground(true)
    }
    override fun onPause() { super.onPause(); hid.setForeground(false) }

    override fun onDestroy() {
        super.onDestroy()
        if (debuggable) diagnostics.unregister()
        hid.stop()
        dsu.stop()
    }
}

/**
 * Keeps content clear of system bars and the camera cutout. The Pad is held in both hands in
 * landscape, where the cutout sits on one side only; padding that side alone pushed the whole
 * pad off centre. [symmetric] pads both sides by the larger inset so the layout stays centred.
 */
@Composable
private fun Modifier.screenInsets(symmetric: Boolean): Modifier {
    if (!symmetric) return safeDrawingPadding()
    val d = LocalDensity.current
    val dir = LocalLayoutDirection.current
    val cut = WindowInsets.displayCutout
    val side = with(d) { maxOf(cut.getLeft(d, dir), cut.getRight(d, dir)).toDp() }
    val top = with(d) { cut.getTop(d).toDp() }
    val bottom = with(d) { cut.getBottom(d).toDp() }
    return padding(start = side, end = side, top = top, bottom = bottom)
}
