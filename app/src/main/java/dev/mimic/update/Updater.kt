package dev.mimic.update

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import dev.mimic.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Backend-free updates: read a static manifest (or GitHub's latest release), download the APK to
 * the app cache, check its SHA-256 and package, then hand it to the system installer. Android itself
 * refuses an APK signed with a different key, so only our own signed builds can install over us.
 */
class Updater(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("mimic_update", Context.MODE_PRIVATE)
    private val dir get() = File(ctx.cacheDir, "updates")

    /**
     * The newer release, or null. Hits the network at most once per [UpdateSource.CHECK_INTERVAL_MS];
     * in between it answers from the last result. Never throws.
     */
    suspend fun check(): UpdateInfo? = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val last = prefs.getLong("lastCheck", 0L)
        var info = cached()
        if (now - last >= UpdateSource.CHECK_INTERVAL_MS || now < last) {
            val fresh = fetch(UpdateSource.MANIFEST_URL)?.let(UpdateParser::parseManifest)
                ?: fetch(UpdateSource.GITHUB_LATEST, github = true)?.let(UpdateParser::parseGitHubRelease)
            prefs.edit().putLong("lastCheck", now).apply()
            if (fresh != null) {
                info = fresh
                prefs.edit().putString("source", fresh.serialize()).apply()
            }
        }
        cleanup(info)
        info?.takeIf {
            Versions.isNewer(it, BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME) &&
                (it.minSdk == null || it.minSdk <= Build.VERSION.SDK_INT) &&
                prefs.getString("dismissed", null) != it.versionName
        }
    }

    /**
     * "Check for updates" pressed: always asks the network now (ignores the daily limit and "Later"),
     * and says whether it is up to date, newer is available, or the check failed. Never throws.
     */
    suspend fun checkNow(): CheckResult = withContext(Dispatchers.IO) {
        val fresh = runCatching {
            fetch(UpdateSource.MANIFEST_URL)?.let(UpdateParser::parseManifest)
                ?: fetch(UpdateSource.GITHUB_LATEST, github = true)?.let(UpdateParser::parseGitHubRelease)
        }.getOrNull()
        if (fresh != null) {
            prefs.edit().putLong("lastCheck", System.currentTimeMillis()).putString("source", fresh.serialize()).apply()
        }
        Versions.outcome(fresh, BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME, Build.VERSION.SDK_INT)
    }

    /** Hide the card for this version; it comes back for the next one. */
    fun dismiss(info: UpdateInfo) = prefs.edit().putString("dismissed", info.versionName).apply()

    /** The user asked for the update after all (About > Check for updates): show the card again. */
    fun undismiss() = prefs.edit().remove("dismissed").apply()

    /**
     * Downloads [info] into the cache, verifying the SHA-256 while streaming and the package afterwards.
     * Returns the verified file; throws [IOException] with a user-readable message otherwise.
     */
    suspend fun download(info: UpdateInfo, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val want = info.sha256 ?: throw IOException("This release has no checksum")
        dir.mkdirs()
        val out = File(dir, "mimic-${info.versionName.filter { it.isLetterOrDigit() || it in ".-_" }}.apk")
        if (out.isFile && sha256(out) == want && packageOk(out, info)) return@withContext out
        val part = File(dir, out.name + ".part")
        val md = MessageDigest.getInstance("SHA-256")
        val conn = open(info.apkUrl)
        try {
            if (conn.responseCode != 200) throw IOException("Download failed (HTTP ${conn.responseCode})")
            val total = conn.contentLengthLong.takeIf { it > 0 } ?: info.size ?: -1L
            var done = 0L
            var shown = -1
            conn.inputStream.use { input ->
                part.outputStream().use { o ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        o.write(buf, 0, n)
                        md.update(buf, 0, n)
                        done += n
                        val pct = if (total > 0) (done * 100 / total).toInt().coerceIn(0, 100) else -1
                        if (pct != shown) { shown = pct; onProgress(pct / 100f) }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        val got = md.digest().toHex()
        if (got != want) {
            part.delete()
            throw IOException("Download damaged or altered (checksum mismatch). Nothing was installed.")
        }
        out.delete()
        if (!part.renameTo(out)) throw IOException("Could not save the update")
        if (!packageOk(out, info)) {
            out.delete()
            throw IOException("The downloaded file is not a newer Mimic build. Nothing was installed.")
        }
        out
    }

    /** Whether Android lets Mimic open the installer, or the user must allow it first. */
    fun canInstall(): Boolean = ctx.packageManager.canRequestPackageInstalls()

    /** Opens the system page where the user allows Mimic to install apps. */
    fun openInstallPermission() {
        val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { ctx.startActivity(i) }.onFailure { Log.w(TAG, "no unknown-sources page", it) }
    }

    /** Hands the verified APK to the system installer, which shows its own confirmation. */
    fun install(apk: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.updates", apk)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ctx.startActivity(i)
        } catch (e: ActivityNotFoundException) {
            throw IOException("No installer found on this phone")
        }
    }

    fun openPage(url: String) {
        runCatching {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    private fun packageOk(apk: File, info: UpdateInfo): Boolean {
        val pi = ctx.packageManager.getPackageArchiveInfo(apk.path, 0) ?: return false
        val code = pi.longVersionCode
        return pi.packageName == ctx.packageName && code > BuildConfig.VERSION_CODE && code == info.versionCode.toLong()
    }

    /** Drops downloaded APKs once they are installed or superseded. */
    private fun cleanup(current: UpdateInfo?) {
        dir.listFiles()?.forEach { f ->
            val keep = current != null && Versions.isNewer(current, BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME) &&
                f.name.startsWith("mimic-${current.versionName}")
            if (!keep) f.delete()
        }
    }

    private fun cached(): UpdateInfo? = prefs.getString("source", null)?.let { UpdateParser.parseManifest(it, requireSha = false) }

    private fun fetch(url: String, github: Boolean = false): String? = try {
        val c = open(url)
        if (github) c.setRequestProperty("Accept", "application/vnd.github+json")
        try {
            if (c.responseCode == 200) c.inputStream.bufferedReader().use { it.readText().take(1_000_000) } else null
        } finally {
            c.disconnect()
        }
    } catch (e: Exception) {
        Log.i(TAG, "update check $url failed: ${e.message}")
        null
    }

    private fun open(url: String): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 20_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "Mimic/${BuildConfig.VERSION_NAME} (Android)")
        }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { i ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = i.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().toHex()
    }

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }

    private companion object { const val TAG = "MimicUpdate" }
}

/** Stored in prefs in the manifest's own schema, so one parser reads both. */
internal fun UpdateInfo.serialize(): String {
    fun q(s: String) = buildString {
        append('"')
        for (c in s) when {
            c == '"' || c == '\\' -> append('\\').append(c)
            c == '\n' -> append("\\n")
            c < ' ' -> append(' ')
            else -> append(c)
        }
        append('"')
    }
    val f = mutableListOf(
        "\"versionName\":${q(versionName)}",
        "\"versionCode\":$versionCode",
        "\"apkUrl\":${q(apkUrl)}",
        "\"notes\":${q(notes)}",
    )
    sha256?.let { f += "\"sha256\":${q(it)}" }
    size?.let { f += "\"size\":$it" }
    minSdk?.let { f += "\"minSdk\":$it" }
    pageUrl?.let { f += "\"releaseUrl\":${q(it)}" }
    return f.joinToString(",", "{", "}")
}
