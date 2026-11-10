package dev.mimic

import dev.mimic.input.Dpad
import org.junit.Assert.assertEquals
import org.junit.Test

/** HID hat: 0 = up, clockwise to 7 = up-left, 8 = centred. */
class DpadTest {
    @Test fun singleDirections() {
        assertEquals(0, Dpad.hat(Dpad.UP)); assertEquals(2, Dpad.hat(Dpad.RIGHT))
        assertEquals(4, Dpad.hat(Dpad.DOWN)); assertEquals(6, Dpad.hat(Dpad.LEFT))
    }
    @Test fun nothingHeldIsCentred() = assertEquals(8, Dpad.hat(0))
    @Test fun diagonals() {
        assertEquals(1, Dpad.hat(Dpad.UP or Dpad.RIGHT)); assertEquals(7, Dpad.hat(Dpad.UP or Dpad.LEFT))
        assertEquals(3, Dpad.hat(Dpad.DOWN or Dpad.RIGHT)); assertEquals(5, Dpad.hat(Dpad.DOWN or Dpad.LEFT))
    }
    @Test fun releasingOneKeepsTheOther() {
        var held = Dpad.LEFT or Dpad.UP
        held = Dpad.set(held, Dpad.UP, false)
        assertEquals(6, Dpad.hat(held))
    }
    @Test fun opposingDirectionsCancel() = assertEquals(8, Dpad.hat(Dpad.LEFT or Dpad.RIGHT))
}
