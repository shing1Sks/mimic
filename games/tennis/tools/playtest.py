# Sunvolley scripted playtest on the real GPU with fake Mimic Wands (playtest-init.js): menus with
# the Wand cursor and A/B only, a circuit match against the computer, pause, then a two-phone
# lobby and a full two-player match in split screen.
# Usage: python games/tennis/tools/playtest.py <outdir> [scenarios=menu,solo,versus]
# Needs the game server (tools/serve.py) on 127.0.0.1:8765.
import sys, os, json, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
which = (sys.argv[2] if len(sys.argv) > 2 else 'menu,solo,versus').split(',')
INIT = open(os.path.join(HERE, 'playtest-init.js'), encoding='utf8').read()
W, H = 1600, 900
report = {}

def point_at(pg, sel, wand=0):
    """Aim the Wand cursor at an element (mc.pointer: x = -yaw/0.45, y = pitch/0.3)."""
    r = pg.evaluate(f"(() => {{ const r = document.querySelector({json.dumps(sel)}).getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; }})()")
    px = r[0] / W * 2 - 1; py = 1 - r[1] / H * 2
    pg.evaluate(f"__wands[{wand}].roll = 0; __wands[{wand}].yaw = {-px * 0.45}; __wands[{wand}].pitch = {py * 0.3};")
    pg.wait_for_timeout(700)

def press(pg, name, wand=0, ms=120, wait=400):
    pg.evaluate(f"__wands[{wand}].press('{name}', {ms})"); pg.wait_for_timeout(wait)

def state(pg):
    return pg.evaluate("""(() => { const T = __sunvolley, G = T.G; return { screen: G.screen, mode: G.mode, kind: G.kind, inGame: G.inGame,
      paused: G.paused, score: G.score, stats: G.stats, hits: G.hits, whiffs: G.whiffs, rally: G.rally, fps: Math.round(T.fps), opp: G.opp.name,
      humanHits: T.humans.map(h => h.hits) }; })()""")

