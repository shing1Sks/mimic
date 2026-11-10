"""Emberlane playtest: real-GPU Chromium (muted) with a fake Wand playing human-like swings.

python games/bowling/tools/playtest.py <outdir> [scenario ...]
Scenarios: look, speeds, angles, early, hook, strike, feel (the synthetic-swing table through the
real input path, incl. accelerometer, step and lunge), cycle (shot-to-ready timings).
Writes screenshots and results.json.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'http://127.0.0.1:8765/bowling/'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out')
SCEN = sys.argv[2:] or ['look', 'speeds', 'angles', 'early', 'hook']
os.makedirs(OUT, exist_ok=True)

SWING_JS = open(os.path.join(HERE, 'swing.js'), encoding='utf8').read()

def queue_swing(page, opts, delay_ms=150):
    """Generate a swing with tools/swing.js in the page (kin.js maths) and queue it on the fake pad."""
    return page.evaluate("""([o, d]) => {
      const K = BW.Kin, t0 = performance.now() + d;
      const ss = BW.Swing.gen(Object.assign({}, o, { t0 }));
      __fake.push(ss.map(s => ({ t: s.t, axes: K.encodePad(s.q), acc: s.acc, a: s.a })));
      return { tRel: ss.tRel, end: ss[ss.length - 1].t, n: ss.length };
    }""", [opts, delay_ms])

def wait_until(page, js, timeout=15):
    t = time.time()
    while time.time() - t < timeout:
        if page.evaluate(js):
            return True
        time.sleep(0.05)
    return False

def align(page):
    page.evaluate("""() => { const K = BW.Kin; __fake.hold({ axes: K.encodePad(K.DEFAULT_Q0), center: true }); }""")
    time.sleep(0.3)
    page.evaluate("() => __fake.hold({ center: false })")
    time.sleep(0.2)

def bowl(page, opts, shots=None, name=None):
    wait_until(page, "__emb.G.mode === 'ready'", 20)
    time.sleep(0.3)
    info = queue_swing(page, opts)
    # screenshot mid back-swing and at release if asked
    if shots:
        for label, frac in shots:
            target = info['tRel'] + frac
            page.wait_for_function(f"performance.now() >= {target}", timeout=8000)
            page.screenshot(path=os.path.join(OUT, f'{name}_{label}.png'))
    wait_until(page, "__emb.G.mode === 'rolling' || __emb.G.mode === 'dropped'", 10)
    lt = page.evaluate("""() => { const r = __emb.G.lastThrow; return r ? { speed: r.rb.speed, kmh: r.rb.speed * 3.6, armKmh: r.rb.armSpeed * 3.6, vSrc: r.rb.vSrc, modelKmh: r.rb.armModelV ? Math.hypot(r.rb.armModelV.x, r.rb.armModelV.y, r.rb.armModelV.z) * 3.6 : null, heading: r.rb.heading * 180 / Math.PI, loft: r.rb.loft * 180 / Math.PI,
       sideRoll: r.rb.sideRoll, twist: r.rb.twist, pos: r.rb.pos, rpm: r.rb.rpm, n: r.f.n, bodyV: r.rb.bodyV, bodyP: r.bp } : null }""")
    return lt

def run():
    res = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'])
        page = b.new_page(viewport={'width': 1600, 'height': 900})
        page.add_init_script(path=os.path.join(HERE, 'playtest-init.js'))
        logs = []
        page.on('console', lambda m: logs.append(m.type + ': ' + m.text))
        page.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        page.on('response', lambda r: logs.append('404 ' + r.url) if r.status == 404 else None)
        page.goto(URL, wait_until='domcontentloaded', timeout=90000)
        page.add_script_tag(content=SWING_JS)
        wait_until(page, "window.__emb && __emb.G.mode === 'title'", 60)
        time.sleep(1.5)
        page.screenshot(path=os.path.join(OUT, 'title.png'))
        page.click('[data-act="practice"]')
        align(page)
        time.sleep(1.2)
        page.screenshot(path=os.path.join(OUT, 'ready.png'))
        res['fps_ready'] = page.evaluate("__emb.G.fps.v")

        def settle():
            wait_until(page, "__emb.G.mode === 'ready'", 25)

        if 'look' in SCEN:
            lt = bowl(page, {'peakW': 9, 'seed': 1}, shots=[('backswing', -380), ('release', -10), ('after', 120)], name='look')
            res['look'] = lt
            time.sleep(1.4); page.screenshot(path=os.path.join(OUT, 'look_follow.png'))
            wait_until(page, "__emb.G.firstHit", 8); time.sleep(0.12); page.screenshot(path=os.path.join(OUT, 'look_crash.png'))
            res['fps_crash'] = page.evaluate("__emb.G.fps.v")
            settle()
        if 'speeds' in SCEN:
            res['speeds'] = []
            for w in [4, 7, 10, 13]:
                lt = bowl(page, {'peakW': w, 'seed': 10 + w})
                res['speeds'].append({'peakW': w, **(lt or {})}); settle()
        if 'angles' in SCEN:
            res['angles'] = []
            for yaw in [-3, 0, 3]:
                lt = bowl(page, {'peakW': 9, 'yaw': yaw * 3.14159 / 180, 'seed': 30 + yaw})
                res['angles'].append({'yawDeg': yaw, **(lt or {})})
                time.sleep(1.6); page.screenshot(path=os.path.join(OUT, f'angle_{yaw}.png'))
                settle()
        if 'early' in SCEN:
            lt = bowl(page, {'peakW': 8, 'relPhi': -0.95, 'seed': 41})
            res['early'] = lt
            time.sleep(0.5); page.screenshot(path=os.path.join(OUT, 'early.png'))
            res['early_mode'] = page.evaluate("__emb.G.mode")
            time.sleep(1.2); page.screenshot(path=os.path.join(OUT, 'early2.png'))
            settle()
        if 'hook' in SCEN:
            lt = bowl(page, {'peakW': 8, 'twist': 1.8, 'seed': 51})
            res['hook'] = lt
            time.sleep(2.0); page.screenshot(path=os.path.join(OUT, 'hook.png'))
            settle()
        if 'strike' in SCEN:
            res['strike'] = []
            for k in range(4):
                lt = bowl(page, {'peakW': 11, 'yaw': -0.6 * 3.14159 / 180, 'twist': 1.4, 'noise': 0.25, 'seed': 300 + k})
                wait_until(page, "__emb.G.mode === 'result'", 20)
                time.sleep(0.5); page.screenshot(path=os.path.join(OUT, f'result_{k}.png')); time.sleep(0.9); page.screenshot(path=os.path.join(OUT, f'result_{k}b.png'))
                r = page.evaluate("({ label: document.querySelector('#banner .b-main').textContent, knocked: __emb.G.result && __emb.G.result.knocked })")
                res['strike'].append({**r, 'speed': lt and lt['speed'], 'heading': lt and lt['heading']})
                if k == 0:
                    wait_until(page, "__emb.G.mode === 'reset'", 10); time.sleep(0.9); page.screenshot(path=os.path.join(OUT, 'reset.png'))
                settle()
            page.screenshot(path=os.path.join(OUT, 'sheet.png'))
        def shot_result():
            wait_until(page, "__emb.G.mode === 'result' || __emb.G.mode === 'reset' || __emb.G.mode === 'ready' || __emb.G.mode === 'dropped'", 40)
            return page.evaluate("""() => { const G = __emb.G, r = G.lastThrow, L = __emb.P.LANE;
              const rb = r && r.rb, ap = G.atPins;
              let hook = null;
              if (rb && ap) { const xPred = rb.pos.x + (L.HEAD_Z + 0.25 - rb.pos.z) * (rb.v.x / rb.v.z); hook = ap.x - xPred; }
              return { mode: G.mode, board: ap && ap.board, tPins: ap && ap.t, hook_m: hook, knocked: G.result && G.result.knocked,
                label: document.querySelector('#banner .b-main').textContent }; }""")

        if 'feel' in SCEN:
            D = 3.14159 / 180
            table = [
                ('lazy swing (4 rad/s)', {'peakW': 4, 'seed': 61}),
                ('normal swing (8 rad/s)', {'peakW': 8, 'seed': 62}),
                ('hard swing (11 rad/s)', {'peakW': 11, 'seed': 63}),
                ('late release (+0.6 rad past bottom)', {'peakW': 8, 'relPhi': 0.6, 'seed': 64}),
                ('early drop (on the way down)', {'peakW': 8, 'relPhi': -0.95, 'seed': 65}),
                ('wrist twist 1.8 rad at release', {'peakW': 8, 'twist': 1.8, 'seed': 66}),
                ('normal + lunge 0.6 m', {'peakW': 8, 'seed': 67, 'lunge': {'dist': 0.6, 'dur': 0.6, 'end': 0.15}}),
                ('hard + 3-step walk 1.4 m', {'peakW': 11, 'seed': 68, 'lunge': {'dist': 1.4, 'dur': 1.4, 'end': 0.25}}),
                ('hard + twist 2 rad, aimed 0.8 deg right', {'peakW': 11, 'yaw': -0.8 * D, 'twist': 2.0, 'seed': 69, 'noise': 0.25}),
            ]
            res['feel'] = []
            for name, o in table:
                lt = bowl(page, o)
                r = shot_result()
                res['feel'].append({'name': name, 'opts': o, **(lt or {}), **r})
                print('feel', name, json.dumps({k: res['feel'][-1].get(k) for k in ('kmh', 'loft', 'board', 'hook_m', 'mode', 'label')}), page.evaluate("__emb.G.mode"), flush=True)
                wait_until(page, "__emb.G.mode === 'ready'", 30)
        if 'cycle' in SCEN:
            res['cycle'] = []
            for name, o in [('5 km/h roll', {'peakW': 2.0, 'seed': 71}), ('gutter (4 deg right)', {'peakW': 8, 'yaw': -4 * 3.14159 / 180, 'seed': 72}),
                            ('miss/light hit (2 deg right)', {'peakW': 8, 'yaw': -1.6 * 3.14159 / 180, 'seed': 73}), ('pocket', {'peakW': 10, 'yaw': 0.3 * 3.14159 / 180, 'seed': 74})]:
                lt = bowl(page, o)
                r = shot_result()
                wait_until(page, "__emb.G.mode === 'ready' && __emb.G.lastCycle && __emb.G.lastCycle.ready", 40)
                c = page.evaluate("(() => { const c = __emb.G.lastCycle; const o = {}; for (const k in c) o[k] = Math.round(c[k] - c.rel); return o; })()")
                res['cycle'].append({'name': name, 'kmh': lt and lt.get('kmh'), **r, 'ms': c,
                    'pit_or_gutter_to_ready_s': round((c['ready'] - min([c[k] for k in ('pit', 'gutter', 'end') if k in c])) / 1000, 2),
                    'release_to_ready_s': round(c['ready'] / 1000, 2)})
        res['fps_end'] = page.evaluate("__emb.G.fps.v")
        res['audio'] = page.evaluate("({ loaded: BW.Audio.loaded(), plays: BW.Audio.stats.plays, synth: BW.Audio.stats.synth, state: BW.Audio.ctx() && BW.Audio.ctx().state })")
        res['logs'] = logs[-30:]
        b.close()
    json.dump(res, open(os.path.join(OUT, 'results.json'), 'w'), indent=1)
    print(json.dumps(res, indent=1))

run()
