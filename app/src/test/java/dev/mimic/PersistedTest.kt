package dev.mimic

import androidx.compose.runtime.mutableStateOf
import org.junit.Assert.assertEquals
import org.junit.Test

class PersistedTest {
    @Test fun resetGoesBackToTheDefaultAndSavesIt() {
        var saved: Float? = null
        val p = Persisted(mutableStateOf(1f), default = 1f) { saved = it }
        p.value = 3f
        assertEquals(3f, saved)
        p.reset()
        assertEquals(1f, p.value)
        assertEquals(1f, saved)
    }
}
