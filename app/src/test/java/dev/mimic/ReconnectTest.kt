package dev.mimic

import dev.mimic.hid.HidController.Status
import dev.mimic.hid.Reconnect
import dev.mimic.hid.Reconnect.Action
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReconnectTest {
    private val bonded = listOf("AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02")
    private val laptop = "AA:BB:CC:DD:EE:01"

    @Test fun picksTheLastHostWhenStillPaired() =
        assertEquals("AA:BB:CC:DD:EE:02", Reconnect.pick("AA:BB:CC:DD:EE:02", bonded))

    @Test fun addressCaseDoesNotMatter() =
        assertEquals("aa:bb:cc:dd:ee:01", Reconnect.pick("aa:bb:cc:dd:ee:01", bonded))

    @Test fun nothingWhenNeverConnectedOrUnpaired() {
        assertNull(Reconnect.pick("", bonded))
        assertNull(Reconnect.pick(null, bonded))
        assertNull(Reconnect.pick("11:22:33:44:55:66", bonded))
        assertNull(Reconnect.pick("AA:BB:CC:DD:EE:01", emptyList()))
    }

    @Test fun firstTryIsImmediateThenBacksOffToFiveSecondsForever() {
        assertEquals(0L, Reconnect.delayFor(0))
        val delays = (0 until 50).map { Reconnect.delayFor(it) }
        assertTrue("gaps never shrink", delays.zipWithNext().all { (a, b) -> b >= a })
        assertTrue("capped at 5 s", delays.all { it <= 5_000 })
        assertEquals(5_000L, Reconnect.delayFor(10_000))
        assertEquals(0L, Reconnect.delayFor(-1))
    }

    @Test fun keepsChasingTheLaptopUntilConnected() {
        assertEquals(Action.CONNECT, Reconnect.next(true, Status.Ready, false, false, laptop))
        assertEquals(Action.IDLE, Reconnect.next(true, Status.Connected, true, false, laptop))
    }

    @Test fun reRegistersAfterBluetoothComesBack() {
        assertEquals(Action.WAIT_BLUETOOTH, Reconnect.next(false, Status.Off, false, false, laptop))
        assertEquals(Action.REGISTER, Reconnect.next(true, Status.Off, false, false, laptop))
        assertEquals(Action.IDLE, Reconnect.next(true, Status.Registering, false, false, laptop))
    }

    @Test fun onlyAnExplicitDisconnectOrNoLaptopStopsIt() {
        assertEquals(Action.IDLE, Reconnect.next(true, Status.Ready, false, true, laptop))
        assertEquals(Action.IDLE, Reconnect.next(true, Status.Ready, false, false, null))
        // registering again still happens after an explicit disconnect: the phone stays findable
        assertEquals(Action.REGISTER, Reconnect.next(true, Status.Off, false, true, laptop))
        assertEquals(Action.IDLE, Reconnect.next(true, Status.Unsupported, false, false, laptop))
    }
}