def play_until(pg, cond_js, timeout, shots=None, tag=''):
    """Let the bots play; screenshot on the first hit, a point banner, and slow motion."""
    t0 = time.time(); seen = set(); fps = []
    while time.time() - t0 < timeout:
        if pg.evaluate(cond_js): break
        s = pg.evaluate("({ mode: __sunvolley.G.mode, slow: __sunvolley.G.slow, rally: __sunvolley.G.rally, banner: document.getElementById('banner').className, sp: document.getElementById('speed').className, fps: __sunvolley.fps })")
        fps.append(s['fps'])
        if shots is not None:
            if 'hit' not in seen and 'on' in s['sp'] and s['mode'] == 'rally' and s['rally'] >= 1:
                pg.wait_for_timeout(250); pg.screenshot(path=f'{out}/{tag}_hit.png'); seen.add('hit')
            if 'slow' not in seen and s['slow'] > 0.3:
                pg.screenshot(path=f'{out}/{tag}_slowmo.png'); seen.add('slow')
            if 'point' not in seen and s['mode'] == 'point' and 'on' in s['banner']:
                pg.wait_for_timeout(200); pg.screenshot(path=f'{out}/{tag}_point.png'); seen.add('point')
            if 'rally4' not in seen and s['rally'] >= 4:
                pg.screenshot(path=f'{out}/{tag}_rally.png'); seen.add('rally4')
        pg.wait_for_timeout(150)
    return fps

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:300]))
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text[:300]) if m.type == 'error' else None)
    pg.add_init_script(INIT)
    pg.add_init_script("try { localStorage.removeItem('sunvolley.circuit'); localStorage.setItem('sunvolley.settings', JSON.stringify({games: 0})); } catch (e) {}")
    pg.goto('http://127.0.0.1:8765/tennis/')
    pg.wait_for_function("window.__sunvolley", timeout=60000)
    # sound is checked by events, never played out loud (the browser runs with --mute-audio)
    pg.evaluate("window.__sfx = {}; const S = TN.Audio.SFX; Object.keys(S).forEach(k => { const f = S[k]; S[k] = function () { __sfx[k] = (__sfx[k] || 0) + 1; return f.apply(this, arguments); }; })")
    pg.evaluate("__wands[0].on = true")
    pg.wait_for_timeout(1200)

    if 'menu' in which:
        point_at(pg, '[data-act=options]')
        pg.screenshot(path=f'{out}/menu_cursor.png')
        press(pg, 'a')
        pg.screenshot(path=f'{out}/menu_options.png')
        report['options_opened'] = pg.evaluate("__sunvolley.G.panel")
        press(pg, 'b')                       # B = back
        report['b_back'] = pg.evaluate("__sunvolley.G.panel")
        point_at(pg, '[data-act=circuit]')
        press(pg, 'a', wait=700)
        pg.screenshot(path=f'{out}/circuit_intro.png')
        report['intro'] = pg.evaluate("__sunvolley.G.screen")
        point_at(pg, '#intro-menu [data-act=play]')
        press(pg, 'a', wait=600)
        report['started'] = state(pg)['kind']
        print('menu', {k: report[k] for k in ('options_opened', 'b_back', 'intro', 'started')})

    if 'solo' in which:
        if not pg.evaluate("__sunvolley.G.inGame"): pg.evaluate("__sunvolley.showIntro(); __sunvolley.startGame('circuit')")
        pg.evaluate("__wands[0].yaw = 0; __wands[0].pitch = 0; __wands[0].auto = 0")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{out}/solo_serve.png')
        fps = play_until(pg, "__sunvolley.G.stats.won[0] + __sunvolley.G.stats.won[1] >= 3", 120, shots=True, tag='solo')
        # pause with B, resume with B
        press(pg, 'b', wait=500)
        pg.screenshot(path=f'{out}/solo_pause.png')
        report['pause'] = pg.evaluate("__sunvolley.G.paused")
        press(pg, 'b', wait=400)
        report['resume'] = not pg.evaluate("__sunvolley.G.paused")
        fps += play_until(pg, "__sunvolley.G.mode === 'ended'", 420, shots=True, tag='solo2')
        pg.wait_for_timeout(800)
        pg.screenshot(path=f'{out}/solo_end.png')
        s = state(pg)
        report['solo'] = {'score': s['score'], 'stats': s['stats'], 'hits': s['hits'], 'whiffs': s['whiffs'], 'fps_min': round(min(fps)), 'fps_avg': round(sum(fps) / len(fps)), 'log': pg.evaluate("__wands[0].log.length")}
        print('solo', json.dumps(report['solo']), 'pause', report['pause'], 'resume', report['resume'])

    if 'versus' in which:
        pg.evaluate("__wands[0].auto = null; __wands[1].on = true; __sunvolley.toTitle()")
        pg.wait_for_timeout(800)
        point_at(pg, '[data-act=versus]')
        press(pg, 'a', wait=600)
        pg.screenshot(path=f'{out}/lobby_empty.png')
        press(pg, 'a', wand=0, wait=300)
        press(pg, 'a', wand=1, wait=300)
        pg.evaluate("__wands[1].yaw = 0.8")   # P2 tests a swing in the lobby
        pg.wait_for_timeout(200)
        pg.screenshot(path=f'{out}/lobby_full.png')
        report['lobby'] = pg.evaluate("__sunvolley.lobby.st.slots.map(s => s && s.id)")
        pg.evaluate("__wands[0].hold('a', true)"); pg.wait_for_timeout(1300); pg.evaluate("__wands[0].hold('a', false)")
        pg.wait_for_timeout(600)
        report['versus_started'] = state(pg)['kind']
        print('lobby', report['lobby'], 'started', report['versus_started'])
        pg.evaluate("__wands.forEach((w, i) => { w.yaw = 0; w.pitch = 0; w.auto = i; })")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{out}/versus_serve.png')
        fps = play_until(pg, "__sunvolley.G.mode === 'ended'", 480, shots=True, tag='versus')
        pg.wait_for_timeout(800)
        pg.screenshot(path=f'{out}/versus_end.png')
        s = state(pg)
        report['versus'] = {'score': s['score'], 'stats': s['stats'], 'hits': s['hits'], 'humanHits': s['humanHits'], 'whiffs': s['whiffs'], 'fps_min': round(min(fps)), 'fps_avg': round(sum(fps) / len(fps))}
        print('versus', json.dumps(report['versus']))

    report['sfx'] = pg.evaluate("window.__sfx")
    print('sfx events', report['sfx'])
    report['errors'] = errs
    print('errors', len(errs)); [print('  ', e) for e in errs[:20]]
    json.dump(report, open(f'{out}/report.json', 'w'), indent=1)
    b.close()
