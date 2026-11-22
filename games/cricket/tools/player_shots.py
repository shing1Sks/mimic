# Willowlight: close-up and wide screenshots of the players (kits, faces, gear, walk-out, celebrations)
# plus a frame-time measurement, for judging the cricketers by eye.
# Usage: python games/cricket/tools/player_shots.py <outdir> [port=8792] [teams=ind,pak] [which=all]
# Needs the game server (python tools/serve.py <port>) running from the repo root. Headless, muted, one browser.
import sys, os, json, time
from playwright.sync_api import sync_playwright

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8792
teams = (sys.argv[3] if len(sys.argv) > 3 else 'ind,pak').split(',')
which = (sys.argv[4] if len(sys.argv) > 4 else 'all').split(',')
want = lambda k: 'all' in which or k in which
URL = 'http://127.0.0.1:%d/cricket/' % port
ARGS = ['--headless=new', '--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
        '--disable-gpu-vsync', '--disable-frame-rate-limit']
IDS = ['ind', 'pak', 'aus', 'eng', 'rsa', 'nzl', 'mum', 'che', 'blr', 'kol', 'hyd', 'jai', 'del', 'pun']
report = {}

# camera helpers: G.dbgCam overrides the game camera each frame
CAM = """(o) => { __cricket.G.dbgCam = o; }"""
FREE = "() => { __cricket.G.dbgCam = null; }"
# keep the ball from being bowled while we look (the computer bowler waits on phaseT)
# G.demo pauses the game's logic (no ball is bowled, the walk stands still) while everyone keeps moving
HOLD = "() => { __cricket.G.demo = true; }"
UNHOLD = "() => { __cricket.G.demo = false; }"


def shot(pg, name, wait=0):
    if wait: pg.wait_for_timeout(wait)
    pg.screenshot(path=os.path.join(out, name + '.png'))


