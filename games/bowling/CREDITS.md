# Emberlane - asset credits

Original game: setting, hall, masking-panel art and the ember emblem are made for this game.

## Textures and HDRI (Poly Haven, CC0 1.0 - public domain, credited anyway)

| File | Asset | Source |
|---|---|---|
| assets/hdr/billiard_hall_1k.hdr | Billiard Hall (HDRI) - reflections and ambient light | https://polyhaven.com/a/billiard_hall |
| assets/tex/white_maple_veneer_diff_2k.jpg (+ nor_gl, rough) | White Maple Veneer - the grain of every lane and approach board | https://polyhaven.com/a/white_maple_veneer |
| assets/tex/brushed_concrete_* | Brushed Concrete - side walls | https://polyhaven.com/a/brushed_concrete |
| assets/tex/dirty_carpet_* | Dirty Carpet - settee floor | https://polyhaven.com/a/dirty_carpet |
| assets/tex/metal_plate_* | Metal Plate - fittings, kickback kick plates, pinsetter frames | https://polyhaven.com/a/metal_plate |
| assets/tex/leather_red_02_* | Leather Red 02 (normal) - seats | https://polyhaven.com/a/leather_red_02 |
| assets/tex/cotton_jersey_* | Cotton Jersey - heather tone of the shirt sleeve (diffuse), weave of the pit curtains (normal) | https://polyhaven.com/a/cotton_jersey |

## Hand model (MIT)

| File | Asset | Author / licence | Source |
|---|---|---|---|
| assets/models/hand_right.glb, hand_left.glb | WebXR "generic-hand" rigged hands (25 joints); fingers are posed around the ball in code | Amazon / W3C Immersive Web, MIT (assets/models/LICENSE-webxr-input-profiles.md) | https://github.com/immersive-web/webxr-input-profiles (npm @webxr-input-profiles/assets 1.0.20) |

## Sounds (freesound.org, all CC0 1.0; trimmed / re-encoded to .ogg)

| File | Original | Author | Source |
|---|---|---|---|
| assets/snd/strike.ogg | Bowling Strike | SieuAmThanh | https://freesound.org/s/514385/ |
| assets/snd/crash.ogg | Bowling Ball Hits Pins, Once | CHallSmith | https://freesound.org/s/870830/ |
| assets/snd/knock1-6.ogg | Single bowling pin knock (six hits sliced) | Rvgerxini | https://freesound.org/s/499788/ |
| assets/snd/roll.ogg | bowling_roll-nofadeout | qubodup | https://freesound.org/s/125744/ |
| assets/snd/ambience.ogg | Bowling Alley Ambience 01b (60 s excerpt) | dagray | https://freesound.org/s/667757/ |
| assets/snd/machine.ogg | Bowling room machine with pins falling (6 s excerpt) | felix.blume | https://freesound.org/s/684422/ |

The thud of a dropped ball, the gutter rush and the UI chimes are synthesised with WebAudio (audio.js).

## Code

three.js r149 and its GLTF/RGBE loaders are shared from `games/lib` (MIT, `games/lib/vendor/LICENSE-three.txt`).
Made in code here: lane boards and markings (from the veneer scan), pins (lathe of the regulation
outline), ball swirl textures, ball return, masking unit and its art, the hall, the pin deck
surroundings (kickback panels and their art, pit curtains, pinsetter bays and pin wheels), the
arm below the hand (anatomical forearm with skin pores/creases and wrap-lit skin shading, the
rolled jersey sleeve with its knit and piping, the terry wristband: armmesh.js), post processing
(bloom, ACES, FXAA) and the planar lane reflection.
