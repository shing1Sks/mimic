# Duskwater asset credits

Everything in `assets/` is third-party work under free licences. Files were converted for the
game (sounds cut to single shots and re-encoded as mono Ogg Vorbis, textures re-encoded as JPEG,
the container texture desaturated so it can be tinted); the changes are ours, the originals are
the authors'.

## Models (`assets/guns`, `assets/chars`)

| File | What | Author | Source | Licence |
|---|---|---|---|---|
| `guns/glock_rig.glb` | First-person arms + Glock 19 with Idle/Grip/Reload/Shoot animations (Tern) | J-Toastie | Poly Pizza | CC-BY 3.0 |
| `guns/akm_rig.glb` | First-person arms + AKM with Idle/Reload/Shoot animations (Breaker; its arms also hold the Skiff and Longline) | J-Toastie | Poly Pizza | CC-BY 3.0 |
| `guns/mpx.glb` | SIG MPX (Skiff, first person and bots) | austincford | Poly Pizza | CC-BY 3.0 |
| `guns/m21.glb` | M21 / Mk14 with scope (Longline, first person and bots) | austincford | Poly Pizza | CC-BY 3.0 |
| `guns/glock.glb` | "Rigged Glock 19" (bots' sidearm) | PuKkBuMXDD (the author's Poly Pizza name) | https://poly.pizza/m/gDhOo5jkNX | CC-BY 3.0 |
| `chars/swat.glb` | SWAT soldier, rigged and animated (bots, tinted per team) | Quaternius | Poly Pizza / quaternius.com | CC0 1.0 |

CC-BY 3.0: https://creativecommons.org/licenses/by/3.0/ · CC0: https://creativecommons.org/publicdomain/zero/1.0/

## Textures and lighting (`assets/tex`, `assets/hdr`)

All from Poly Haven (https://polyhaven.com), CC0. 1k diffuse, OpenGL normal and roughness maps.

| Set | Used on |
|---|---|
| `asphalt_02` | yard ground |
| `brick_wall_001` | perimeter walls |
| `concrete_floor_worn_001` | loading dock, ramps, jersey barriers |
| `container_side` (desaturated) | shipping containers, tinted per container |
| `corrugated_iron_02` | warehouse walls and roof, far sheds |
| `rusty_metal_02` | crane, rails, poles, racks, bollards, door bars |
| `weathered_planks` | crates |
| `worn_plaster_wall` | guard booths |
| `industrial_sunset_02_1k.hdr` | image-based lighting and reflections (PMREM environment) |

## Sounds (`assets/sfx`)

| Files | Cut from | Author | Licence |
|---|---|---|---|
| `tern_1`, `tern_2` | `cz.wav` (CZ pistol) from "Tabasco sounds" | Vincent Sevedge | CC-BY 3.0 |
| `breaker_1`, `breaker_2` | `sks.wav` (SKS) from "Tabasco sounds" | Vincent Sevedge | CC-BY 3.0 |
| `longline_1`, `longline_2`, `bolt` | `mosin.wav` (Mosin-Nagant shots and bolt) from "Tabasco sounds" | Vincent Sevedge | CC-BY 3.0 |
| `skiff_1..3` | `gunshot_17/18/22.wav` from dklon's gunshot set | dklon | CC-BY 3.0 |
| `reload_rifle`, `reload_skiff` | `reload_rifle.wav`, `reload_gun.wav` | springyspringo | CC0 |
| `reload_tern` | `reload_pistol.wav` | zer0sol | CC0 |
| `click` | `mag_click.mp3` | pauliuw | CC0 |
| `step_1`, `step_2`, `shell_1..3`, `hit_metal`, `hit_concrete`, `hit_wood`, `water_loop` | "100 CC0 SFX #2" (`sfx100v2_*`) | rubberduck | CC0 |
| `step_3` | footstep set (`stone01.ogg`) | tinyworlds | CC0 |

UI blips, hit markers, the round foghorn and the wind bed are synthesized in `audio.js`.

## Code

GLTFLoader, RGBELoader and SkeletonUtils (three.js r149 examples, MIT) are vendored in
`games/lib/vendor/` and shared with the other games.
