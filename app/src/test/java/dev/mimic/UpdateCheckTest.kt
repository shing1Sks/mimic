package dev.mimic

import dev.mimic.update.CheckResult
import dev.mimic.update.UpdateInfo
import dev.mimic.update.Versions
import org.junit.Assert.assertEquals
import org.junit.Test

/** The About screen's "Check for updates": every answer the user can see. */
class UpdateCheckTest {
    private fun info(name: String, code: Int, minSdk: Int? = null) =
        UpdateInfo(name, code, "https://example.com/m.apk", "a".repeat(64), minSdk = minSdk)

    @Test fun nothingFetchedIsAnErrorNotUpToDate() =
        assertEquals(CheckResult.Failed, Versions.outcome(null, 100, "0.1.0", 35))

    @Test fun sameOrOlderIsUpToDate() {
        assertEquals(CheckResult.UpToDate, Versions.outcome(info("0.1.0", 100), 100, "0.1.0", 35))
        assertEquals(CheckResult.UpToDate, Versions.outcome(info("0.0.9", 9), 100, "0.1.0", 35))
    }

    @Test fun newerIsAvailable() {
        val i = info("0.2.0", 200)
        assertEquals(CheckResult.Available(i), Versions.outcome(i, 100, "0.1.0", 35))
    }

    @Test fun newerButTooNewForThisAndroidIsUpToDate() =
        assertEquals(CheckResult.UpToDate, Versions.outcome(info("0.2.0", 200, minSdk = 34), 100, "0.1.0", 29))
}
