# Willowlight - asset credits

Third-party assets are free to use without login. CC0 = public domain dedication (no attribution
required, credited anyway).

## 3D models (Poly Pizza, glTF)

| File | Asset | Author | Licence | Source |
|---|---|---|---|---|
| assets/models/athlete_m.glb | Man (t-shirt and shorts, rigged, animated) | Quaternius | CC0 1.0 | https://poly.pizza/m/HMnuH5geEG |
| assets/models/athlete_f.glb | Woman in Tank Top (rigged, animated) | Quaternius | CC0 1.0 | https://poly.pizza/m/XqzeZGB7iU |

Copied from Sunvolley (games/tennis/assets/models). Used for the batters, the bowler, the
fielders, the umpire, the cheerleaders and the crowd (rendered once at start into an atlas of seated and cheering
spectators).

Everything else is made in code for this game: the ground, the strip and creases, stumps and
bails, the rope and LED boards, stands, floodlights, sight screens, sky, bat, ball, pads, helmet,
gloves, and all sound (synthesised with WebAudio).

## Commentary voice

Paaji, the commentator, is an original character: his lines were written for Willowlight (tools/commentary/build_script.py)
and voiced with Google Gemini text-to-speech (prebuilt voice "Fenrir", Gemini 2.5 Flash TTS; the last 44 lines with
Gemini 3.1 Flash TTS) from a performance direction. No real commentator's voice is used. Most lines are original;
21 (ids ending _rNN) are famous published commentary one-liners by Navjot Singh Sidhu ("Sidhuisms"), quoted verbatim
from Sportskeeda, ThePrint and Wikiquote collections, voiced with Gemini 2.5 Pro TTS.
Clips: games/cricket/assets/commentary/ (Ogg Opus), rendered by tools/commentary/make.py.

## Teams

Player names are real cricketers (recent well-known XIs, not live rosters). Franchise names, kits and badges are made up;
no team's trademarks or logos are used. Player looks are simple stylised traits (skin tone, hair, beard, build).
