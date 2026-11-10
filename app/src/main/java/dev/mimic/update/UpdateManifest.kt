package dev.mimic.update

/** Where the app looks for a newer release. Schema: docs/releasing.md. */
object UpdateSource {
    /** Static manifest, the primary source. */
    const val MANIFEST_URL = "https://mimic.shing.in/version.json"
    /** Fallback when the manifest cannot be fetched: GitHub's latest-release API for this repo. */
    const val GITHUB_REPO = "shing1Sks/mimic"
    const val GITHUB_LATEST = "https://api.github.com/repos/$GITHUB_REPO/releases/latest"
    /** At most one network check per this interval. */
    const val CHECK_INTERVAL_MS = 24L * 60 * 60 * 1000
}

/** A release the app could update to. */
data class UpdateInfo(
    val versionName: String,
    /** Android versionCode; derived from [versionName] when the source does not give one. */
    val versionCode: Int,
    /** https URL of the APK. */
    val apkUrl: String,
    /** Lower-case hex SHA-256 of the APK, or null when the source has none (then we never install). */
    val sha256: String?,
    val size: Long? = null,
    val minSdk: Int? = null,
    val notes: String = "",
    /** Human page for the release (opened when there is no checksum to verify). */
    val pageUrl: String? = null,
)

/** The answer to a manual update check. */
sealed interface CheckResult {
    data object UpToDate : CheckResult
    data class Available(val info: UpdateInfo) : CheckResult
    data object Failed : CheckResult
}

object Versions {
    /**
     * versionCode for a "MAJOR.MINOR.PATCH" name, matching app/build.gradle.kts:
     * MAJOR * 10000 + MINOR * 100 + PATCH. A leading "v" and any "-suffix" or "+build" are ignored.
     * Null when the name is not of that shape or MINOR/PATCH are 100 or more.
     */
    fun codeOf(name: String): Int? {
        val p = parts(name) ?: return null
        if (p.size != 3 || p[1] >= 100 || p[2] >= 100) return null
        return p[0] * 10000 + p[1] * 100 + p[2]
    }

    /** Compares dotted version names numerically ("0.10.0" > "0.9.3"); missing parts count as 0. */
    fun compare(a: String, b: String): Int {
        val x = parts(a) ?: emptyList()
        val y = parts(b) ?: emptyList()
        for (k in 0 until maxOf(x.size, y.size)) {
            val c = (x.getOrElse(k) { 0 }).compareTo(y.getOrElse(k) { 0 })
            if (c != 0) return c
        }
        // Same numbers: a release beats a pre-release of it ("1.0.0" > "1.0.0-rc1").
        val preA = isPre(a)
        val preB = isPre(b)
        return if (preA == preB) 0 else if (preA) -1 else 1
    }

    /** True when [info] is newer than the installed build. versionCode decides; the name is the tie-break. */
    fun isNewer(info: UpdateInfo, currentCode: Int, currentName: String): Boolean =
        if (info.versionCode != currentCode) info.versionCode > currentCode
        else compare(info.versionName, currentName) > 0

    /**
     * What a manual "Check for updates" tells the user. [fetched] is null when neither the manifest
     * nor GitHub answered (offline, server down): that is an error, never "up to date".
     */
    fun outcome(fetched: UpdateInfo?, currentCode: Int, currentName: String, sdk: Int): CheckResult = when {
        fetched == null -> CheckResult.Failed
        isNewer(fetched, currentCode, currentName) && (fetched.minSdk == null || fetched.minSdk <= sdk) ->
            CheckResult.Available(fetched)
        else -> CheckResult.UpToDate
    }

    private fun core(name: String) = name.trim().removePrefix("v").removePrefix("V").substringBefore('+')
    private fun isPre(name: String) = core(name).contains('-')

    private fun parts(name: String): List<Int>? {
        val c = core(name).substringBefore('-')
        if (c.isEmpty()) return null
        return c.split('.').map { it.toIntOrNull()?.takeIf { n -> n >= 0 } ?: return null }
    }
}

object UpdateParser {
    private val HEX64 = Regex("^[0-9a-f]{64}$")

    /**
     * Parses our version.json. Null when it is malformed or unsafe (non-https URL, missing or bad
     * checksum). [requireSha] is false only for the app's own cached copy of a GitHub result.
     */
    fun parseManifest(text: String, requireSha: Boolean = true): UpdateInfo? {
        val o = runCatching { MiniJson.parse(text) }.getOrNull() as? Map<*, *> ?: return null
        val name = (o["versionName"] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val code = (o["versionCode"] as? Double)?.toInt() ?: Versions.codeOf(name) ?: return null
        val url = (o["apkUrl"] as? String)?.trim()?.takeIf(::isHttps) ?: return null
        val sha = sha(o["sha256"] as? String)
        if (sha == null && (requireSha || o["sha256"] != null)) return null
        return UpdateInfo(
            versionName = name,
            versionCode = code,
            apkUrl = url,
            sha256 = sha,
            size = (o["size"] as? Double)?.toLong(),
            minSdk = (o["minSdk"] as? Double)?.toInt(),
            notes = (o["notes"] as? String).orEmpty(),
            pageUrl = (o["releaseUrl"] as? String)?.takeIf(::isHttps),
        )
    }

    /**
     * Parses GitHub's GET /repos/{owner}/{repo}/releases/latest response. Picks the first asset named
     * mimic-*.apk (else any .apk). GitHub reports "digest": "sha256:<hex>" for assets; without it the
     * result has no checksum and the app only offers to open the release page.
     */
    fun parseGitHubRelease(text: String): UpdateInfo? {
        val o = runCatching { MiniJson.parse(text) }.getOrNull() as? Map<*, *> ?: return null
        if (o["draft"] == true || o["prerelease"] == true) return null
        val tag = (o["tag_name"] as? String)?.trim() ?: return null
        val name = tag.removePrefix("v").removePrefix("V")
        val code = Versions.codeOf(name) ?: return null
        val assets = (o["assets"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()
        val apk = assets.firstOrNull { (it["name"] as? String)?.let { n -> n.startsWith("mimic-") && n.endsWith(".apk") } == true }
            ?: assets.firstOrNull { (it["name"] as? String)?.endsWith(".apk") == true }
            ?: return null
        val url = (apk["browser_download_url"] as? String)?.takeIf(::isHttps) ?: return null
        val digest = (apk["digest"] as? String)?.takeIf { it.startsWith("sha256:") }?.removePrefix("sha256:")
        return UpdateInfo(
            versionName = name,
            versionCode = code,
            apkUrl = url,
            sha256 = sha(digest),
            size = (apk["size"] as? Double)?.toLong(),
            notes = (o["body"] as? String).orEmpty().take(500),
            pageUrl = (o["html_url"] as? String)?.takeIf(::isHttps),
        )
    }

    private fun isHttps(u: String) = u.startsWith("https://") && u.length > 8
    private fun sha(s: String?): String? = s?.trim()?.lowercase()?.takeIf { HEX64.matches(it) }
}
