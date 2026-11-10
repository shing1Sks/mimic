# Third-party code, assets and data

Mimic's own code is MIT licensed (see [LICENSE](LICENSE)). This file lists everything in the repository
that was made by someone else, plus the online data one game streams at runtime. Each game folder
also keeps its own credits file next to its assets; this file collects them in one place.

Licences used here, all of which allow redistribution in a public repository and in modified form:

| Short name | Full licence | What it asks of us |
|---|---|---|
| CC0 1.0 | https://creativecommons.org/publicdomain/zero/1.0/ | Nothing (public domain dedication). Credited anyway. |
| Public domain | (author's dedication) | Nothing. Credited anyway. |
| CC-BY 3.0 | https://creativecommons.org/licenses/by/3.0/ | Credit the author, link the licence, say if the work was changed. |
| CC-BY 4.0 | https://creativecommons.org/licenses/by/4.0/ | Same as CC-BY 3.0. |
| MIT | full text at the end of this file | Keep the copyright and licence notice. |

"Converted" below means re-encoded (sounds to mono Ogg Vorbis, textures to JPEG), trimmed or cut
into single shots. Those changes are ours; the originals belong to their authors.

## Code

| Files | Project | Authors | Licence |
|---|---|---|---|
| `games/lib/three.min.js` | three.js r149 | three.js authors | MIT |
| `games/lib/vendor/GLTFLoader.js`, `RGBELoader.js`, `SkeletonUtils.js`, `BufferGeometryUtils.js` | three.js r149 `examples/jsm`, import paths changed | three.js authors | MIT |
| `games/flight/atmos.js` (sky shader portion) | follows three.js `Sky` example (Preetham et al. scattering) | three.js authors | MIT |

The Android app's libraries (AndroidX, Jetpack Compose, Kotlin standard library) are fetched by Gradle
at build time and are Apache 2.0. Nothing from them is stored in this repository.

## Tennis (`games/tennis`)

No third-party assets. Everything is drawn and synthesised in code.

## Cadence Cut (`games/saber`)

| File | Title | Author | Licence | Source |
|---|---|---|---|---|
| `assets/music/the-rush.ogg` | The Rush | tebruno99 | CC0 1.0 | https://opengameart.org/content/the-rush |
| `assets/music/winning-the-race.ogg` | Winning the Race | section31 | CC0 1.0 | https://opengameart.org/content/winning-the-race |
| `assets/music/evasion.ogg` | Evasion | Matthew Pablo (http://www.matthewpablo.com) | CC-BY 3.0 | https://opengameart.org/content/evasion |
| `assets/music/thrust-sequence.ogg` | Thrust Sequence | Matthew Pablo (http://www.matthewpablo.com) | CC-BY 3.0 | https://opengameart.org/content/thrust-sequence |
| `assets/music/darker-waves.ogg` | Darker Waves | Zander Noriega | CC-BY 3.0 | https://opengameart.org/content/darker-waves |

Re-encoded to Ogg Vorbis, otherwise unchanged. Sound effects and three further songs are generated in code.

## Duskwater (`games/arena`)

Models (Poly Pizza, https://poly.pizza):

| File | What | Author | Licence |
|---|---|---|---|
| `assets/guns/glock_rig.glb` | First-person arms and pistol, animated | J-Toastie | CC-BY 3.0 |
| `assets/guns/akm_rig.glb` | First-person arms and rifle, animated | J-Toastie | CC-BY 3.0 |
| `assets/guns/mpx.glb` | Submachine gun | austincford | CC-BY 3.0 |
| `assets/guns/m21.glb` | Marksman rifle with scope | austincford | CC-BY 3.0 |
| `assets/guns/glock.glb` | Pistol (bots' sidearm), "Rigged Glock 19", https://poly.pizza/m/gDhOo5jkNX | PuKkBuMXDD (the author's Poly Pizza name) | CC-BY 3.0 |
| `assets/chars/swat.glb` | Rigged, animated soldier | Quaternius | CC0 1.0 |

Textures and lighting: Poly Haven (https://polyhaven.com), CC0 1.0. Sets `asphalt_02`, `brick_wall_001`,
`concrete_floor_worn_001`, `container_side` (desaturated), `corrugated_iron_02`, `rusty_metal_02`,
`weathered_planks`, `worn_plaster_wall`, and the HDRI `industrial_sunset_02_1k.hdr`. Re-encoded at 1k.

Sounds (`assets/sfx`, converted):

| Files | Cut from | Author | Licence |
|---|---|---|---|
| `tern_1`, `tern_2` | `cz.wav` from "Tabasco sounds" | Vincent Sevedge | CC-BY 3.0 |
| `breaker_1`, `breaker_2` | `sks.wav` from "Tabasco sounds" | Vincent Sevedge | CC-BY 3.0 |
| `longline_1`, `longline_2`, `bolt` | `mosin.wav` from "Tabasco sounds" | Vincent Sevedge | CC-BY 3.0 |
| `skiff_1..3` | `gunshot_17/18/22.wav` | dklon | CC-BY 3.0 |
| `reload_rifle`, `reload_skiff` | `reload_rifle.wav`, `reload_gun.wav` | springyspringo | CC0 1.0 |
| `reload_tern` | `reload_pistol.wav` | zer0sol | CC0 1.0 |
| `click` | `mag_click.mp3` | pauliuw | CC0 1.0 |
| `step_1`, `step_2`, `shell_1..3`, `hit_metal`, `hit_concrete`, `hit_wood`, `water_loop` | "100 CC0 SFX #2" | rubberduck | CC0 1.0 |
| `step_3` | footstep set, `stone01.ogg` | tinyworlds (the same file in `games/dino` is tagged kddekadenz; see open item 3) | CC0 1.0 |

## IRONFERN (`games/dino`)

Dinosaurs (`assets/dinos`), all CC0 1.0 by Quaternius (Ultimate Animated Dinosaur pack; the flyer stand-in
from Ultimate Monsters): `raptor_velociraptor.glb`, `trex.glb`, `triceratops.glb`, `parasaurolophus.glb`,
`stegosaurus.glb`, `apatosaurus.glb`, `flyer_standin_dragon.glb`.

Nature and props (`assets/nature`, `assets/props`, Poly Pizza / quaternius.com):

| Files | Author | Licence |
|---|---|---|
| `nature/palm_curved`, `palm_tree`, `tree_broadleaf`, `tree_dead`, `fern`, `plant_big_leaf`, `bush`, `grass_tall`, `rock_moss`, `rock_large`, `log_moss` | Quaternius | CC0 1.0 |
| `nature/palm_coconut`, `palm_triangle`, `vines_hanging` | Poly by Google | CC-BY 3.0 |
| `props/fence_chainlink`, `fence_barrier_large`, `pickup_truck`, `crate_wood`, `barrel_hazard`, `container_green`, `sandbags` | Quaternius | CC0 1.0 |
| `props/fence_chainlink_post`, `concrete_barrier` | J-Toastie | CC-BY 3.0 |
| `props/jeep`, `floodlight_post` | Zsky | CC-BY 3.0 |
| `props/barrels_oil` | Robert Schlyter | CC-BY 3.0 |
| `props/sign_construction` | koen caspers | CC-BY 3.0 |
| `props/generator` | KolosStudios | CC-BY 3.0 |
| `guns/glock_rig` ("Fps Rig", https://poly.pizza/m/uxko5LkGia), `guns/akm_rig` ("Fps Rig AKM", https://poly.pizza/m/U6l6wjxFhC) | J-Toastie (same files as Duskwater) | CC-BY 3.0 |
| `guns/m21` ("M21 EBR", https://poly.pizza/m/iZPuYSKNrm) | austincford (same file as Duskwater) | CC-BY 3.0 |

Textures and HDRIs: Poly Haven, CC0 1.0. `forest_leaves_02`, `mud_forest`, `mossy_rock`, `leafy_grass`,
`muddy_tracks`, `brick_wall_001`, `asphalt_02`, `concrete_floor_worn_001`, `weathered_planks`,
`corrugated_iron_02`, `rusty_metal_02`, `container_side`; HDRIs `lush_dirt_path_1k.hdr` (Alexander Scholten)
and `industrial_sunset_02_1k.hdr`.

Ambience and music (`assets/amb`, OpenGameArt, converted):

| File | Original | Author | Licence |
|---|---|---|---|
| `jungle_day.ogg` | `amb_morning_loop.ogg` | not recorded | CC0 1.0 |
| `cicadas.ogg` | `amb_cicadas.ogg` | not recorded | CC0 1.0 |
| `crickets.ogg` | Crickets | dklon | CC-BY 3.0 |
| `rain.ogg` | "rain loops", loop 1 | not recorded | CC0 1.0 |
| `music_menace.ogg` | menacing synth loop | not recorded | CC0 1.0 |
| `music_battle.ogg` | jungle battle loop | Taylor Harris (from the file's tags) | CC0 1.0 |

Weapon and footstep sounds (`assets/sfx`, converted; also in `games/dino/CREDITS-world.md`):

| Files | Original | Author | Licence | Source |
|---|---|---|---|---|
| `shot_carbine`, `shot_marksman`, `shot_sidearm` | SKS, Mosin Nagant 91/30, CZ-52 from "Tabasco sounds" | Vincent Sevedge | CC-BY 3.0 | OpenGameArt |
| `reload_carbine`, `reload_marksman` | `assaultriflereload1.wav`, `gunreload1.wav` ("Gun reload sounds") | SpringySpringo | CC0 1.0 | https://opengameart.org/content/gun-reload-sounds |
| `reload_sidearm` | `reload.wav` ("Handgun Reload Sound Effect") | zer0_sol | CC0 1.0 | https://opengameart.org/content/handgun-reload-sound-effect |
| `shell_1..3` | "100 CC0 SFX #2" | rubberduck | CC0 1.0 | OpenGameArt |
| `step_leaves`, `step_stone` | `leaves01`, `stone01` | kddekadenz | Public domain (per tag) | OpenGameArt |
| `dry_click` | "Gun reload, lock or click sound" | not recorded | Public domain (per tag) | OpenGameArt |

Creature sounds (`assets/sfx/dino_*.ogg`, cut and converted; all CC0 1.0 on OpenGameArt, checked 2026-11-10):

| Files | Source | Author | Link |
|---|---|---|---|
| `dino_rex_huff1-2`, `dino_rex_growl1-4`, `dino_rex_roar1-2` | `t-rex_calls.mp3` | CaveboyTup | https://opengameart.org/content/t-rex-calls |
| `dino_raptor_call1-2` | `small_dino_raspy_calls.mp3` | CaveboyTup | https://opengameart.org/content/small-dino-raspy-calls |
| `dino_rex_roar3` | `monster_roar.wav` (CC0 Deep Monster Roar) | trazzz123 | https://opengameart.org/content/cc0-deep-monster-roar |
| `dino_rex_snarl1-4`, `dino_snarl_long1-3` | `monster-snarl-attack.ogg`, `monster-snarls.ogg` | Darsycho | https://opengameart.org/content/monster-snarls |
| `dino_ptero_screech1-4` | `evil_screech_1.ogg` (voice tagged AuraVoice) | Nocturnal_Vanguard | https://opengameart.org/content/evil-screech-1 |
| `dino_raptor_growl2/5/8/9/12/13` | 16 Monster Growls | StarNinjas | https://opengameart.org/content/16-monster-growls |
| `dino_breath`, `dino_dilo_*`, `dino_grazer_*`, `dino_grunt_low`, `dino_ptero_die`, `dino_raptor_die1-2`, `dino_raptor_shriek1-3`, `dino_spit1-3`, `dino_stomp2`, `dino_trike_*` | 80 CC0 creture SFX #2 | rubberduck | https://opengameart.org/content/80-cc0-creture-sfx-2 |
| `dino_stomp1` | `stomp.ogg` (Mech Stomp / Step Sound), from Iwan "qubodup" Gabovitch's CC0 "4 dry snow steps" | hc (Benjamin Pickhardt) | https://opengameart.org/content/mech-stomp-step-sound |
| `dino_flesh1`, `dino_flesh2` | `squishsplat_impact.mp3`, `squish_03.mp3` | EZduzziteh | https://opengameart.org/content/squish-sounds-effects |
| `dino_flesh_tear` | `rippingintomeat.mp3` | Eldritch Grim | https://opengameart.org/content/ripping-into-meat |

All signage, brand names in the game world and the procedural buildings are original to this project.

## Gyrowing (`games/flight`)

Textures (Poly Haven, CC0 1.0, 1k diffuse, unmodified): `forrest_ground_01`, `aerial_grass_rock`,
`aerial_rocks_02`, `dirt_aerial_02`, `aerial_beach_01`, `snow_field_aerial`, `asphalt_02` (Rob Tuytel);
`corrugated_iron_02` (Jenelle van Heerden, Sergej Majboroda).

| File | Title | Author | Licence | Source |
|---|---|---|---|---|
| `assets/snd/prop_loop.ogg` | Airplane Prop Loop | jakobthiesen, looped by Jordan Irwin (AntumDeluge) | CC-BY 3.0 | https://opengameart.org/content/airplane-prop-loop |
| `assets/snd/wind_loop.ogg` | Wind Loop | InspectorJ, looped by Jordan Irwin (AntumDeluge) | CC-BY 3.0 | https://opengameart.org/content/wind-loop |
| `assets/models/sailboat.glb` | Sail Boat | Quaternius | CC0 1.0 | https://poly.pizza/m/BgSZXwmm7k |
| `assets/models/car.glb` | Red Car | J-Toastie | CC-BY 3.0 | https://poly.pizza/m/dVLJ5CjB0h |
| `assets/models/lighthouse.glb` | Lighthouse | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/0t2ZYRBsqX- |
| `data/airports.json` | built from OurAirports `airports.csv` and `runways.csv` (2026-11-08) | OurAirports contributors | Public domain | https://ourairports.com/data/ |

### Data streamed at runtime (not stored in this repository)

The real-world mode downloads map tiles from public servers while you fly and caches them in the
browser. None of this is bundled or redistributed by the repository, but the attributions below must be
shown whenever the data is on screen. The game already shows them; keep them if you change the game.

- **Satellite imagery: Sentinel-2 cloudless 2016 by EOX IT Services GmbH, CC BY 4.0.** Required line:
  "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel
  data 2016)". Only the 2016 layer (`s2cloudless_3857`) is CC BY 4.0; the 2018 and later layers are
  CC BY-NC-SA 4.0 (non-commercial) and must not be switched in. Checked 2026-11-09.
- **Elevation: Mapzen Terrain Tiles on AWS (Registry of Open Data).** Attribution as listed in
  https://github.com/tilezen/joerd/blob/master/docs/attribution.md (ArcticDEM, Geoscience Australia,
  data.gv.at DGM Austria, Open Government Licence Canada, EU-DEM / Copernicus, ETOPO1 NOAA, INEGI,
  LINZ New Zealand, Kartverket, Environment Agency UK, USGS 3DEP / GMTED2010 / SRTM). The full list is in
  `games/flight/CREDITS.md`.

## Iron Ludus (`games/gladiator`)

Models (Poly Pizza, CC0 1.0): `recruit.glb` (Hooded Adventurer), `axeman.glb` (Adventurer), `champion.glb`
(King), `skeleton.glb`, `wolf.glb`, `troll.glb` (Giant), `axe.glb`, `shield.glb` (Shield Round), `arch.glb`
(Arch Round), all by Quaternius; `torch.glb` (Torch 1) by CircuitZ. Links in `games/gladiator/CREDITS.md`.

Textures and sky (Poly Haven, CC0 1.0): `aerial_sand`, `large_sandstone_blocks_01`, `sandstone_blocks_08`,
and `hdr/sky.hdr` (Kloofendal 48d Partly Cloudy, Pure Sky).

Sounds (OpenGameArt, converted):

| Files | Pack | Author | Licence |
|---|---|---|---|
| `sfx/clash_*`, `sfx/sword_*` | 20 Sword Sound Effects (Attacks and Clashes) | StarNinjas | CC0 1.0 |
| `sfx/swish_*` | Swishes Sound Pack | artisticdude | CC0 1.0 |
| `sfx/flesh_*` | 3 Melee Sounds | remaxim (originals by qubodup) | CC0 1.0 |
| `sfx/grunt_*`, `sfx/die_1` | 5 Hit Sounds + Dying | TinyWorlds | CC0 1.0 |
| `sfx/cr_*` | 80 CC0 creature SFX | rubberduck | CC0 1.0 |
| `sfx/k_*` | 100 CC0 SFX #2 | rubberduck | CC0 1.0 |
| `sfx/crowd_shout` | Crowd Shouting/Speaking Ambience | StarNinjas | CC0 1.0 |
| `sfx/crowd_amb`, `crowd_cheer`, `crowd_chant`, `crowd_soft` | Free Crowd Cheering Sounds | Gregor Quendel (https://opengameart.org/users/gregor-quendel) | CC-BY 4.0 |

## Bowling (`games/bowling`)

| File | Asset | Author | Licence | Source |
|---|---|---|---|---|
| `assets/hdr/hotel_room_1k.hdr` | Hotel Room | Poly Haven | CC0 1.0 | https://polyhaven.com/a/hotel_room |
| `assets/tex/fine_grained_wood_col_1k.jpg` | Fine Grained Wood | Poly Haven | CC0 1.0 | https://polyhaven.com/a/fine_grained_wood |
| `assets/tex/wood_floor_worn_diff_1k.jpg` | Wood Floor Worn | Poly Haven | CC0 1.0 | https://polyhaven.com/a/wood_floor_worn |

Everything else, including all sound, is made in code.

## Open items before the repository goes public

These are gaps in the records, not known licence problems. Each is cheap to close.

1. ~~`games/arena/assets/guns/glock.glb` author~~ closed 2026-11-10: "PuKkBuMXDD" is the author's Poly Pizza
   name; model "Rigged Glock 19", https://poly.pizza/m/gDhOo5jkNX, CC-BY 3.0.
2. **`games/dino/assets/guns/awp.glb`:** unused (no code loads it) and has no credit anywhere. It is
   taken out of the credits and should be deleted (`git rm games/dino/assets/guns/awp.glb`); the
   delete was not done automatically on 2026-11-10 and is still pending.
3. **Footstep `stone01.ogg`:** Duskwater credits tinyworlds, while the copy in IRONFERN is tagged
   kddekadenz. Both are public domain / CC0 either way; confirm the author.
4. ~~IRONFERN weapon sounds~~ closed 2026-11-10: now in `games/dino/CREDITS-world.md`; the three
   `reload_*` sounds were re-made from verified CC0 downloads (SpringySpringo, zer0_sol).
5. ~~IRONFERN creature sounds per-file credit~~ closed 2026-11-10: per-file table above and in
   `games/dino/CREDITS-dinos.md`; every source page checked as CC0 (including hc's stomp and qubodup's
   dry snow steps it was made from).
6. **`games/lib/vendor/LICENSE-three.txt`** only links to the three.js licence. MIT asks for the notice
   itself to travel with the code; the full text is reproduced below, and the vendor file could be
   replaced with it.

## three.js licence (MIT)

```
The MIT License

Copyright © 2010-2023 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
