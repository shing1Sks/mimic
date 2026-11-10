# IRONFERN scripted playtest: plays each mission like a person with the phone in Grip mode (see
# playtest-bot.js) on the real GPU and writes per-phase stats, fps and player's-eye screenshots.
# Usage: python games/dino/tools/playtest.py <missions,comma> <outdir> [arrows=1] [timeout_s=420]
# Needs the game server (tools/serve.py) on 127.0.0.1:8765.
import sys, json, time, os
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
missions = sys.argv[1].split(',')
out = sys.argv[2]; os.makedirs(out, exist_ok=True)
arrows = (sys.argv[3] if len(sys.argv) > 3 else '1') == '1'
TMO = float(sys.argv[4]) if len(sys.argv) > 4 else 420
INIT = open(os.path.join(HERE, 'playtest-init.js')).read()
BOT = open(os.path.join(HERE, 'playtest-bot.js')).read()
summary = {}
with sync_playwright() as p:
    import os as _os
    b = p.chromium.launch_persistent_context(_os.path.abspath(os.path.join(out, '.profile')), viewport={'width':1600,'height':900}, headless=True, args=['--headless=new','--mute-audio','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    for m in missions:
        pg = b.new_page()
        cdp = b.new_cdp_session(pg); cdp.send('Network.enable'); cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})  # always the current code
        pg.add_init_script(INIT)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        pg.on('console', lambda msg: errs.append(msg.text[:300]) if msg.type == 'error' else None)
        pg.goto(f'http://127.0.0.1:8765/dino/?mission={m}', timeout=120000)
        pg.wait_for_function("window.__dh && window.__dh.state==='briefing'", timeout=180000)
        pg.screenshot(path=f'{out}/{m}_briefing.png')
        pg.add_script_tag(content=BOT)
        pg.evaluate(f"__bot.useArrows = {str(arrows).lower()}")
        pg.mouse.click(800, 450)  # "Click to begin"
        t0 = time.time(); n = 0
        while time.time() - t0 < TMO:
            st = pg.evaluate("({s: __dh.state, shots: __bot.wantShots.splice(0)})")
            for name in st['shots']:
                n += 1; pg.screenshot(path=f'{out}/{m}_{n:02d}_{name}.png')
            if st['s'] == 'results': break
            if st['s'] == 'pause': pg.evaluate("DH.Core.go('play')")
            time.sleep(0.25)
        pg.wait_for_timeout(600)
        pg.screenshot(path=f'{out}/{m}_zz_end.png')
        r = pg.evaluate("""(() => { const b = __bot, f = b.fpsS.slice(2).sort((a,c)=>a-c);
          return { state: __dh.state, wall: 0, phases: b.phases, result: b.result ? {total: b.result.total, stars: b.result.stars, time: +b.result.time.toFixed(1), deaths: b.result.deaths, acc: +b.result.accuracy.toFixed(2), dmg: b.result.damageTaken} : null,
            fps: f.length ? { med: +f[Math.floor(f.length/2)].toFixed(1), p10: +f[Math.floor(f.length*0.1)].toFixed(1), min: +f[0].toFixed(1) } : null,
            hurts: b.hurts, offscreenHurts: b.offscreenHurts, dodges: b.dodges, dodgeOk: b.dodgeOk,
            mission: DH.Missions.state.mode, seen: Array.from(b.seen.values()).map(r => r.kind + ':' + r.maxPx + 'px@' + r.dist + 'm' + (r.firstSeen == null ? '(NEVER)' : '')), attacks: b.log.filter(e => e.k==='attack').map(e => e.kind + (e.onscreen?'':'(off)') + (e.duck?'(duck)':'')) } })()""")
        r['wall'] = round(time.time() - t0, 1); r['errors'] = errs[:5]
        summary[m] = r
        print(m, json.dumps(r))
        json.dump(pg.evaluate("__bot.log"), open(f'{out}/{m}_log.json', 'w'))
        pg.close()
    b.close()
json.dump(summary, open(f'{out}/summary.json', 'w'), indent=1)
