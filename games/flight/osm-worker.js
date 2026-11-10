/*
 * GYROWING map tile worker: decodes OpenStreetMap vector tiles off the main thread and returns what
 * the page draws: the ground overlay (roads, water, land use, airfields, building footprints) as an
 * ImageBitmap, merged building meshes (full or distant LOD) and tree positions.
 *
 * In:  { id, key, buf? (ArrayBuffer, first time), rect {x0,x1,z0,z1}, grid (Float32Array n*n
 *        ground heights over the rect), n, overlay (px, 0 = none), build ('full' | 'lod' | null),
 *        trees (count) }
 * Out: { id, key, miss? (decoded tile was evicted: send buf again), overlay (ImageBitmap),
 *        mesh { pos, nor, col, uv }, buildings, trees (Float32Array x, y, z, scale) }
 */
'use strict';
importScripts('osm.js');
const OSM = self.OSM;
const cache = new Map();   // key -> decoded layers (LRU)

function groundSampler(rect, grid, n) {
  const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
  return (x, z) => {
    const u = Math.min(n - 1.001, Math.max(0, (x - rect.x0) / w * (n - 1))), v = Math.min(n - 1.001, Math.max(0, (z - rect.z0) / d * (n - 1)));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = grid[j * n + i], b = grid[j * n + i + 1], c = grid[(j + 1) * n + i], e = grid[(j + 1) * n + i + 1];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + e) * fu * fv;
  };
}
const toLin = v => Math.pow(v, 2.2);

function paintOverlay(T, size) {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const cv = new OffscreenCanvas(size, size), g = cv.getContext('2d');
  const ext = 4096, k = size / ext, mPerPx = self.__mpp;
  const items = [];
  for (const layer of ['landcover', 'landuse', 'park', 'water', 'waterway', 'aeroway', 'transportation', 'building']) {
    const L = T[layer]; if (!L) continue;
    for (const f of L.features) {
      if (f.type === 1) continue;
      const props = f.type === 3 ? Object.assign({ _poly: true }, f.props) : f.props;
      const st = OSM.overlayStyle(layer, props);
      if (!st || (st.fill && f.type !== 3) || (st.line && f.type !== 2 && !(layer === 'aeroway' && f.type === 3))) continue;
      items.push({ st, f });
    }
  }
  items.sort((a, b) => a.st.z - b.st.z);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const path = (rs, close) => { g.beginPath(); for (const r of rs) { g.moveTo(r[0][0] * k, r[0][1] * k); for (let i = 1; i < r.length; i++) g.lineTo(r[i][0] * k, r[i][1] * k); if (close) g.closePath(); } };
  for (const { st, f } of items) {
    const rs = OSM.rings(f.geom);
    g.globalAlpha = st.alpha;
    if (st.fill) {
      path(rs, true); g.fillStyle = st.fill; g.fill('evenodd');
      if (st.edge && size >= 512) { g.globalAlpha = 0.6; g.strokeStyle = st.edge; g.lineWidth = 1; g.stroke(); }
    } else {
      const wpx = Math.max(st.width / mPerPx, 0.8);
      if (st.casing) { path(rs, false); g.strokeStyle = '#3e3b38'; g.lineWidth = wpx + Math.max(1.2, 2.5 / mPerPx); g.stroke(); }
      path(rs, false); g.strokeStyle = st.line; g.lineWidth = wpx; g.stroke();
      if (st.center && wpx > 3) { g.globalAlpha = 0.8; path(rs, false); g.strokeStyle = st.center; g.lineWidth = Math.max(0.8, 0.6 / mPerPx); g.stroke(); }
    }
  }
  return cv.transferToImageBitmap();
}

self.onmessage = e => {
  const m = e.data;
  try {
    let T = cache.get(m.key);
    if (!T && m.buf) { T = OSM.decodeTile(new Uint8Array(m.buf), OSM.LAYERS); cache.set(m.key, T); if (cache.size > 48) cache.delete(cache.keys().next().value); }
    if (!T) { self.postMessage({ id: m.id, key: m.key, miss: true }); return; }
    cache.delete(m.key); cache.set(m.key, T);   // most recently used
    const r = m.rect, ext = 4096, W = r.x1 - r.x0, D = r.z1 - r.z0;
    const out = { id: m.id, key: m.key }, transfer = [];
    if (m.overlay) { self.__mpp = W / m.overlay; out.overlay = paintOverlay(T, m.overlay); if (out.overlay) transfer.push(out.overlay); }
    const ground = m.grid ? groundSampler(r, m.grid, m.n) : null;
    const toLocal = (px, py) => [r.x0 + px / ext * W, r.z0 + py / ext * D];
    if (m.build && T.building && ground) {
      const b = OSM.buildBuildings(T.building.features, { extent: ext, toLocal, groundAt: ground, metresPerUnit: W / ext,
        minArea: m.build === 'lod' ? 180 : 0, simple: m.build === 'lod' });
      for (let i = 0; i < b.col.length; i++) b.col[i] = toLin(b.col[i]);
      out.mesh = { pos: b.pos, nor: b.nor, col: b.col, uv: b.uv }; out.buildings = b.count; out.mode = m.build;
      transfer.push(b.pos.buffer, b.nor.buffer, b.col.buffer, b.uv.buffer);
    }
    if (m.trees && ground) {
      const pts = OSM.treePoints(T, m.trees, m.seed || 1), arr = new Float32Array(pts.length * 4);
      pts.forEach((p, i) => { const [x, z] = toLocal(p[0], p[1]); arr[i * 4] = x; arr[i * 4 + 1] = ground(x, z); arr[i * 4 + 2] = z; arr[i * 4 + 3] = p[2]; });
      out.trees = arr; transfer.push(arr.buffer);
    }
    self.postMessage(out, transfer);
  } catch (err) {
    self.postMessage({ id: m.id, key: m.key, error: String(err && err.message || err) });
  }
};
