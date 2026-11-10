# GYROWING asset credits

Everything else (terrain, sky, clouds, water, trees, villages, airfields, the aircraft and its cockpit,
the synthesised engine, horns and clunks) is procedural code in this folder.

## Textures (`assets/tex/`) — Poly Haven, CC0 (public domain)

| File | Asset | Author | Source |
|---|---|---|---|
| forrest_ground_01_diff.jpg | Forest Ground 01 | Rob Tuytel | https://polyhaven.com/a/forrest_ground_01 |
| aerial_grass_rock_diff.jpg | Aerial Grass Rock | Rob Tuytel | https://polyhaven.com/a/aerial_grass_rock |
| aerial_rocks_02_diff.jpg | Aerial Rocks 02 | Rob Tuytel | https://polyhaven.com/a/aerial_rocks_02 |
| dirt_aerial_02_diff.jpg | Dirt Aerial 02 | Rob Tuytel | https://polyhaven.com/a/dirt_aerial_02 |
| aerial_beach_01_diff.jpg | Aerial Beach 01 | Rob Tuytel | https://polyhaven.com/a/aerial_beach_01 |
| snow_field_aerial_diff.jpg | Snow Field Aerial | Rob Tuytel | https://polyhaven.com/a/snow_field_aerial |
| asphalt_02_diff.jpg | Asphalt 02 | Rob Tuytel | https://polyhaven.com/a/asphalt_02 |
| corrugated_iron_02_diff.jpg | Corrugated Iron 02 | Jenelle van Heerden, Sergej Majboroda | https://polyhaven.com/a/corrugated_iron_02 |

All 1k JPG diffuse maps, unmodified.

## Sounds (`assets/snd/`) — OpenGameArt

| File | Title | Author | Licence | Source |
|---|---|---|---|---|
| prop_loop.ogg | Airplane Prop Loop | jakobthiesen (recording), edited to loop by Jordan Irwin (AntumDeluge) | CC-BY 3.0 | https://opengameart.org/content/airplane-prop-loop |
| wind_loop.ogg | Wind Loop | InspectorJ (recording), looped by Jordan Irwin (AntumDeluge) | CC-BY 3.0 | https://opengameart.org/content/wind-loop |

Converted to mono Ogg Vorbis with ffmpeg; otherwise unchanged.

## Models (`assets/models/`) — Poly Pizza

| File | Title | Author | Licence | Source |
|---|---|---|---|---|
| sailboat.glb | Sail Boat | Quaternius | CC0 | https://poly.pizza/m/BgSZXwmm7k |
| car.glb | Red Car | J-Toastie | CC-BY 3.0 | https://poly.pizza/m/dVLJ5CjB0h |
| lighthouse.glb | Lighthouse | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/0t2ZYRBsqX- |

Used as downloaded (rescaled and instanced at runtime).

## Real-world data (streamed at runtime, not stored in this folder)

The real-world mode downloads map tiles around the aircraft from the public servers below and keeps
them in the browser's Cache Storage (`gyrowing-tiles-v1`). The same credit line is shown on screen
whenever the real world is visible.

### Satellite imagery: Sentinel-2 cloudless 2016 by EOX, CC BY 4.0

- Tiles: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg` (zoom 11 to 14).
- Required attribution: **Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains
  modified Copernicus Sentinel data 2016)**, licensed under Creative Commons Attribution 4.0
  (https://creativecommons.org/licenses/by/4.0/). EOX's capabilities document now calls the same
  layer "EOxCloudless https://cloudless.eox.at".
- Only the 2016 layer (`s2cloudless_3857`) is CC BY 4.0. The 2018 and later layers are CC BY-NC-SA 4.0,
  so the game deliberately uses the 2016 one. Checked 2026-11-09 against
  `https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml`.

### Elevation: Mapzen Terrain Tiles on AWS (Registry of Open Data)

- Tiles: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (terrarium PNG,
  height = R * 256 + G + B / 256 - 32768 metres, zoom 9 to 12), no key, CORS open.
- Required attribution (https://github.com/tilezen/joerd/blob/master/docs/attribution.md):
  - ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National
    Science Foundation awards 1043681, 1559691, and 1542736;
  - Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;
  - Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich;
  - Canada terrain data contains information licensed under the Open Government Licence – Canada;
  - Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers;
  - Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration;
  - Mexico terrain data source: INEGI, Continental relief, 2016;
  - New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New
    Zealand Government (All rights reserved);
  - Norway terrain data © Kartverket;
  - United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved;
  - United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S.
    Geological Survey.

### Airports and runways: OurAirports, public domain

- `data/airports.json` is built from https://davidmegginson.github.io/ourairports-data/airports.csv and
  runways.csv (data of 2026-11-08) by `tools/build_airports.py`: large and medium airports, small ones
  with a paved runway, open runways of 1,500 ft or more. OurAirports data is released into the public
  domain (https://ourairports.com/data/); credited anyway.

### Map data: OpenStreetMap, via OpenMapTiles vector tiles from OpenFreeMap

- Buildings (footprints, `render_height`, `colour`), roads, railways, rivers, lakes, the sea, land use,
  woods and parks, and airfield runways, taxiways and aprons, streamed around the aircraft in the
  real-world mode (`osm.js`, `osm-worker.js`, `osm-layer.js`).
- Data (c) OpenStreetMap contributors, Open Database License (ODbL 1.0):
  https://www.openstreetmap.org/copyright
- Vector tile schema (c) OpenMapTiles: https://www.openmaptiles.org/
- Tiles served by OpenFreeMap (https://openfreemap.org): a free public instance with no API keys and
  no stated request limits. Attribution is required for custom clients, so the game shows
  "(c) OpenStreetMap contributors, (c) OpenMapTiles, OpenFreeMap" in the corner during real-world
  flights, and the full line on the menus.
- Good-citizen rules the game follows: only tiles around the aircraft (zoom 13 and 14), nearest
  first, at most 2 requests at a time (the OpenFreeMap terms allow 4 for offline downloads); every
  tile is kept in the browser's Cache Storage (`gyrowing-osm-v1`), so revisits download nothing;
  failures back off, and repeated failures pause the layer for two minutes. With the layer off
  (Options > Real world: buildings and map > Off) nothing is requested.

### Ground detail texture

The real-world terrain reuses `aerial_grass_rock_diff.jpg` (Poly Haven, CC0, above) as a brightness-only
detail layer near the camera.

## Code

- The sky shader in `atmos.js` follows three.js' `Sky` example (Preetham et al. scattering), MIT licence.
- three.js r149 and its GLTF/RGBE loaders are shared from `games/lib/` (MIT).
