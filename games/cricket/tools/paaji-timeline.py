# Paaji's timeline over a whole solo match, played headless by a fake phone (playtest-init.js), with
# paaji-probe.js logging each clip's fetch / decode / start / stop / end, the caption and the phases.
# Prints what a listener would notice: lines cut off, captions with no voice or a late one, the next
# run-up starting while he is still talking, how many lines a ball, and how the clips loaded.
# Usage: python games/cricket/tools/paaji-timeline.py <outdir> [--port 8791] [--throttle MBPS,RTT_MS] [--matches N]
# Needs the game server (tools/serve.py <port>) running. Headless and muted; one browser at a time.
import sys, os, json, re, time, statistics as S
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
out = args[0]; os.makedirs(out, exist_ok=True)
opt = lambda k, d=None: args[args.index(k) + 1] if k in args else d
PORT = int(opt('--port', 8791)); THR = opt('--throttle'); N = int(opt('--matches', 1))
INIT = open(os.path.join(HERE, 'playtest-init.js'), encoding='utf8').read()
PROBE = open(os.path.join(HERE, 'paaji-probe.js'), encoding='utf8').read()
SRC = open(os.path.join(HERE, '..', 'commentary-lines.js'), encoding='utf8').read()
LINES = {m.group(1): (m.group(2), int(m.group(3)), m.group(4)) for m in re.finditer(r'"id": "([^"]+)", "moment": "([^"]+)", "prio": (\d), "text": "((?:[^"\\]|\\.)*)"', SRC)}
BY_TEXT = {json.loads('"%s"' % v[2]): k for k, v in LINES.items()}
ARGS = ['--headless=new', '--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']


def run_match(b, k):
    pg = b.new_page(viewport={'width': 1366, 'height': 768})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    if THR:
        mbps, rtt = [float(x) for x in THR.split(',')]
        cdp = pg.context.new_cdp_session(pg); cdp.send('Network.enable')
        cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': rtt, 'downloadThroughput': mbps * 1e6 / 8, 'uploadThroughput': mbps * 1e6 / 16})
    pg.add_init_script(INIT); pg.add_init_script(PROBE)
    pg.add_init_script("try { localStorage.setItem('willowlight.settings', JSON.stringify({howto: 1, lag: 0})); } catch (e) {}")
    pg.goto('http://127.0.0.1:%d/cricket/' % PORT)
    pg.wait_for_function("window.__cricket && __cricket.people.ready", timeout=240000)
    pg.evaluate("__phones[1].on = false"); pg.wait_for_timeout(300)
    pg.evaluate("__tl.push({t: Math.round(performance.now()), ev: 'menu'})")
    pg.click('[data-act=solo]'); pg.wait_for_timeout(400)
    pg.click('[data-act=cpu-match]')
    pg.evaluate("__phones[0].auto = 'play'")
    t0 = time.time()
    while time.time() - t0 < 600:
        scr = pg.evaluate("__cricket.G.screen")
        if scr == 'break': pg.wait_for_timeout(2500); pg.click('#break-menu [data-act=continue]')
        if scr == 'end': pg.wait_for_timeout(20000); break
        pg.wait_for_timeout(500)
    tl = pg.evaluate("__tl")
    score = pg.evaluate("__cricket.G.match && __cricket.G.match.innings.map(i => [i.runs, i.wkts, i.balls])")
    json.dump({'tl': tl, 'score': score, 'errs': errs}, open(os.path.join(out, 'timeline%d.json' % k), 'w'))
    pg.close()
    return tl, score, errs


