package dev.mimic.hid

/**
 * Keys held on the phone's virtual keyboard: HID usage codes, modifiers 0xE0..0xE7 as bits.
 *
 * A key pressed and lifted before the next report went out (inside one 8 ms flush) still shows up
 * in exactly one report, then [owesReport] asks for one more report with it released. Without
 * that, a quick tap collapsed to "nothing changed" and the PC never saw the key.
 */
class KeySet {
    private var mods = 0
    private val keys = LinkedHashSet<Int>()
    /** Pressed since the last [report]: not yet seen by the PC. */
    private val fresh = HashSet<Int>()
    /** Lifted while still fresh: dropped right after the next [report]. */
    private val liftAfterReport = HashSet<Int>()

    /** True when the last [report] still showed a key that has since been lifted. */
    var owesReport = false; private set

    /** Returns true if the state changed. */
    fun down(code: Int): Boolean {
        liftAfterReport.remove(code)
        val changed = if (code in 0xE0..0xE7) { val n = mods or (1 shl (code - 0xE0)); (n != mods).also { mods = n } }
            else keys.add(code)
        if (changed) fresh.add(code)
        return changed
    }

    fun up(code: Int): Boolean {
        if (code in fresh) return liftAfterReport.add(code)
        return lift(code)
    }

    fun clear(): Boolean {
        val any = mods != 0 || keys.isNotEmpty()
        mods = 0; keys.clear(); fresh.clear(); liftAfterReport.clear(); owesReport = false
        return any
    }

    /** The report to send now. Keys tapped since the last one are in it once, then released. */
    fun report(): ByteArray {
        val r = HidDescriptor.keyboardReport(mods, keys.toList())
        fresh.clear()
        owesReport = liftAfterReport.isNotEmpty()
        liftAfterReport.forEach(::lift)
        liftAfterReport.clear()
        return r
    }

    private fun lift(code: Int): Boolean =
        if (code in 0xE0..0xE7) { val n = mods and (1 shl (code - 0xE0)).inv(); (n != mods).also { mods = n } }
        else keys.remove(code)

    companion object {
        const val LEFT_CTRL = 0xE0
        /** F9: Point mode's CENTRE button; the Windows tray turns it into "cursor to the middle". */
        const val F9 = 0x42
    }
}
