"""Transcribe every rendered clip and flag any that speak the performance direction instead of
(or as well as) the line. python tools/commentary/check_leaks.py [--only id,...]"""
import json, os, re, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import make
from google import genai; from google.genai import types
c = genai.Client(api_key=make.key())
script = {x['id']: x for x in json.load(open(os.path.join(HERE, 'script.json'), encoding='utf-8'))}
only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
WORDS = ['commentator', 'perform', 'booming', 'baritone', 'accent', 'theatrical', 'punchline', 'this moment', 'line:']
bad = []
for i, x in script.items():
    if only and i not in only: continue
    f = os.path.join(make.OUT, i + '.ogg')
    for attempt in range(4):
        try:
            r = c.models.generate_content(model='gemini-3.8-flash', contents=[types.Part.from_bytes(data=open(f, 'rb').read(), mime_type='audio/ogg'),
                'Transcribe this audio exactly, in Latin script. Output only the transcript.'])
            t = (r.text or '').strip(); break
        except Exception as e:
            time.sleep(5 * (attempt + 1)); t = 'ERR ' + str(e)[:80]
    leak = [w for w in WORDS if w in t.lower()]
    words = lambda s: set(re.findall(r'[a-z]+', s.lower()))
    overlap = len(words(t) & words(x['text'])) / max(1, len(words(x['text'])))
    if leak or overlap < 0.4: bad.append((i, round(overlap, 2), leak, t[:120]))
print('checked', len(script) if not only else len(only), '| suspicious:', len(bad))
for b in bad: print(' ', b)