def analyse(tl):
    starts = [e for e in tl if e['ev'] == 'start']
    match0 = next((e['t'] for e in tl if e['ev'] == 'phase' and e.get('scr') == 'game'), tl[0]['t'])
    plays = []
    for i, s in enumerate(starts):
        t0 = s['t'] + s['delay']; end = t0 + s['dur']; cut = None; hard = False
        for e in tl:
            if e['t'] < s['t'] or e.get('id') != s['id']: continue
            if e['ev'] == 'stop': end = min(end, t0 + e['at']); cut = e['at'] if e['at'] < s['dur'] - 80 else None; hard = e.get('ahead', 0) < 20; break
            if e['ev'] == 'ended': end = t0 + e['played']; break
        plays.append({'id': s['id'], 't0': t0, 'end': end, 'dur': s['dur'], 'cut': cut, 'hard': hard, 'ctx': s['ctx']})
    cuts = [p for p in plays if p['cut'] is not None]
    prio = lambda i: LINES.get(i, (0, 0))[1]
    by = {}   # what cut each line, and was it bigger
    for i, p in enumerate(plays):
        if p['cut'] is not None and i + 1 < len(plays): by[p['id'] + '@' + str(p['t0'])] = (plays[i + 1]['id'], prio(plays[i + 1]['id']) > prio(p['id']))
    overlaps = [(a['id'], b['id'], a['end'] - b['t0']) for a, b in zip(plays, plays[1:]) if b['t0'] < a['end'] - 30]
    caps = [e for e in tl if e['ev'] == 'cap']
    capd = []; silent = []
    for i, c in enumerate(caps):
        lid = BY_TEXT.get(c['text'])
        if not lid: continue
        nxt = caps[i + 1]['t'] if i + 1 < len(caps) else c['t'] + 20000
        p = next((p for p in plays if p['id'] == lid and c['t'] - 600 <= p['t0'] < nxt), None)
        if p: capd.append(p['t0'] - c['t'])
        else: silent.append((c['t'] - match0, lid))
    # the caption gone (or replaced) while his voice is still going
    short = []
    for p in plays:
        txt = json.loads('"%s"' % LINES[p['id']][2]) if p['id'] in LINES else None
        c = next((i for i, e in enumerate(tl) if e['ev'] == 'cap' and e['text'] == txt and abs(e['t'] - p['t0']) < 800), None)
        if c is None: continue
        off = next((e['t'] for e in tl[c + 1:] if e['ev'] in ('cap', 'cap0')), None)
        if off is not None and p['end'] - off > 500: short.append(p['end'] - off)
    # the next ball coming while he talks: run-ups that start mid-line
    runups = [e['t'] for e in tl if e['ev'] == 'phase' and e['p'] == 'runup']
    over = []
    for r in runups:
        p = next((p for p in plays if p['t0'] <= r < p['end']), None)
        if p: over.append((p['id'], p['end'] - r))
    # a line still playing when the ball after it is struck (the next moment lands on it)
    flights = [e['t'] for e in tl if e['ev'] == 'phase' and e['p'] in ('hit',)]
    dec = [e for e in tl if e['ev'] == 'decoded']
    f0 = [e for e in tl if e['ev'] == 'fetch0']
    first = {}
    for e in dec: first.setdefault(e['id'], e['t'])
    big = [first[i] for i in first if LINES.get(i, (0, 0))[1] >= 3]
    load = {
        'clips_decoded': len(dec), 'decoded_MB': round(sum(e['mem'] for e in dec) / 1e6, 1), 'encoded_MB': round(sum(e.get('bytes') or 0 for e in dec) / 1e6, 2),
        'decode_ms_med': S.median([e['ms'] for e in dec]) if dec else None, 'decode_ms_max': max([e['ms'] for e in dec]) if dec else None,
        'first_fetch_s_after_match': round((f0[0]['t'] - match0) / 1000, 1) if f0 else None,
        'all_big_decoded_s_after_match': round((max(big) - match0) / 1000, 1) if big else None,
        'all_decoded_s_after_match': round((max(first.values()) - match0) / 1000, 1) if first else None,
        'sample_rate': dec[0]['sr'] if dec else None,
    }
    end = tl[-1]['t']
    return {
        'match_s': round((end - match0) / 1000), 'balls': len(runups), 'lines_voiced': len(plays), 'captions': len(caps),
        'cut_off': len(cuts), 'cut_hard': sum(1 for p in cuts if p['hard']),
        'cut_by_equal_or_smaller': sum(1 for p in cuts if not by.get(p['id'] + '@' + str(p['t0']), ('', True))[1]),
        'cut_examples': [(p['id'], p['cut'], p['dur'], 'hard' if p['hard'] else 'fade', by.get(p['id'] + '@' + str(p['t0']), ('?',))[0]) for p in cuts[:8]],
        'voice_over_voice': len(overlaps),
        'caption_no_voice': len(silent), 'silent_examples': silent[:8],
        'caption_to_voice_ms': {'n': len(capd), 'med': S.median(capd) if capd else None, 'max': max(capd) if capd else None, 'over_150ms': sum(1 for d in capd if d > 150)},
        'caption_gone_while_talking': len(short), 'caption_gone_ms_med': S.median(short) if short else 0,
        'runup_while_talking': len(over), 'runup_talk_left_ms': sorted([round(x[1]) for x in over], reverse=True)[:10],
        'ctx_not_running_at_start': sum(1 for p in plays if p['ctx'] != 'running'),
        'load': load,
    }


if '--analyse' in args:   # re-read the timelines saved in <outdir>, no browser
    for f in sorted(x for x in os.listdir(out) if x.startswith('timeline')):
        d = json.load(open(os.path.join(out, f))); a = analyse(d['tl']); a['score'] = d['score']
        print(f, json.dumps(a, indent=1))
    sys.exit(0)

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    res = []
    for k in range(N):
        tl, score, errs = run_match(b, k)
        a = analyse(tl); a['score'] = score; a['errs'] = errs[:5]
        res.append(a)
        print(json.dumps(a, indent=1), flush=True)
    b.close()
json.dump(res, open(os.path.join(out, 'summary.json'), 'w'), indent=1)
