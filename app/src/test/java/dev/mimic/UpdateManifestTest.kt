package dev.mimic

import dev.mimic.update.MiniJson
import dev.mimic.update.UpdateInfo
import dev.mimic.update.UpdateParser
import dev.mimic.update.Versions
import dev.mimic.update.serialize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateManifestTest {
    private val sha = "a".repeat(64)

    private fun manifest(extra: String = "", sha256: String = "\"$sha\"", url: String = "https://example.org/mimic-0.2.0.apk") = """
        {
          "versionName": "0.2.0",
          "versionCode": 200,
          "apkUrl": "$url",
          "sha256": $sha256,
          "size": 12345678,
          "minSdk": 29,
          "notes": "Grip mode and in-app updates.\nSecond line"
          $extra
        }
    """.trimIndent()

    // ---- version codes and comparison

    @Test fun codeOfMatchesGradleScheme() {
        assertEquals(100, Versions.codeOf("0.1.0"))
        assertEquals(200, Versions.codeOf("0.2.0"))
        assertEquals(10412, Versions.codeOf("1.4.12"))
        assertEquals(10412, Versions.codeOf("v1.4.12"))
        assertEquals(10000, Versions.codeOf("1.0.0-rc1"))
    }

    @Test fun codeOfRejectsOtherShapes() {
        assertNull(Versions.codeOf("1.2"))
        assertNull(Versions.codeOf("1.2.3.4"))
        assertNull(Versions.codeOf("1.100.0"))
        assertNull(Versions.codeOf("one.two.three"))
        assertNull(Versions.codeOf(""))
    }

    @Test fun compareIsNumericNotLexical() {
        assertTrue(Versions.compare("0.10.0", "0.9.9") > 0)
        assertTrue(Versions.compare("1.0.0", "0.99.99") > 0)
        assertEquals(0, Versions.compare("v1.2.0", "1.2"))
        assertTrue(Versions.compare("1.2.1", "1.2") > 0)
    }

    @Test fun releaseBeatsItsPrerelease() {
        assertTrue(Versions.compare("1.0.0", "1.0.0-rc1") > 0)
        assertTrue(Versions.compare("1.0.0-beta", "1.0.0") < 0)
        assertTrue(Versions.compare("1.0.1-rc1", "1.0.0") > 0)
    }

    @Test fun isNewerUsesVersionCodeFirst() {
        val info = UpdateInfo("0.2.0", 200, "https://x/y.apk", sha)
        assertTrue(Versions.isNewer(info, 100, "0.1.0"))
        assertFalse(Versions.isNewer(info, 200, "0.2.0"))
        assertFalse(Versions.isNewer(info, 300, "0.3.0"))
        // same code: the name breaks the tie
        assertTrue(Versions.isNewer(info, 200, "0.2.0-rc1"))
    }

    // ---- version.json

    @Test fun parsesFullManifest() {
        val u = UpdateParser.parseManifest(manifest())!!
        assertEquals("0.2.0", u.versionName)
        assertEquals(200, u.versionCode)
        assertEquals("https://example.org/mimic-0.2.0.apk", u.apkUrl)
        assertEquals(sha, u.sha256)
        assertEquals(12345678L, u.size)
        assertEquals(29, u.minSdk)
        assertEquals("Grip mode and in-app updates.\nSecond line", u.notes)
    }

    @Test fun versionCodeIsDerivedWhenMissing() {
        val u = UpdateParser.parseManifest("""{"versionName":"1.3.7","apkUrl":"https://e.org/a.apk","sha256":"$sha"}""")!!
        assertEquals(10307, u.versionCode)
    }

    @Test fun checksumIsNormalisedToLowerCase() {
        val u = UpdateParser.parseManifest(manifest(sha256 = "\"${"AB".repeat(32)}\""))!!
        assertEquals("ab".repeat(32), u.sha256)
    }

    @Test fun rejectsUnsafeOrIncompleteManifests() {
        assertNull(UpdateParser.parseManifest(manifest(url = "http://example.org/a.apk")))
        assertNull(UpdateParser.parseManifest(manifest(sha256 = "null")))
        assertNull(UpdateParser.parseManifest(manifest(sha256 = "\"abc\"")))
        assertNull(UpdateParser.parseManifest("""{"apkUrl":"https://e.org/a.apk","sha256":"$sha"}"""))
        assertNull(UpdateParser.parseManifest("not json"))
        assertNull(UpdateParser.parseManifest("[1,2]"))
        assertNull(UpdateParser.parseManifest(manifest().dropLast(1)))
    }

    @Test fun ignoresUnknownFields() {
        assertNotNull(UpdateParser.parseManifest(manifest(extra = """, "future": {"a": [1, true, null]}""")))
    }

    @Test fun storedCopyRoundTrips() {
        val u = UpdateParser.parseManifest(manifest(extra = """, "releaseUrl": "https://e.org/r" """))!!
        assertEquals(u, UpdateParser.parseManifest(u.serialize()))
        val noSha = u.copy(sha256 = null, notes = "quote \" back\\slash\ttab")
        assertNull(UpdateParser.parseManifest(noSha.serialize()))
        assertEquals(noSha.copy(notes = "quote \" back\\slash tab"), UpdateParser.parseManifest(noSha.serialize(), requireSha = false))
    }

    // ---- GitHub releases/latest

    private fun release(assets: String, tag: String = "v0.3.1", flags: String = "") = """
        {"tag_name":"$tag","html_url":"https://github.com/o/r/releases/tag/$tag","body":"Notes"$flags,
         "assets":[$assets]}
    """.trimIndent()

    @Test fun parsesGitHubReleaseWithDigest() {
        val u = UpdateParser.parseGitHubRelease(release("""
            {"name":"checksums.txt","browser_download_url":"https://g/c.txt","size":10},
            {"name":"mimic-0.3.1.apk","browser_download_url":"https://g/mimic-0.3.1.apk","size":9000,"digest":"sha256:$sha"}
        """))!!
        assertEquals("0.3.1", u.versionName)
        assertEquals(301, u.versionCode)
        assertEquals("https://g/mimic-0.3.1.apk", u.apkUrl)
        assertEquals(sha, u.sha256)
        assertEquals(9000L, u.size)
        assertEquals("https://github.com/o/r/releases/tag/v0.3.1", u.pageUrl)
    }

    @Test fun gitHubReleaseWithoutDigestHasNoChecksum() {
        val u = UpdateParser.parseGitHubRelease(release("""{"name":"mimic-0.3.1.apk","browser_download_url":"https://g/a.apk"}"""))!!
        assertNull(u.sha256)
    }

    @Test fun gitHubSkipsPrereleasesAndReleasesWithoutApk() {
        val apk = """{"name":"mimic-0.3.1.apk","browser_download_url":"https://g/a.apk"}"""
        assertNull(UpdateParser.parseGitHubRelease(release(apk, flags = ""","prerelease":true""")))
        assertNull(UpdateParser.parseGitHubRelease(release("""{"name":"src.zip","browser_download_url":"https://g/s.zip"}""")))
        assertNull(UpdateParser.parseGitHubRelease(release(apk, tag = "nightly")))
    }

    // ---- JSON reader

    @Test fun jsonReaderHandlesEscapesAndNesting() {
        val v = MiniJson.parse("""{"a":"x\"y\\zA\n","b":[1,-2.5e1,true,false,null,{}],"c":{}}""") as Map<*, *>
        assertEquals("x\"y\\zA\n", v["a"])
        assertEquals(listOf(1.0, -25.0, true, false, null, emptyMap<String, Any?>()), v["b"])
    }

    @Test(expected = MiniJson.Error::class) fun jsonReaderRejectsTrailingGarbage() {
        MiniJson.parse("{} x")
    }
}
