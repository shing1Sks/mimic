"""Render Paaji's commentary clips for Willowlight with Gemini TTS.

  python tools/commentary/make.py                 render every missing clip in script.json
  python tools/commentary/make.py --only six_01,four_02
  python tools/commentary/make.py --audition OUTDIR --voices Fenrir,Puck,...   a few sample lines per voice

script.json: [{ "id", "moment", "prio", "text" (Latin-script Hinglish: subtitles), "say" (Devanagari
with English cricket words: what the voice speaks; Gemini pronounces Hindi properly only from
Devanagari) }]. Output: games/cricket/assets/commentary/<id>.ogg (mono Opus) + manifest.json.

The key comes from tools/commentary/.env (GEMINI_API_KEY, put there by env-sync; git-ignored).
Gemini 2.5 Pro TTS performs a direction given in the text (STYLE + the moment's note) without
speaking it; check_leaks.py transcribes every clip to make sure.
Needs: google-genai (the paper-audio skill's venv has it), ffmpeg at C:\\ffmpeg\\bin.
"""
import argparse, json, os, re, subprocess, sys, time, wave

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'games', 'cricket', 'assets', 'commentary')
FF = r'C:\ffmpeg\bin\ffmpeg.exe'
FP = r'C:\ffmpeg\bin\ffprobe.exe'
MODEL = 'gemini-2.5-pro-preview-tts'   # takes a performance direction in the text (3.8 flash reads it aloud)
VOICE = 'Fenrir'                        # the user's pick from the 2026-11-14 audition (round 2)
# the character: an original commentator in a flamboyant Punjabi style, not any real person
STYLE = ("a flamboyant, larger-than-life Punjabi cricket commentator in his fifties: a booming, slightly husky "
         "baritone, thick Punjabi accent in his Hindi, theatrical and poetic, every line built like a punchline: "
         "a dramatic pause before the payoff, a chuckle of pure joy, then he roars the climax like the whole "
         "stadium is listening. Huge emotion, never flat")

AUDITION = [
    'ओए होए! ये गेंद नहीं, guided missile थी, सीधा stands में!',
    'बल्लेबाज़ ने ऐसे मारा, जैसे धोबी कपड़े धोता है... धो डाला!',
    'बल्ले बल्ले! छक्का! गेंद गई चाँद की सैर पे!',
    'जितनी देर में चाय ठंडी होती है, उतनी देर में ये match पलट गया, गुरु!',
]


def key():
    for line in open(os.path.join(HERE, '.env'), encoding='utf-8-sig'):
        m = re.match(r'\s*GEMINI_API_KEY\s*=\s*(.*)', line)
        if m: return m.group(1).strip().strip('"').strip("'")
    sys.exit('GEMINI_API_KEY missing from tools/commentary/.env (run env-sync)')


def tts(client, text, voice, wav_path):
    from google.genai import types
    model = globals()['MODEL']
    cfg = types.GenerateContentConfig(response_modalities=['AUDIO'], speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))))
    for attempt in range(5):
        try:
            r = client.models.generate_content(model=model, contents=text, config=cfg)
            pcm = r.candidates[0].content.parts[0].inline_data.data
            with wave.open(wav_path, 'wb') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
            return
        except Exception as e:   # rate limits and the odd empty reply: back off and retry
            if attempt == 4: raise
            time.sleep(4 * (attempt + 1))
            print('  retry', attempt + 1, type(e).__name__, flush=True)


def encode(wav_path, dest, fmt='ogg'):
    """Trim silence at both ends, level to -16 LUFS, mono 48 kHz."""
    af = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,'
          'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,'
          'loudnorm=I=-16:TP=-1.5:LRA=9')
    codec = ['-c:a', 'libopus', '-b:a', '24k', '-application', 'voip'] if fmt == 'ogg' else ['-c:a', 'libmp3lame', '-b:a', '128k']
    subprocess.run([FF, '-y', '-v', 'error', '-i', wav_path, '-af', af, '-ar', '48000', '-ac', '1'] + codec + [dest], check=True)


def ms(path):
    return round(float(subprocess.check_output([FP, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).decode()) * 1000)


def audition(client, outdir, voices):
    os.makedirs(outdir, exist_ok=True)
    for v in voices:
        parts = []
        for i, line in enumerate(AUDITION):
            raw = os.path.join(outdir, f'{v}_{i}.wav')
            tts(client, line, v, raw)
            parts.append(raw)
            print(' ', v, i + 1, flush=True)
        # one file per voice: the lines with a short gap, easy to compare
        lst = os.path.join(outdir, f'{v}.txt')
        gap = os.path.join(outdir, 'gap.wav')
        if not os.path.exists(gap):
            subprocess.run([FF, '-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.7', gap], check=True)
        with open(lst, 'w') as f:
            for p in parts: f.write(f"file '{p}'\nfile '{gap}'\n")
        joined = os.path.join(outdir, f'{v}-joined.wav')
        subprocess.run([FF, '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined], check=True)
        encode(joined, os.path.join(outdir, f'Paaji-voice-{v}.mp3'), 'mp3')
        print('wrote', f'Paaji-voice-{v}.mp3', flush=True)


def render(client, only, voice):
    script = json.load(open(os.path.join(HERE, 'script.json'), encoding='utf-8'))
    os.makedirs(OUT, exist_ok=True)
    man_path = os.path.join(OUT, 'manifest.json')
    man = json.load(open(man_path, encoding='utf-8')) if os.path.exists(man_path) else {}
    tmp = os.path.join(HERE, '.work'); os.makedirs(tmp, exist_ok=True)
    todo = [s for s in script if (only and s['id'] in only) or (not only and not os.path.exists(os.path.join(OUT, s['id'] + '.ogg')))]
    for n, s in enumerate(todo, 1):
        raw = os.path.join(tmp, s['id'] + '.wav'); dest = os.path.join(OUT, s['id'] + '.ogg')
        tts(client, f"Perform this line as {STYLE}. This moment: {s['note']}. Line: {s['say']}", voice, raw)
        encode(raw, dest)
        man[s['id']] = {'file': s['id'] + '.ogg', 'ms': ms(dest)}
        print(f'[{n}/{len(todo)}] {s["id"]} {man[s["id"]]["ms"]} ms', flush=True)
        json.dump(man, open(man_path, 'w', encoding='utf-8'), indent=0, sort_keys=True)   # survive a stop midway
    for s in script:
        if s['id'] in man: man[s['id']].update({'moment': s['moment'], 'prio': s['prio'], 'text': s['text']})
    json.dump(man, open(man_path, 'w', encoding='utf-8'), indent=0, sort_keys=True, ensure_ascii=False)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'{len(man)} clips, {size / 1e6:.2f} MB')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--audition')
    ap.add_argument('--voices', default='Fenrir,Puck,Sadachbia,Algenib')
    ap.add_argument('--voice', default=VOICE)
    ap.add_argument('--model', default=MODEL, help='gemini-2.5-pro-preview-tts (best, 50/day on Tier 1) or gemini-2.5-flash-preview-tts')
    a = ap.parse_args()
    from google import genai
    client = genai.Client(api_key=key())
    MODEL = a.model
    if a.audition: audition(client, a.audition, a.voices.split(','))
    else: render(client, set(x for x in a.only.split(',') if x), a.voice)
