"""Render the crowd's team chants for Willowlight with Gemini TTS (one voice, chanting).

  python tools/commentary/chants.py [--only ind,pak]

The game layers each clip a dozen times (detuned, delayed, filtered) into a stadium chant, so one
voice is enough. Output: games/cricket/assets/chants/<team id>.ogg + manifest.json.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make  # noqa: E402  (tts, encode, ms, key)

OUT = os.path.join(make.ROOT, 'games', 'cricket', 'assets', 'chants')
# what a stadium shouts for each side: the name broken into beats, three times
CHANTS = {
    'ind': 'In-di-a! In-di-a! In-di-a!', 'pak': 'Pa-ki-stan! Pa-ki-stan! Pa-ki-stan!', 'aus': 'Aus-sie! Aus-sie! Aus-sie!',
    'eng': 'Eng-land! Eng-land! Eng-land!', 'rsa': 'Pro-teas! Pro-teas! Pro-teas!', 'nzl': 'Black Caps! Black Caps! Black Caps!',
    'mum': 'Mum-bai! Mum-bai! Mum-bai!', 'che': 'Chen-nai! Chen-nai! Chen-nai!', 'blr': 'Ben-ga-luru! Ben-ga-luru! Ben-ga-luru!',
    'kol': 'Kol-ka-ta! Kol-ka-ta! Kol-ka-ta!', 'hyd': 'Hy-der-a-bad! Hy-der-a-bad!', 'jai': 'Jai-pur! Jai-pur! Jai-pur!',
    'del': 'Dil-li! Dil-li! Dil-li!', 'pun': 'Pun-jab! Pun-jab! Pun-jab!',
}
DIRECTION = ('Shout this as one fan in a packed cricket stadium, chanting in a steady stomping rhythm, '
             'every syllable punched and loud, full-throated and joyful, like the whole stand is with you: ')


def main():
    from google import genai
    only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
    client = genai.Client(api_key=make.key())
    make.MODEL = 'gemini-2.5-flash-preview-tts'
    os.makedirs(OUT, exist_ok=True)
    man_path = os.path.join(OUT, 'manifest.json')
    man = json.load(open(man_path, encoding='utf-8')) if os.path.exists(man_path) else {}
    tmp = os.path.join(make.HERE, '.work'); os.makedirs(tmp, exist_ok=True)
    for tid, text in CHANTS.items():
        if only and tid not in only: continue
        if not only and os.path.exists(os.path.join(OUT, tid + '.ogg')): continue
        raw, dest = os.path.join(tmp, 'chant_' + tid + '.wav'), os.path.join(OUT, tid + '.ogg')
        make.tts(client, DIRECTION + text, 'Fenrir', raw)
        make.encode(raw, dest)
        man[tid] = {'file': tid + '.ogg', 'ms': make.ms(dest), 'text': text}
        print(tid, man[tid]['ms'], 'ms', flush=True)
        json.dump(man, open(man_path, 'w', encoding='utf-8'), indent=0, sort_keys=True)


if __name__ == '__main__':
    main()
