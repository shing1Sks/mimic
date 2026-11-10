package dev.mimic

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/**
 * The Bluetooth permissions Mimic must ask for at runtime. Android 12 (API 31) added the "Nearby
 * devices" permissions; on Android 10 and 11 they do not exist, so asking for them always comes
 * back "denied" and checking them always fails. There, the install-time BLUETOOTH and
 * BLUETOOTH_ADMIN permissions from the manifest are all Mimic needs.
 */
object BtPermissions {
    fun runtime(sdk: Int): Array<String> =
        if (sdk >= 31) arrayOf(
            "android.permission.BLUETOOTH_CONNECT",
            "android.permission.BLUETOOTH_ADVERTISE",
            "android.permission.BLUETOOTH_SCAN",
        ) else emptyArray()

    fun granted(ctx: Context): Boolean =
        runtime(Build.VERSION.SDK_INT).all { ctx.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
}
