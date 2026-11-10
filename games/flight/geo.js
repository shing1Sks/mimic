/*
 * GYROWING real world, the pure part (no DOM, no three.js; loads in Node for tests):
 *   web-mercator tile maths, terrarium elevation decoding, a local metric frame around a chosen
 *   origin, quadtree LOD selection, the airport database (OurAirports), runway geometry, the
 *   preset locations and the challenges each location offers.
 *
 * Local frame: x east, z south (metres), like the island; heading 0 = north = -z. It is web
 * mercator scaled by cos(origin latitude), so it is conformal (true bearings) and a mercator tile
 * is an exact rectangle in it. Over the ~100 km you can fly the scale error stays under 1.5%.
 */
(function (root) {
  'use strict';
  const R = 6378137, C = 2 * Math.PI * R, DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------------------------------------------------------------- sources
  const SOURCES = {
    elevation: { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', maxZoom: 12, concurrency: 4 },
    imagery: { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg', maxZoom: 14, concurrency: 4 },
  };
  const ATTRIBUTION = {
    short: 'Imagery: Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0 · ' +
      'Elevation: Mapzen Terrain Tiles on AWS (SRTM, GMTED2010, 3DEP: USGS; ETOPO1: NOAA; EU-DEM: Copernicus; and others) · Airports: OurAirports (public domain)',
  };
  const fill = (u, z, x, y) => u.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const elevationUrl = (z, x, y) => fill(SOURCES.elevation.url, z, x, y);
  const imageryUrl = (z, x, y) => fill(SOURCES.imagery.url, z, x, y);

  // ---------------------------------------------------------------- tile maths
  /** Fractional tile coordinates of a lon/lat at zoom z. */
  function lonLatToTile(lon, lat, z) {
    const n = Math.pow(2, z), s = Math.sin(clamp(lat, -85.05112878, 85.05112878) * DEG);
    return { x: (lon + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
  }
  /** Lon/lat of fractional tile coordinates (the NW corner for integers). */
  function tileToLonLat(x, y, z) {
    const n = Math.pow(2, z);
    return { lon: x / n * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / DEG };
  }
  const mercX = lon => lon * DEG * R;
  const mercY = lat => R * Math.log(Math.tan(Math.PI / 4 + clamp(lat, -85.05112878, 85.05112878) * DEG / 2));

  /** The local metric frame around (lat0, lon0). */
  function frame(lat0, lon0) {
    const k = Math.cos(lat0 * DEG), mx0 = mercX(lon0), my0 = mercY(lat0);
    const F = {
      lat0, lon0, k,
      toLocal(lon, lat) { return { x: (mercX(lon) - mx0) * k, z: (my0 - mercY(lat)) * k }; },
      toLonLat(x, z) { const mx = mx0 + x / k, my = my0 - z / k; return { lon: mx / R / DEG, lat: (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) / DEG }; },
      /** Local rectangle of tile (z, tx, ty): x0 west, x1 east, z0 north, z1 south. */
      tileRect(z, tx, ty) {
        const n = Math.pow(2, z), s = C / n;
        const mxa = tx * s - C / 2, mxb = mxa + s, mya = C / 2 - ty * s, myb = mya - s;
        return { x0: (mxa - mx0) * k, x1: (mxb - mx0) * k, z0: (my0 - mya) * k, z1: (my0 - myb) * k };
      },
      /** Fractional tile coordinates of a local point. */
      localToTile(x, z, zoom) {
        const n = Math.pow(2, zoom), mx = mx0 + x / k, my = my0 - z / k;
        return { x: (mx + C / 2) / C * n, y: (C / 2 - my) / C * n };
      },
    };
    return F;
  }

  // ---------------------------------------------------------------- elevation
  /** Terrarium: height in metres = (R * 256 + G + B / 256) - 32768. */
  const decodeTerrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;
  function decodeTerrariumImage(px, w, h) {
    const out = new Float32Array(w * h);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
    return out;
  }
  /** Bilinear sample of a square n x n grid at pixel coordinates (u, v), clamped to the edges. */
  function sampleGrid(g, n, u, v) {
    u = clamp(u, 0, n - 1); v = clamp(v, 0, n - 1);
    const i = Math.min(Math.floor(u), n - 2), j = Math.min(Math.floor(v), n - 2), fu = u - i, fv = v - j;
    const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }
  /**
   * Which elevation tile feeds a node: the node itself up to the source's max zoom, else the
   * ancestor at maxZoom; (u0, v0, size) is the node's square inside it (fractions of the tile).
   */
  function elevationSource(z, x, y, maxZoom) {
    if (z <= maxZoom) return { z, x, y, u0: 0, v0: 0, size: 1 };
    const d = z - maxZoom, f = Math.pow(2, d);
    const ax = Math.floor(x / f), ay = Math.floor(y / f);
    return { z: maxZoom, x: ax, y: ay, u0: (x - ax * f) / f, v0: (y - ay * f) / f, size: 1 / f };
  }

  // ---------------------------------------------------------------- LOD
  /**
   * Quadtree selection: root tiles at rootZoom within `radius` metres of the camera, split while
   * the camera is closer than splitK x the tile size (3D distance, so climbing coarsens the
   * terrain), down to maxZoom. Returns the leaves { z, x, y, key, rect, d }, nearest first.
   */
  function selectTiles(F, cam, o) {
    const out = [], agl = Math.max(0, cam.agl || 0);
    const a = F.localToTile(cam.x - o.radius, cam.z - o.radius, o.rootZoom), b = F.localToTile(cam.x + o.radius, cam.z + o.radius, o.rootZoom);
    const dist = r => {
      const dx = Math.max(r.x0 - cam.x, 0, cam.x - r.x1), dz = Math.max(r.z0 - cam.z, 0, cam.z - r.z1);
      return { h: Math.hypot(dx, dz), d: Math.hypot(dx, dz, agl) };
    };
    const visit = (z, x, y) => {
      const rect = F.tileRect(z, x, y), dd = dist(rect), size = rect.x1 - rect.x0;
      if (z < o.maxZoom && dd.d < o.splitK * size) {
        visit(z + 1, 2 * x, 2 * y); visit(z + 1, 2 * x + 1, 2 * y); visit(z + 1, 2 * x, 2 * y + 1); visit(z + 1, 2 * x + 1, 2 * y + 1);
      } else out.push({ z, x, y, key: z + '/' + x + '/' + y, rect, d: dd.d });
    };
    const n = Math.pow(2, o.rootZoom);
    for (let ty = Math.max(0, Math.floor(a.y)); ty <= Math.min(n - 1, Math.floor(b.y)); ty++) {
      for (let tx = Math.floor(a.x); tx <= Math.floor(b.x); tx++) {
        const wx = ((tx % n) + n) % n;
        if (wx !== tx) continue;   // no wrap across the antimeridian
        if (dist(F.tileRect(o.rootZoom, tx, ty)).h > o.radius) continue;
        visit(o.rootZoom, tx, ty);
      }
    }
    return out.sort((p, q) => p.d - q.d);
  }

  // ---------------------------------------------------------------- airports
  const TYPE = { L: 'large', M: 'medium', S: 'small' };
  /** Rows of data/airports.json -> airport objects (lat/lon, elevation m, runways raw). */
  function loadAirports(rows) {
    return rows.map(r => ({ id: r[0], iata: r[1], name: r[2], lat: r[3], lon: r[4], elev: r[5], type: TYPE[r[6]] || 'small', city: r[7], country: r[8], rw: r[9] }));
  }
  function haversineKm(la1, lo1, la2, lo2) {
    const a = Math.sin((la2 - la1) * DEG / 2) ** 2 + Math.cos(la1 * DEG) * Math.cos(la2 * DEG) * Math.sin((lo2 - lo1) * DEG / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  /** Airports matching a code (ICAO, IATA) or words of a name / city, best first. */
  function searchAirports(db, q, n) {
    const s = norm(q); if (!s) return [];
    const rank = { large: 0, medium: 1, small: 2 };
    const hits = [];
    for (const a of db) {
      let score = -1;
      if (a.id.toLowerCase() === s) score = 100;
      else if (a.iata && a.iata.toLowerCase() === s) score = 95;
      else {
        const name = norm(a.name), city = norm(a.city);
        if (city === s) score = 60; else if (name.split(/[^a-z0-9]+/).includes(s)) score = 50;
        else if (city.startsWith(s) || name.startsWith(s)) score = 40; else if (s.length > 3 && (name.includes(s) || city.includes(s))) score = 30;
      }
      if (score >= 0) hits.push({ a, score: score - rank[a.type] * 4 });
    }
    return hits.sort((p, q2) => q2.score - p.score).slice(0, n || 8).map(h => h.a);
  }
  function findAirport(db, q) { return searchAirports(db, q, 1)[0] || null; }
  function nearestAirports(db, lat, lon, n, maxKm) {
    const out = [];
    for (const a of db) { if (Math.abs(a.lat - lat) > maxKm / 100 + 0.1) continue; const km = haversineKm(lat, lon, a.lat, a.lon); if (km <= maxKm) out.push(Object.assign({ km }, a)); }
    return out.sort((p, q) => p.km - q.km).slice(0, n);
  }

  // ---------------------------------------------------------------- runways
  const wrap360 = a => ((a % 360) + 360) % 360;
  const bearing = (a, b) => wrap360(Math.atan2(b.x - a.x, -(b.z - a.z)) / DEG);
  /**
   * Runways of an airport in the local frame, one entry per landing direction:
   * { name, recip, thr {x,z}, end {x,z}, hdg (true deg), len, width, paved, approx, airport }.
   */
  function runwaysLocal(F, ap) {
    const out = [];
    for (const r of ap.rw) {
      const [le, he, lenM, width, paved] = r;
      let a, b, approx = false;
      if (r.length >= 9) {
        a = F.toLocal(r[6], r[5]); b = F.toLocal(r[8], r[7]);
        if (Math.hypot(b.x - a.x, b.z - a.z) < 0.5 * lenM) a = null;   // broken ends in the data
      }
      if (!a) {
        let hdg = r.length === 6 ? r[5] : (parseInt(le, 10) || 9) * 10;
        if (r.length >= 9 && !(r.length === 6)) { const m = parseInt(le, 10); if (m >= 1 && m <= 36) hdg = m * 10; }
        const c = F.toLocal(ap.lon, ap.lat), f = { x: Math.sin(hdg * DEG), z: -Math.cos(hdg * DEG) };
        a = { x: c.x - f.x * lenM / 2, z: c.z - f.z * lenM / 2 }; b = { x: c.x + f.x * lenM / 2, z: c.z + f.z * lenM / 2 }; approx = true;
      }
      const len = Math.hypot(b.x - a.x, b.z - a.z), hdg = bearing(a, b);
      const base = { len, width: Math.max(18, width || 30), paved: !!paved, approx, airport: ap.id };
      out.push(Object.assign({ name: le, recip: he, thr: a, end: b, hdg }, base));
      out.push(Object.assign({ name: he, recip: le, thr: b, end: a, hdg: wrap360(hdg + 180) }, base));
    }
    return out;
  }
  /** Unit direction, aiming point and helpers of a runway (landing direction). */
  function runwayFrame(rw) {
    const d = { x: (rw.end.x - rw.thr.x) / rw.len, z: (rw.end.z - rw.thr.z) / rw.len };
    const aimDist = Math.min(300, rw.len * 0.18);
    return { dir: d, aimDist, aim: { x: rw.thr.x + d.x * aimDist, z: rw.thr.z + d.z * aimDist } };
  }
  function onRunway(rw, x, z, margin) {
    const f = runwayFrame(rw), dx = x - rw.thr.x, dz = z - rw.thr.z;
    const along = dx * f.dir.x + dz * f.dir.z, across = dx * -f.dir.z + dz * f.dir.x;
    return along >= -(margin || 0) && along <= rw.len + (margin || 0) && Math.abs(across) <= rw.width / 2 + (margin || 0);
  }
  /** The runway to use: into the wind (from windFromDeg), long and paved preferred. */
  function pickRunway(rws, windFromDeg) {
    let best = null, bs = -1e9;
    for (const r of rws) {
      const head = windFromDeg === undefined || windFromDeg === null ? 0 : Math.cos((r.hdg - windFromDeg) * DEG);
      const sc = head + 0.15 * Math.min(r.len / 3000, 1.3) + (r.paved ? 0.3 : 0) - (r.approx ? 0.05 : 0);
      if (sc > bs) { bs = sc; best = r; }
    }
    return best;
  }

  // ---------------------------------------------------------------- locations
  /**
   * Hand-picked places. airport: where you start (runway into the wind). air: an airborne start
   * instead (lat, lon, alt m MSL, hdg). tour: the sightseeing route (alt m MSL is a hint), ending
   * with a landing at tourEnd. hop: a neighbour to fly to. rings: where the ring course starts.
   */
  const PRESETS = [
    { id: 'blr', name: 'Bengaluru', sub: 'HAL Airport (VOBG), Karnataka', airport: 'VOBG', hop: 'VOBL',
      blurb: 'The Deccan plateau at 3,000 ft: city lakes, Cubbon Park and the granite of Nandi Hills.',
      tour: [
        { name: 'Ulsoor Lake', lat: 12.9810, lon: 77.6200, alt: 1250, say: 'Ulsoor Lake, in the old cantonment. The city sprawls across a plateau 900 m above the sea.' },
        { name: 'Vidhana Soudha and Cubbon Park', lat: 12.9796, lon: 77.5907, alt: 1250, say: 'Vidhana Soudha, the state legislature, and the green block of Cubbon Park.' },
        { name: 'Nandi Hills', lat: 13.3702, lon: 77.6835, alt: 1750, r: 1800, say: 'Nandi Hills: a granite outcrop 1,478 m high, where Bengaluru goes to watch the sunrise.' },
      ], tourEnd: 'VOBL', rings: { lat: 13.30, lon: 77.62, hdg: 30 } },
    { id: 'bom', name: 'Mumbai', sub: 'Chhatrapati Shivaji Maharaj Intl (VABB)', airport: 'VABB',
      blurb: 'Down the coast: the Sea Link, Marine Drive, the Gateway of India and Elephanta Island.',
      tour: [
        { name: 'the Bandra-Worli Sea Link', lat: 19.0380, lon: 72.8175, alt: 450, say: 'The Bandra-Worli Sea Link: 5.6 km of cable-stayed bridge across Mahim Bay.' },
        { name: 'Marine Drive', lat: 18.9432, lon: 72.8231, alt: 450, say: 'Marine Drive, the Queen\'s Necklace: the curve of streetlights along Back Bay.' },
        { name: 'the Gateway of India', lat: 18.9220, lon: 72.8347, alt: 400, say: 'The Gateway of India, built in 1924 on the Apollo Bunder waterfront.' },
        { name: 'Elephanta Island', lat: 18.9633, lon: 72.9315, alt: 450, say: 'Elephanta Island and its rock-cut cave temples, out in the harbour.' },
      ], tourEnd: 'VABB', rings: { lat: 19.25, lon: 73.05, hdg: 200 } },
    { id: 'leh', name: 'Leh, Himalayas', sub: 'Kushok Bakula Rimpochee Airport (VILH), Ladakh', airport: 'VILH', hop: false,
      blurb: 'One of the highest airfields on Earth (10,682 ft). Thin air, long takeoff rolls, giant peaks.',
      tour: [
        { name: 'Shey Palace', lat: 34.0717, lon: 77.6375, alt: 3600, say: 'Shey Palace, the old summer capital of Ladakh. The air here has a third less oxygen: your engine feels it.' },
        { name: 'Thiksey Monastery', lat: 34.0558, lon: 77.6670, alt: 3650, say: 'Thiksey Monastery, stacked up its hill like the Potala in Lhasa.' },
        { name: 'the Stok range, south of the Indus', lat: 34.03, lon: 77.53, alt: 3700, r: 2500, say: 'The Stok range: Stok Kangri tops out at 6,153 m, far above what this trainer can climb to.' },
      ], tourEnd: 'VILH', rings: { lat: 34.09, lon: 77.60, hdg: 125 } },
    { id: 'zermatt', name: 'Zermatt, Swiss Alps', sub: 'airborne in the Mattertal, land at Sion (LSGS)', airport: 'LSGS',
      air: { lat: 46.13, lon: 7.80, alt: 3900, hdg: 195 }, hop: 'LSGS',
      blurb: 'Fly up the Mattertal at 12,800 ft past the Weisshorn and the Dom to the Matterhorn.',
      tour: [
        { name: 'Zermatt', lat: 46.0207, lon: 7.7491, alt: 3500, say: 'Zermatt: no cars, a lot of chalets, and the Matterhorn at the end of the valley.' },
        { name: 'the Matterhorn', lat: 45.9890, lon: 7.6760, alt: 3900, r: 1800, say: 'The Matterhorn, 4,478 m. Its north face drops 1,200 m below you.' },
        { name: 'Gornergrat', lat: 45.9837, lon: 7.7847, alt: 3700, r: 1500, say: 'Gornergrat and the Gorner glacier, with Monte Rosa, the highest Swiss summit, beyond.' },
      ], tourEnd: 'LSGS', rings: { lat: 46.16, lon: 7.80, hdg: 190 } },
    { id: 'sfo', name: 'San Francisco', sub: 'San Francisco Intl (KSFO), California', airport: 'KSFO', hop: 'KOAK',
      blurb: 'Up the Bay: the Golden Gate Bridge, Alcatraz and the Bay Bridge, then land at Oakland.',
      tour: [
        { name: 'the Golden Gate Bridge', lat: 37.8199, lon: -122.4783, alt: 450, say: 'The Golden Gate Bridge: its towers stand 227 m above the water. Stay above them.' },
        { name: 'Alcatraz', lat: 37.8270, lon: -122.4230, alt: 400, say: 'Alcatraz Island, the old federal prison in the middle of the Bay.' },
        { name: 'the Bay Bridge', lat: 37.7983, lon: -122.3778, alt: 450, say: 'The San Francisco-Oakland Bay Bridge. Oakland airport is south-east: look for runway 30.' },
      ], tourEnd: 'KOAK', rings: { lat: 37.73, lon: -122.47, hdg: 330 } },
    { id: 'gcn', name: 'Grand Canyon', sub: 'Grand Canyon National Park Airport (KGCN), Arizona', airport: 'KGCN',
      blurb: 'Over the South Rim and down into the canyon, 1,500 m deep, then along the Colorado.',
      tour: [
        { name: 'the South Rim at Grand Canyon Village', lat: 36.0544, lon: -112.1401, alt: 2450, say: 'The South Rim. The Colorado River is a mile below; the far rim is 16 km away.' },
        { name: 'Phantom Ranch, on the river', lat: 36.1056, lon: -112.0950, alt: 2100, say: 'Phantom Ranch, at the bottom by the Colorado. The canyon walls are two billion years of rock.' },
        { name: 'the Desert View Watchtower', lat: 36.0441, lon: -111.8261, alt: 2400, say: 'The Desert View Watchtower, where the canyon turns north toward the Painted Desert.' },
      ], tourEnd: 'KGCN', rings: { lat: 36.075, lon: -112.15, hdg: 70 } },
    { id: 'hnl', name: 'Honolulu, Hawaii', sub: 'Daniel K. Inouye Intl (PHNL), Oahu', airport: 'PHNL',
      blurb: 'Pearl Harbor, Waikiki, Diamond Head crater and Koko Head along the Oahu shore.',
      tour: [
        { name: 'Pearl Harbor', lat: 21.3649, lon: -157.9500, alt: 350, say: 'Pearl Harbor and the USS Arizona memorial, the white bridge over the sunken battleship.' },
        { name: 'Waikiki', lat: 21.2793, lon: -157.8292, alt: 350, say: 'Waikiki beach and its hotels, with the Ko\'olau mountains behind the city.' },
        { name: 'Diamond Head', lat: 21.2614, lon: -157.8056, alt: 400, say: 'Diamond Head, a 300,000-year-old tuff cone, the crater wide open below you.' },
        { name: 'Koko Crater', lat: 21.2817, lon: -157.6884, alt: 450, say: 'Koko Head and Hanauma Bay, the snorkellers\' crater bay, on the east tip of Oahu.' },
      ], tourEnd: 'PHNL', rings: { lat: 21.40, lon: -157.80, hdg: 320 } },
  ];

  /** Resolve a preset (or { airport: code }) into a location: frame, airport, start runway. */
  function locationFor(db, p, windFromDeg) {
    const ap = findAirport(db, p.airport);
    if (!ap) return null;
    const o = p.air || ap;
    const F = frame(o.lat, o.lon);
    const local = localAirport(F, ap);
    const rw = pickRunway(local.runways, windFromDeg === undefined ? 270 : windFromDeg);
    const start = p.air ? Object.assign({ kind: 'air' }, F.toLocal(p.air.lon, p.air.lat), { alt: p.air.alt, hdg: p.air.hdg }) : { kind: 'runway', airport: ap.id, runway: rw };
    return { id: p.id || ap.id, name: p.name || shortName(ap), sub: p.sub || (ap.name + ' (' + ap.id + ')' + (ap.city ? ', ' + ap.city : '')), blurb: p.blurb || '', preset: p.id ? p : null, frame: F, airport: local, start, lat: o.lat, lon: o.lon };
  }
  function localAirport(F, ap) { const c = F.toLocal(ap.lon, ap.lat); return Object.assign({}, ap, { x: c.x, z: c.z, runways: runwaysLocal(F, ap) }); }
  function shortName(ap) {
    return ap.name.replace(/\b(International|Intl\.?|Airport|Aerodrome|Airfield|Air Base|National Park|Regional|Municipal)\b/g, '').replace(/\s+/g, ' ').trim() || ap.name;
  }
  const kmStr = m => (m / 1000).toFixed(0) + ' km';
  const dirName = deg => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(wrap360(deg) / 45) % 8];

  function landStep(ap, rw) {
    const f = runwayFrame(rw);
    return { kind: 'land', airport: ap.id, rwy: rw.name, name: 'Land on runway ' + rw.name + ' at ' + shortName(ap), x: f.aim.x, z: f.aim.z, rwyHdg: rw.hdg, scored: true };
  }
  /** A point on the extended centreline `dist` metres before the threshold, `agl` above it. */
  function finalFix(ap, rw, dist, agl) {
    const f = runwayFrame(rw);
    return { x: rw.thr.x - f.dir.x * dist, z: rw.thr.z - f.dir.z * dist, alt: ap.elev + agl };
  }

  /**
   * What you can do at a location. Each challenge: { id, name, blurb, goal (the one line shown when
   * the flight starts), start, steps } in the shape missions.js tracks. Rings need terrain heights,
   * so they are planned in the browser (ringsStart says where).
   */
  function planChallenges(db, loc, o) {
    const F = loc.frame, home = loc.airport, P = loc.preset || {}, wind = (o && o.windFromDeg) !== undefined ? o.windFromDeg : 270;
    const homeRw = pickRunway(home.runways, wind);
    const out = [];
    const air = loc.start.kind === 'air';
    const startRunway = air ? null : { kind: 'runway', airport: home.id, runway: homeRw };
    const startAir = air ? loc.start : null;
    // ---- the scenic tour
    if (P.tour) {
      const endAp = localAirport(F, findAirport(db, P.tourEnd || home.id));
      const endRw = pickRunway(endAp.runways, wind);
      const steps = [];
      if (!air) steps.push({ kind: 'takeoff', name: 'Take off', say: 'Climb out and turn toward ' + P.tour[0].name + '. Follow the arrow.' });
      P.tour.forEach((w, i) => { const c = F.toLocal(w.lon, w.lat); steps.push({ kind: 'waypoint', name: w.name, x: c.x, z: c.z, r: w.r || 900, alt: w.alt, say: w.say + (i === P.tour.length - 1 ? ' Now head for ' + shortName(endAp) + ', runway ' + endRw.name + '.' : '') }); });
      const fx = finalFix(endAp, endRw, 5000, 300);
      steps.push({ kind: 'waypoint', name: 'the ' + endRw.name + ' final, 5 km out', x: fx.x, z: fx.z, r: 1200, alt: fx.alt, say: 'Line up with runway ' + endRw.name + '. Gear down, flaps, slow to about 65 kt and descend.' });
      steps.push(landStep(endAp, endRw));
      out.push({ id: 'tour', name: 'Sightseeing tour', blurb: P.tour.map(w => w.name.replace(/^the /, '')).join(' · '), goal: 'Fly the tour: ' + P.tour[0].name + ' first, then land at ' + shortName(endAp),
        start: startAir || startRunway, steps });
    }
    // ---- a hop to a real neighbour
    const near = P.hop === false ? [] : P.hop ? [findAirport(db, P.hop)].filter(Boolean) : nearestAirports(db, loc.lat, loc.lon, 40, 90).filter(a => a.id !== home.id && a.km > 10 && a.rw.some(r => r[4] && r[2] >= 1200));
    const dest = near.sort((a, b) => ({ large: 0, medium: 1, small: 2 })[a.type] - ({ large: 0, medium: 1, small: 2 })[b.type] || (a.km || 0) - (b.km || 0))[0];
    if (dest && dest.id !== (air ? '' : home.id)) {
      const dAp = localAirport(F, dest), dRw = pickRunway(dAp.runways, wind);
      const fx = finalFix(dAp, dRw, 8000, 450);
      const startPt = air ? { x: loc.start.x, z: loc.start.z } : { x: homeRw.thr.x, z: homeRw.thr.z };
      const dist = Math.hypot(dAp.x - startPt.x, dAp.z - startPt.z);
      const dir = dirName(bearing(startPt, dAp));
      const steps = [];
      if (!air) steps.push({ kind: 'takeoff', name: 'Take off', say: shortName(dAp) + ' is ' + kmStr(dist) + ' ' + dir + '. Climb and follow the arrow.' });
      steps.push({ kind: 'waypoint', name: 'the ' + dRw.name + ' final at ' + shortName(dAp).split(' ').slice(0, 2).join(' ') + ', 8 km out', x: fx.x, z: fx.z, r: 1500, alt: fx.alt, say: 'On an 8 km final for runway ' + dRw.name + ': gear down, flaps, 65 kt, follow the PAPI.' });
      steps.push(landStep(dAp, dRw));
      out.push({ id: 'hop', name: 'Fly to ' + shortName(dAp), blurb: 'A real cross-country hop: ' + kmStr(dist) + ' ' + dir + ' to ' + dAp.name + ', land on ' + dRw.name + '.',
        goal: 'Fly ' + kmStr(dist) + ' ' + dir + ' and land at ' + shortName(dAp), start: startAir || startRunway, steps, distKm: dist / 1000, dest: dAp.id });
    }
    // ---- landing challenge: on a 4 km final to the home runway (or the tour end for air starts)
    {
      const lAp = air ? localAirport(F, findAirport(db, P.tourEnd || home.id)) : home, lRw = pickRunway(lAp.runways, wind);
      const fx = finalFix(lAp, lRw, 4000, 4000 * Math.tan(3 * DEG) + 1.25);
      out.push({ id: 'landing', name: 'Landing: ' + shortName(lAp) + ' ' + lRw.name, blurb: 'On a 4 km final, gear and flaps down. Follow the PAPI lights. Scored on the touchdown.',
        goal: 'Land on runway ' + lRw.name + ' at ' + shortName(lAp) + ', straight ahead',
        start: { kind: 'air', x: fx.x, z: fx.z, alt: fx.alt, hdg: lRw.hdg, speed: 37, flaps: 1, gear: true, final: true }, steps: [landStep(lAp, lRw)] });
    }
    // ---- ring time trial over the real terrain (planned in the browser from the heights)
    const rs = P.rings ? Object.assign(F.toLocal(P.rings.lon, P.rings.lat), { hdg: P.rings.hdg }) : (air ? { x: loc.start.x, z: loc.start.z, hdg: loc.start.hdg } : null);
    // ---- low pass: two minutes low and fast over the real ground, scored by skim.js
    const ls = rs || { x: (startRunway ? homeRw.thr.x : 0), z: (startRunway ? homeRw.thr.z : 0), hdg: startRunway ? homeRw.hdg : 0 };
    out.unshift({ id: 'lowpass', name: 'Low pass', blurb: 'Two minutes low and fast over the real ground. Ridges, valleys and rolls score.', goal: 'Low pass: get under 200 ft at speed and stay there. 2:00 on the clock',
      skimStart: ls, steps: [] });
    if (rs) out.push({ id: 'rings', name: 'Ring run', blurb: 'Eight rings low over the real terrain, against the clock.', goal: 'Fly through 8 rings, low and fast. Follow the arrow', ringsStart: rs, steps: [] });
    // ---- free flight
    out.push({ id: 'free', name: 'Free flight', blurb: air ? 'No goal: you are airborne, go and look around.' : 'Runway ' + homeRw.name + ', engine idling. No goal: fly anywhere you like.',
      goal: 'Free flight: go anywhere. Land on any runway you find', start: startAir || startRunway, steps: [] });
    return out;
  }

  const api = { SOURCES, ATTRIBUTION, elevationUrl, imageryUrl, lonLatToTile, tileToLonLat, frame, decodeTerrarium, decodeTerrariumImage, sampleGrid, elevationSource, selectTiles,
    loadAirports, searchAirports, findAirport, nearestAirports, haversineKm, runwaysLocal, runwayFrame, onRunway, pickRunway, PRESETS, locationFor, localAirport, planChallenges, shortName, bearing, dirName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Geo = api;
})(typeof window !== 'undefined' ? window : null);
