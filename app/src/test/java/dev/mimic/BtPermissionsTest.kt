package dev.mimic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Android 10 and 11 have no runtime Bluetooth permission: asking for BLUETOOTH_CONNECT there is
 * always "denied" (the permission does not exist), which left the phone never registering.
 */
class BtPermissionsTest {
    @Test fun android10And11NeedNothingAtRuntime() {
        assertEquals(0, BtPermissions.runtime(29).size)
        assertEquals(0, BtPermissions.runtime(30).size)
    }

    @Test fun android12AndLaterAskForNearbyDevices() {
        for (sdk in listOf(31, 33, 35, 36)) {
            val p = BtPermissions.runtime(sdk).toList()
            assertTrue(p.contains("android.permission.BLUETOOTH_CONNECT"))
            assertTrue(p.contains("android.permission.BLUETOOTH_ADVERTISE"))
        }
    }
}
