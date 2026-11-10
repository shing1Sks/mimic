package dev.mimic

import dev.mimic.ui.kit.Mode
import dev.mimic.ui.kit.Palette
import dev.mimic.ui.kit.ThemeName
import org.junit.Assert.assertEquals
import org.junit.Test

class PaletteTest {
    @Test fun chameleonAccentsPerMode() {
        assertEquals(0xFF5EE6D0, Palette.accent(ThemeName.Chameleon, Mode.Point))
        assertEquals(0xFFFFB454, Palette.accent(ThemeName.Chameleon, Mode.Wand))
        assertEquals(0xFFA68BFF, Palette.accent(ThemeName.Chameleon, Mode.Pad))
        assertEquals(0xFFFF6B4A, Palette.accent(ThemeName.Chameleon, Mode.Grip))
    }

    @Test fun chameleonHomeUsesPointAccent() {
        assertEquals(0xFF5EE6D0, Palette.accent(ThemeName.Chameleon, null))
    }

    @Test fun inkSameForAll() {
        for (m in listOf(null, Mode.Point, Mode.Wand, Mode.Pad, Mode.Grip))
            assertEquals(0xFF7CC4FF, Palette.accent(ThemeName.Ink, m))
    }

    @Test fun arcadeWandIsYellow() {
        assertEquals(0xFFFFD23F, Palette.accent(ThemeName.Arcade, Mode.Wand))
        assertEquals(0xFFFF5D73, Palette.accent(ThemeName.Arcade, Mode.Point))
        assertEquals(0xFFFF5D73, Palette.accent(ThemeName.Arcade, Mode.Pad))
    }

    @Test fun baseBackground() {
        assertEquals(0xFF0A0B0D, Palette.bg)
    }
}
