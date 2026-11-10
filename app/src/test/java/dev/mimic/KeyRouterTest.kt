package dev.mimic

import dev.mimic.input.KeyRouter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyRouterTest {
    private val VOL_UP = 24

    @Test fun volumeConsumedOnlyWithHandlerAndForeground() {
        val r = KeyRouter(); val got = mutableListOf<Pair<Int, Boolean>>()
        r.handler = { k, d -> got += k to d; true }
        assertTrue(r.onKey(VOL_UP, true, appForeground = true))
        assertEquals(listOf(VOL_UP to true), got)
    }

    @Test fun clearedHandlerPassesThrough() {
        val r = KeyRouter()
        r.handler = { _, _ -> true }
        r.handler = null
        assertFalse(r.onKey(VOL_UP, true, appForeground = true))
    }

    @Test fun backgroundPassesThroughEvenWithHandler() {
        val r = KeyRouter(); var called = false
        r.handler = { _, _ -> called = true; true }
        assertFalse(r.onKey(VOL_UP, true, appForeground = false))
        assertFalse(called)
    }

    @Test fun handlerCanDecline() {
        val r = KeyRouter()
        r.handler = { _, _ -> false }
        assertFalse(r.onKey(VOL_UP, true, appForeground = true))
    }
}