def measure(pg, secs=6):
    """Frame time with vsync off: rAF deltas over secs, plus draw calls and triangles."""
    return pg.evaluate("""(secs) => new Promise(res => {
      const ts = []; let last = performance.now(); const t0 = last;
      function f(now) { ts.push(now - last); last = now; if (now - t0 < secs * 1000) requestAnimationFrame(f); else {
        ts.sort((a, b) => a - b); const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
        const info = __cricket.renderer.info.render;
        res({ frames: ts.length, avg_ms: +avg.toFixed(2), p50_ms: +ts[ts.length >> 1].toFixed(2), p95_ms: +ts[Math.floor(ts.length * 0.95)].toFixed(2),
              calls: info.calls, tris: info.triangles, textures: __cricket.renderer.info.memory.textures, geos: __cricket.renderer.info.memory.geometries, pr: __cricket.renderScale }); } }
      requestAnimationFrame(f); })""", secs)


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={'width': 1600, 'height': 900})
    errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:300]))
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
    s = json.dumps({'howto': 1, 'comm': 1, 'gfx': 1, 'team0': IDS.index(teams[0]), 'team1': IDS.index(teams[1]), 'overs': 3, 'wkts': 3})
    pg.add_init_script("try { localStorage.setItem('willowlight.settings', JSON.stringify(%s)); } catch (e) {}" % s)
    if os.environ.get('GRID'): pg.add_init_script("addEventListener('DOMContentLoaded', () => { if (window.CK && CK.Kits) CK.Kits.debugGrid = true; })")
    pg.goto(URL)
    pg.wait_for_function("window.__cricket && __cricket.people.ready", timeout=90000)
    pg.wait_for_timeout(1500)
    pg.evaluate("__cricket.startSolo('cpu-match')")
    # the walk-out: the camera in front of the striker
    if want('walkout'):
        pg.wait_for_timeout(300); pg.evaluate(HOLD)
        pg.evaluate("() => { const G = __cricket.G; G.walk.t = G.walk.dur * 0.25; }")
        shot(pg, 'walkout_a', 700)
        pg.evaluate("() => { const G = __cricket.G; G.walk.t = G.walk.dur * 0.68; }")
        shot(pg, 'walkout_b', 700)
        # in close from the side, putting the helmet on
        pg.evaluate("""() => { const G = __cricket.G; if (G.walk) G.walk.t = G.walk.dur * 0.46; }""")
        pg.wait_for_timeout(100)
        pos = pg.evaluate("(() => { const r = __cricket.people.batter.root.position; return [r.x, r.z]; })()")
        pg.evaluate(CAM, {'p': [pos[0] + 3.4, 1.5, pos[1] - 1.6], 'l': [pos[0], 1.15, pos[1]], 'fov': 34})
        shot(pg, 'walkout_side', 250)
        pg.evaluate(FREE)
    pg.evaluate(UNHOLD)
    pg.keyboard.press('Space'); pg.wait_for_timeout(100)
    pg.wait_for_function("!__cricket.G.walk", timeout=15000)
    pg.evaluate(HOLD)
    pg.wait_for_timeout(500)
    if want('crease'):
        shot(pg, 'crease_broadcast', 300)
        # the striker: face and gear from the off side, then the non-striker
        bt = pg.evaluate("(() => { const r = __cricket.people.batter.root.position; return [r.x, r.z]; })()")
        pg.evaluate(CAM, {'p': [bt[0] + 2.4, 1.55, bt[1] - 0.9], 'l': [bt[0], 1.2, bt[1]], 'fov': 32})
        shot(pg, 'crease_close', 400)
        pg.evaluate(CAM, {'p': [bt[0] + 1.1, 1.7, bt[1] - 0.25], 'l': [bt[0], 1.6, bt[1]], 'fov': 30})
        shot(pg, 'crease_face', 300)
        ns = pg.evaluate("(() => { const r = __cricket.people.nonStriker.root.position; return [r.x, r.z]; })()")
        pg.evaluate(CAM, {'p': [ns[0] + 0.4, 1.6, ns[1] + 3.0], 'l': [ns[0], 1.1, ns[1]], 'fov': 34})
        shot(pg, 'nonstriker', 300)
        # the keeper from in front
        # (the game fades anyone between its own camera and the play: keep the keeper solid for this one)
        kp = pg.evaluate("(() => { const A = __cricket.people.fielders[0]; A.setOpacity(1); A._so = A.setOpacity; A.setOpacity = () => {}; const r = A.root.position; return [r.x, r.z]; })()")
        pg.evaluate(CAM, {'p': [kp[0] - 1.2, 1.4, kp[1] - 3.0], 'l': [kp[0], 0.75, kp[1]], 'fov': 34})
        shot(pg, 'keeper', 300)
        pg.evaluate("(() => { const A = __cricket.people.fielders[0]; A.setOpacity = A._so; })()")
    if want('kits'):
        # the bowler at his mark (the fielding side) and two fielders, close
        bw = pg.evaluate("(() => { const r = __cricket.people.bowler.root.position; return [r.x, r.z]; })()")
        pg.evaluate(CAM, {'p': [bw[0] - 0.5, 1.6, bw[1] + 3.2], 'l': [bw[0], 1.15, bw[1]], 'fov': 34})
        shot(pg, 'bowler_front', 300)
        pg.evaluate(CAM, {'p': [bw[0] + 0.3, 1.5, bw[1] - 2.6], 'l': [bw[0], 1.2, bw[1]], 'fov': 34})
        shot(pg, 'bowler_back', 300)
        hy = pg.evaluate("(() => { const v = new THREE.Vector3(); __cricket.people.bowler.B.head.getWorldPosition(v); return v.y + 0.08; })()")
        pg.evaluate(CAM, {'p': [bw[0], hy, bw[1] + 1.0], 'l': [bw[0], hy, bw[1]], 'fov': 22})
        shot(pg, 'face_front', 300)
        pg.evaluate(CAM, {'p': [bw[0] - 0.75, hy, bw[1] + 0.55], 'l': [bw[0], hy, bw[1]], 'fov': 24})
        shot(pg, 'face_three_q', 200)
        pg.evaluate(CAM, {'p': [bw[0] - 1.0, hy, bw[1]], 'l': [bw[0], hy, bw[1]], 'fov': 24})
        shot(pg, 'face_side', 200)
        for k in (2, 5):
            f = pg.evaluate("(k) => { const r = __cricket.people.fielders[k].root.position, ry = __cricket.people.fielders[k].root.rotation.y; return [r.x, r.z, ry]; }", k)
            fx, fz = __import__('math').sin(f[2]), __import__('math').cos(f[2])
            pg.evaluate(CAM, {'p': [f[0] + fx * 3.0 + fz * 0.6, 1.6, f[1] + fz * 3.0 - fx * 0.6], 'l': [f[0], 1.2, f[1]], 'fov': 32})
            shot(pg, 'fielder_%d' % k, 300)
    if want('wide'):
        pg.evaluate(CAM, {'p': [26, 22, 22], 'l': [0, 0, -14], 'fov': 40})
        shot(pg, 'wide_high', 400)
        pg.evaluate(CAM, {'p': [9, 4.5, 8], 'l': [-2, 0.8, -10], 'fov': 40})
        shot(pg, 'wide_low', 300)
    if want('stands'):
        # the crowd's flags and the big screen at the far end
        pg.evaluate(CAM, {'p': [0, 3, 2], 'l': [0, 9, -70], 'fov': 34})
        shot(pg, 'stands_screen', 500)
        pg.evaluate(CAM, {'p': [10, 2.5, -10], 'l': [60, 8, -10], 'fov': 30})
        shot(pg, 'stands_side', 300)
        pg.evaluate(FREE)
    if want('fp'):
        pg.evaluate("() => { __cricket.settings.camera = 1; }")
        shot(pg, 'firstperson', 600)
        pg.evaluate("() => { __cricket.settings.camera = 0; }")
    if want('perf'):
        pg.evaluate(FREE)
        pg.wait_for_timeout(300)
        report['perf_crease'] = measure(pg, 5)
        pg.evaluate(CAM, {'p': [26, 22, 22], 'l': [0, 0, -14], 'fov': 40})
        pg.wait_for_timeout(300)
        report['perf_wide'] = measure(pg, 5)
        pg.evaluate(FREE)
    if want('celebrate'):
        pg.evaluate(FREE)
        pg.evaluate("() => { const G = __cricket.G; G.celebrate = { t: 0.2, dur: 30 }; }")
        shot(pg, 'celebrate_a', 700)
        shot(pg, 'celebrate_b', 900)
        pg.evaluate("() => { __cricket.G.celebrate = null; }")
        pg.evaluate("() => __cricket.milestone('hundred', __cricket.G.match.i, __cricket.inn().wkts)")
        shot(pg, 'milestone_a', 1200)
        shot(pg, 'milestone_b', 1000)
    if want('walkoff'):
        pg.evaluate("() => { __cricket.G.milestone = null; __cricket.G.batCheer = 0; __cricket.G.helmetOff = false; }")
        pg.evaluate("() => __cricket.walkOut('wicket')")
        pg.evaluate(UNHOLD)   # (the man walking off is moved by the game's own walk step)
        pg.evaluate("() => { const G = __cricket.G; G.walk.t = G.walk.dur * 0.3; }")
        shot(pg, 'walkoff_a', 150)
        pg.evaluate("""() => { const G = __cricket.G; if (G.walk) G.walk.t = G.walk.dur * 0.4; }""")
        pg.wait_for_timeout(80)
        o = pg.evaluate("(() => { const r = __cricket.people.outgoing.root.position, ry = __cricket.people.outgoing.root.rotation.y; return [r.x, r.z, ry]; })()")
        import math
        fx, fz = math.sin(o[2]), math.cos(o[2])
        pg.evaluate(CAM, {'p': [o[0] + fx * 3.4 + fz * 1.0, 1.6, o[1] + fz * 3.4 - fx * 1.0], 'l': [o[0], 1.2, o[1]], 'fov': 34})
        shot(pg, 'walkoff_close', 300)
        pg.evaluate(FREE)
    report['errs'] = errs[:15]
    pg.close()
    b.close()
print(json.dumps(report, indent=1))
