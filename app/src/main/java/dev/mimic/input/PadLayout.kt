package dev.mimic.input

import kotlin.math.max

/** An axis-aligned rectangle in dp, origin top-left. */
data class Area(val x: Float, val y: Float, val w: Float, val h: Float) {
    val right get() = x + w
    val bottom get() = y + h
    val cx get() = x + w / 2
    val cy get() = y + h / 2
    /** Sharing an edge (the D-pad keys) is not overlapping; the slack absorbs float rounding. */
    fun overlaps(o: Area) = x < o.right - EPS && o.x < right - EPS && y < o.bottom - EPS && o.y < bottom - EPS
    private companion object { const val EPS = 0.01f }
    fun mirrored(width: Float) = copy(x = width - x - w)
}

/**
 * Where every Pad control sits, for a landscape area [w] x [h] dp (already inside the camera
 * cutout, padded the same on both sides). Pure, so overlaps and centring are unit tested.
 *
 *  - nothing within [TOP] of the top edge except the hold-to-exit button: a finger pressing a
 *    shoulder and sliding down must not pull the notification shade;
 *  - left stick and face buttons mirror each other about the centre line; D-pad and the right
 *    stick sit either side of centre along the bottom; Select/Home/Start in a row under exit;
 *  - each stick only takes touches inside a circle around its base ([leftZone], [rightZone]),
 *    so it can never steal a touch meant for a button;
 *  - if [scale] does not fit the screen, everything scalable shrinks until nothing overlaps.
 */
class PadLayout(val w: Float, val h: Float, scale: Float = 1f, mirror: Boolean = false) {
    /** The scale actually used (can be below the requested one on a small screen). */
    val scale: Float
    val exit: Area
    val l1: Area; val l2: Area; val r2: Area; val r1: Area
    val select: Area; val home: Area; val start: Area
    /** Square bounding the left stick's touch circle; the visible base has radius [leftRadius]. */
    val leftZone: Area; val leftRadius: Float
    val rightZone: Area; val rightRadius: Float
    val dUp: Area; val dLeft: Area; val dRight: Area; val dDown: Area
    val a: Area; val b: Area; val x: Area; val y: Area

    /** Everything that must not overlap anything else. */
    val all: List<Area> get() = listOf(exit, l1, l2, r2, r1, select, home, start, leftZone, rightZone,
        dUp, dLeft, dRight, dDown, a, b, x, y)

    init {
        var k = scale
        var built = build(k)
        while (k > MIN_SCALE && !fits(built)) { k -= 0.05f; built = build(k) }
        this.scale = k
        val m: (Area) -> Area = if (mirror) { r -> r.mirrored(w) } else { r -> r }
        val p = built
        exit = p.exit
        l1 = m(p.l1); l2 = m(p.l2); r2 = m(p.r2); r1 = m(p.r1)
        select = p.select; home = p.home; start = p.start
        leftZone = m(p.leftZone); leftRadius = p.leftRadius
        rightZone = m(p.rightZone); rightRadius = p.rightRadius
        dUp = m(p.dUp); dLeft = m(p.dLeft); dRight = m(p.dRight); dDown = m(p.dDown)
        a = m(p.a); b = m(p.b); x = m(p.x); y = m(p.y)
    }

    private class Parts(
        val exit: Area, val l1: Area, val l2: Area, val r2: Area, val r1: Area,
        val select: Area, val home: Area, val start: Area,
        val leftZone: Area, val leftRadius: Float, val rightZone: Area, val rightRadius: Float,
        val dUp: Area, val dLeft: Area, val dRight: Area, val dDown: Area,
        val a: Area, val b: Area, val x: Area, val y: Area,
    ) {
        val all get() = listOf(exit, l1, l2, r2, r1, select, home, start, leftZone, rightZone,
            dUp, dLeft, dRight, dDown, a, b, x, y)
    }


    private fun fits(p: Parts): Boolean {
        val l = p.all
        if (l.any { it.x < 0f || it.y < 0f || it.right > w || it.bottom > h }) return false
        for (i in l.indices) for (j in i + 1 until l.size) if (l[i].overlaps(l[j])) return false
        return true
    }

    private fun build(k: Float): Parts {
        val mid = w / 2
        // Exit: ModeShell draws it at the top centre, 10 dp down, 40 dp round.
        val exit = Area(mid - 20f, 10f, 40f, 40f)

        // Shoulders: under the index fingers, a safe distance from the top edge.
        val l1 = Area(SIDE, TOP, 120f, SHOULDER_H)
        val l2 = Area(l1.right + GAP, TOP, 96f, SHOULDER_H)
        val r1 = l1.mirrored(w); val r2 = l2.mirrored(w)

        // Select / Home / Start: a row under the exit button, roomy enough to hit without looking.
        val rowY = exit.bottom + 12f
        val home = Area(mid - 28f, rowY, 56f, 38f)
        val select = Area(home.x - 12f - 80f, rowY, 80f, 38f)
        val start = select.mirrored(w)
        val topBand = max(l1.bottom, home.bottom) + GAP

        // Left stick: a generous circle around the visible base, centred in the space below.
        val lr = 62f * k
        val lz = lr + 34f
        val lowTop = l1.bottom + GAP
        val cyMain = (lowTop + (h - BOTTOM)) / 2
        val leftZone = Area(SIDE, cyMain - lz, lz * 2, lz * 2)

        // Face buttons: a diamond mirroring the stick (same distance from its edge, same height).
        val fb = 56f * k
        val d = fb * 1.08f
        val half = d + fb / 2
        val fcx = w - SIDE - half
        fun face(dx: Float, dy: Float) = Area(fcx + dx - fb / 2, cyMain + dy - fb / 2, fb, fb)
        val y = face(0f, -d); val x = face(-d, 0f); val b = face(d, 0f); val a = face(0f, d)

        // Bottom centre: D-pad left of the centre line, right stick right of it, same offset.
        val dk = 44f * k
        val rr = 50f * k
        val rz = rr + 26f
        val c = max(dk * 1.5f, rz) + 18f
        val dcx = mid - c; val dcy = h - BOTTOM - dk * 1.5f
        fun key(col: Int, row: Int) = Area(dcx + (col - 1.5f) * dk, dcy + (row - 1.5f) * dk, dk, dk)
        val dUp = key(1, 0); val dLeft = key(0, 1); val dRight = key(2, 1); val dDown = key(1, 2)
        val rightZone = Area(mid + c - rz, h - BOTTOM - rz * 2, rz * 2, rz * 2)
        // keep the right stick below the centre row even on short screens
        val rightZoneSafe = if (rightZone.y < topBand) rightZone.copy(y = topBand) else rightZone

        return Parts(exit, l1, l2, r2, r1, select, home, start, leftZone, lr, rightZoneSafe, rr,
            dUp, dLeft, dRight, dDown, a, b, x, y)
    }

    companion object {
        /** Clear of the top edge so a press-and-slide never pulls the notification shade. */
        const val TOP = 28f
        const val SIDE = 16f
        const val BOTTOM = 12f
        const val GAP = 10f
        const val SHOULDER_H = 44f
        const val MIN_SCALE = 0.6f

        /** Is (px, py), relative to a stick zone's top-left, inside its touch circle? */
        fun inStickZone(px: Float, py: Float, zoneW: Float, zoneH: Float): Boolean {
            val rx = zoneW / 2; val ry = zoneH / 2
            if (rx <= 0f || ry <= 0f) return false
            val nx = (px - rx) / rx; val ny = (py - ry) / ry
            return nx * nx + ny * ny <= 1f
        }
    }
}
