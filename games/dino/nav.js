// Ironfern navigation (pure): a 2D blocked-cell grid over a mission map, built by world.js from
// everything solid at body height (sheds, containers, fences, rocks, tree trunks), and the queries
// the animals steer with so they walk round geometry instead of through it.
// Headings use the animals' convention: yaw 0 walks toward +z, direction (sin yaw, cos yaw).
// Node tests: test/nav.test.js.
(function (root) {
  'use strict';

  /** An empty grid of size x size metres centred on (cx, cz), `cell` metres per cell. */
  function createGrid(cx, cz, size, cell) {
    cell = cell || 0.75;
    const n = Math.max(1, Math.ceil(size / cell));
    return { x0: cx - size / 2, z0: cz - size / 2, cell, n, cells: new Uint8Array(n * n) };
  }
  const idx = (g, x, z) => {
    const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((z - g.z0) / g.cell);
    return i < 0 || j < 0 || i >= g.n || j >= g.n ? -1 : j * g.n + i;
  };
  function mark(g, x, z, v) { const k = idx(g, x, z); if (k >= 0) g.cells[k] = v == null ? 1 : v; }
  /** Off the map counts as free (the map edge is fog and forest, nothing walks there anyway). */
  function blocked(g, x, z) { const k = idx(g, x, z); return k >= 0 && g.cells[k] === 1; }
  function markCircle(g, x, z, r, v) {
    const c = g.cell;
    for (let zz = z - r; zz <= z + r + 1e-9; zz += c * 0.5)
      for (let xx = x - r; xx <= x + r + 1e-9; xx += c * 0.5)
        if ((xx - x) * (xx - x) + (zz - z) * (zz - z) <= r * r) mark(g, xx, zz, v);
    mark(g, x, z, v);
  }
  /** A wall from (ax, az) to (bx, bz), `pad` metres thick either side. */
  function markSegment(g, ax, az, bx, bz, pad) {
    const len = Math.hypot(bx - ax, bz - az), step = g.cell * 0.4, n = Math.max(1, Math.ceil(len / step));
    pad = pad || 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (pad > 0) markCircle(g, x, z, pad); else mark(g, x, z);
    }
  }
  /** Free a disc (around the stand, so a strike can land and the jeep's road stays open). */
  function clearCircle(g, x, z, r) { markCircle(g, x, z, r, 0); }

  /** Is the straight walk from (x, z) along yaw free for `dist` metres, `r` metres either side? */
  function freeAlong(g, x, z, yaw, dist, r) {
    const sx = Math.sin(yaw), cz = Math.cos(yaw), step = Math.max(0.3, g.cell * 0.6);
    for (let s = step; s <= dist + 1e-9; s += step) {
      const px = x + sx * s, pz = z + cz * s;
      if (blocked(g, px, pz)) return false;
      if (r > 0 && (blocked(g, px + cz * r, pz - sx * r) || blocked(g, px - cz * r, pz + sx * r))) return false;
    }
    return true;
  }

  /** The heading closest to `want` whose next `look` metres are clear. Returns want when it is clear
   * or when nothing is (a boxed-in animal keeps trying, advance() still stops it at the wall). */
  function steerYaw(g, x, z, want, look, r) {
    if (!g || freeAlong(g, x, z, want, look, r)) return want;
    for (let k = 1; k <= 10; k++) {
      const off = k * 0.26;
      // try the side the obstacle leaves more room on first: alternate, nearest angle wins
      if (freeAlong(g, x, z, want + off, look, r)) return want + off;
      if (freeAlong(g, x, z, want - off, look, r)) return want - off;
    }
    return want;
  }

  /** Where a body at (x, z) may move to on its way to (nx, nz): straight, else sliding along x or
   * z, else nowhere. One that is already inside something may always move (it walks out). */
  function constrain(g, x, z, nx, nz) {
    if (!g || blocked(g, x, z) || !blocked(g, nx, nz)) return { x: nx, z: nz };
    if (!blocked(g, nx, z)) return { x: nx, z };
    if (!blocked(g, x, nz)) return { x, z: nz };
    return { x, z };
  }

  /** Is (x, z) hidden from an eye at (ex, ez) behind something solid on the grid? */
  function occluded(g, ex, ez, x, z) {
    const len = Math.hypot(x - ex, z - ez), step = g.cell * 0.5;
    for (let s = 1.5; s < len - 1.2; s += step) {
      const t = s / len;
      if (blocked(g, ex + (x - ex) * t, ez + (z - ez) * t)) return true;
    }
    return false;
  }

  /** A* across the grid from (sx, sz) to (tx, tz), for an animal that steering alone cannot get round
   * (a long fence, a row of sheds). Returns world waypoints (every few cells, the goal last) or null
   * when there is no way within maxNodes expansions. */
  function findPath(g, sx, sz, tx, tz, maxNodes) {
    const n = g.n, toI = (x, z) => [Math.floor((x - g.x0) / g.cell), Math.floor((z - g.z0) / g.cell)];
    const [si, sj] = toI(sx, sz), [ti, tj] = toI(tx, tz);
    if (ti < 0 || tj < 0 || ti >= n || tj >= n || si < 0 || sj < 0 || si >= n || sj >= n) return null;
    const goal = tj * n + ti, start = sj * n + si;
    if (g.cells[goal] === 1) return null;
    const gS = new Map([[start, 0]]), from = new Map(), open = [[Math.hypot(ti - si, tj - sj), start]];
    const push = e => { open.push(e); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
    const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
    const closed = new Set();
    let found = false, count = 0;
    while (open.length && count++ < (maxNodes || 6000)) {
      const cur = pop()[1];
      if (cur === goal) { found = true; break; }
      if (closed.has(cur)) continue; closed.add(cur);
      const ci = cur % n, cj = (cur - ci) / n, gc = gS.get(cur);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const k = j * n + i; if (g.cells[k] === 1 || closed.has(k)) continue;
        if (di && dj && (g.cells[cj * n + i] === 1 || g.cells[j * n + ci] === 1)) continue;   // no squeezing past a corner
        const ng = gc + (di && dj ? 1.414 : 1);
        if (ng < (gS.has(k) ? gS.get(k) : Infinity)) { gS.set(k, ng); from.set(k, cur); push([ng + Math.hypot(ti - i, tj - j), k]); }
      }
    }
    if (!found) return null;
    const cells = []; for (let k = goal; k !== start && k != null; k = from.get(k)) cells.push(k);
    cells.reverse();
    // string-pull: keep a cell only where the straight line from the last kept point would clip a wall
    const pt = k => { const i = k % n, j = (k - i) / n; return { x: g.x0 + (i + 0.5) * g.cell, z: g.z0 + (j + 0.5) * g.cell }; };
    const clear = (a, b) => { const L = Math.hypot(b.x - a.x, b.z - a.z), st = g.cell * 0.25; for (let s = 0; s <= L; s += st) if (blocked(g, a.x + (b.x - a.x) * s / L, a.z + (b.z - a.z) * s / L)) return false; return true; };
    const out = []; let last = { x: g.x0 + (si + 0.5) * g.cell, z: g.z0 + (sj + 0.5) * g.cell };
    for (let idx = 0; idx < cells.length; idx++) {
      const c = pt(cells[idx]);
      if (idx > 0 && !clear(last, c)) { last = pt(cells[idx - 1]); out.push(last); }
    }
    out.push(pt(goal));
    return out;
  }

  /** Walls only outline a shed; its inside must not count as open ground (a hidden spawn would pick
   * it). Every free cell that cannot be reached from the map edge is filled in. */
  function fillEnclosed(g) {
    const n = g.n, c = g.cells, seen = new Uint8Array(n * n), q = new Int32Array(n * n);
    let h = 0, t = 0;
    const add = k => { if (!seen[k] && c[k] !== 1) { seen[k] = 1; q[t++] = k; } };
    for (let i = 0; i < n; i++) { add(i); add((n - 1) * n + i); add(i * n); add(i * n + n - 1); }
    while (h < t) {
      const k = q[h++], i = k % n, j = (k - i) / n;
      if (i > 0) add(k - 1); if (i < n - 1) add(k + 1); if (j > 0) add(k - n); if (j < n - 1) add(k + n);
    }
    let filled = 0;
    for (let k = 0; k < n * n; k++) if (!seen[k] && c[k] !== 1) { c[k] = 1; filled++; }
    return filled;
  }

  const api = { createGrid, mark, blocked, markCircle, markSegment, clearCircle, freeAlong, steerYaw, constrain, occluded, findPath, fillEnclosed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DH = root.DH || {}; root.DH.Nav = api; }
})(typeof window !== 'undefined' ? window : this);
