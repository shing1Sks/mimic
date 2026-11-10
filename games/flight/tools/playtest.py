# Gyrowing scripted playtest through the real input path (a fake Mimic Pad, see playtest-pad.js):
# title -> menu -> options -> island takeoff and cruise (chase, cockpit, external views), pause,
# missions, and the real-world mode. Writes screenshots, fps and errors to <outdir>.
# Usage: python games/flight/tools/playtest.py <outdir> [realworld=1] [WxH=1600x900]
# Needs the game server on 127.0.0.1:8765 (and the internet for the real-world tiles).
import sys, os, json, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
RW = (sys.argv[2] if len(sys.argv) > 2 else '1') == '1'
W, H = (int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else '1600x900').split('x'))
PAD = open(os.path.join(HERE, 'playtest-pad.js'), encoding='utf-8').read()
errs, fps = [], {}
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--headless=new', '--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': W, 'height': H})
    pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg); cdp.send('Network.enable'); cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
    pg.add_init_script(PAD)
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:300]))
    pg.on('console', lambda m: errs.append(m.text[:300]) if m.type == 'error' else None)
    ev = pg.evaluate
    def shot(n): pg.screenshot(path=os.path.join(out, n + '.png'))
    def fpswin(name, sec):
        ev('__pad.fps.length = 0'); time.sleep(sec)
        f = sorted(ev('__pad.fps.slice(1)'))
        if f: fps[name] = {'med': round(f[len(f) // 2], 1), 'p10': round(f[int(len(f) * 0.1)], 1), 'n': len(f), 'hud': ev("document.getElementById('fps').textContent")}
    def flystate(): return ev("({mode: __pad.mode, state: __gw.state, agl: Math.round(__gyrowing.G.s.agl), kt: Math.round(__gyrowing.G.s.airspeed*1.944)})")
    pg.goto('http://127.0.0.1:8765/flight/')
    pg.wait_for_function("window.__gw && __gw.state === 'title'", timeout=120000)
    time.sleep(1.5); shot('01_title')
    ev('__pad.press(0)'); time.sleep(1.0); shot('02_menu'); print('after A on title:', ev('__gw.state'))
    ev("__gyrowing.menuAction('options')"); time.sleep(0.6); shot('03_options')
    ev('__pad.press(1)'); time.sleep(0.6)
    # island: takeoff with the pad
    ev("__gyrowing.menuAction('runway')"); time.sleep(2.5); shot('10_runway')
    ev("__pad.set({mode: 'takeoff'})")
    t0 = time.time()
    while time.time() - t0 < 60 and ev('__pad.mode') == 'takeoff' and ev('__gw.state') == 'fly': time.sleep(1)
    shot('11_climb'); print('takeoff', flystate())
    ev("__pad.set({mode: 'cruise', hdg: 0, alt: 350})"); fpswin('island_chase', 12); shot('12_cruise_turn')
    ev('__pad.press(3)'); time.sleep(2); fpswin('island_cockpit', 8); shot('13_cockpit')
    ev('__pad.press(3)'); time.sleep(2); shot('14_external')
    ev('__pad.press(3)'); time.sleep(1)
    ev("__pad.set({hdg: 200, alt: 250})"); time.sleep(12); shot('15_cruise2'); print('cruise', flystate())
    ev('__pad.press(9)'); time.sleep(0.8); shot('16_pause'); print('pause state', ev('__gw.state'))
    ev('__pad.press(1)'); time.sleep(0.8); print('after B', ev('__gw.state'))
    ev("__gyrowing.toMenu()"); time.sleep(0.5)
    ev("__gyrowing.menuAction('m:rings')"); time.sleep(3); shot('20_rings_start')
    ev("__pad.set({mode: 'cruise', hdg: null, alt: 200})"); fpswin('rings', 10); shot('21_rings'); print('rings', flystate())
    ev("__gyrowing.toMenu(); __gyrowing.menuAction('m:night')")
    time.sleep(3); ev("__pad.set({mode: 'cruise', hdg: null, alt: 250})"); time.sleep(6); shot('22_night')
    ev("__pad.set({mode: 'idle'})")
    if RW:
        ev("__gyrowing.toMenu(); __gyrowing.openPlace(Geo.PRESETS.find(p => p.id === 'zermatt') || Geo.PRESETS[0])"); time.sleep(2); shot('30_place')
        chs = ev("__gyrowing.G.place && __gyrowing.G.place.chs.map(c => c.id)")
        print('challenges', chs)
        ch = 'free' if chs and 'free' in chs else (chs[0] if chs else None)
        if ch:
            ev(f"__gyrowing.beginLoading(__gyrowing.G.place.chs.find(c => c.id === '{ch}'))"); time.sleep(1.5); shot('31_rwload')
            t0 = time.time()
            while time.time() - t0 < 150 and ev('__gw.state') != 'fly': time.sleep(1)
            print('rw state', ev('__gw.state'), round(time.time() - t0), 's')
            time.sleep(4); shot('32_rw_fly')
            if ev("__gyrowing.G.s.onGround"): ev("__pad.set({mode: 'takeoff', gearUp: false})")
            else: ev("__pad.set({mode: 'cruise', hdg: null, alt: 500})")
            fpswin('realworld', 15); shot('33_rw_cruise')
            ev('__pad.press(3)'); time.sleep(2); shot('34_rw_cockpit'); ev('__pad.press(3)'); time.sleep(0.3); ev('__pad.press(3)')
            time.sleep(10); shot('35_rw_late'); print('rw', flystate())
    print('fps', json.dumps(fps))
    print('errors', json.dumps(errs[:10]))
    json.dump({'fps': fps, 'errors': errs}, open(os.path.join(out, 'summary.json'), 'w'), indent=1)
    b.close()
