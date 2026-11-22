# A whole two-player match (the playtest's fake phones, autoplaying) watched from a friend's page by
# state (cricket/?join=): the friend's page has no seat, so it shows the host's own camera, which makes
# every moment comparable side by side: walk-outs, deliveries, hits, replays, banners, DRS, breaks.
# Saves host/friend screenshot pairs at each kind of moment and checks the friend's page never errors.
# Usage: python games/lib/test/room-spectate.e2e.py <outdir>
import json, os, socket, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
INIT = open(os.path.join(ROOT, 'games', 'cricket', 'tools', 'playtest-init.js'), encoding='utf8').read()
ARGS = ['--headless=new', '--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
        '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']


def free_port():
    for n in range(8840, 8990, 2):
        try:
            for host, port in (('127.0.0.1', n), ('0.0.0.0', n + 1)):
                s = socket.socket(); s.bind((host, port)); s.close()
            return n
        except OSError:
            pass
    raise SystemExit('no free port')


PORT = free_port()
fails = []
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'tools', 'serve.py'), str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(150):
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{PORT}/signal-info', timeout=1); break
        except Exception:
            time.sleep(0.1)
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        errs = []
        host = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
        host.on('pageerror', lambda e: errs.append('host: ' + str(e)[:300]))
        host.add_init_script(INIT)
        host.add_init_script("try { localStorage.setItem('willowlight.settings', JSON.stringify({ lag: 0, overs: 0, wkts: 0 })); } catch (e) {}")
        host.goto(f'http://127.0.0.1:{PORT}/cricket/')
        host.wait_for_function('window.__cricket && __cricket.people.ready && __cricket.net', timeout=60000)
        invite = host.evaluate("MimicLink.start().then(() => MimicRoom.inviteUrl())")
        guest = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
        guest.on('pageerror', lambda e: errs.append('guest: ' + str(e)[:300]))
        guest.on('console', lambda m: errs.append('guest console: ' + m.text[:200]) if m.type in ('error', 'warning') and '[net]' in m.text else None)
        guest.goto(invite.replace('localhost', '127.0.0.1'))
        guest.wait_for_function('window.__cricket && __cricket.people.ready && __cricket.net', timeout=60000)
        guest.click('#net-go')
        guest.wait_for_function('__cricket.net.stats().frames > 30', timeout=30000)
        # frame-exact parity: the host logs its friend camera and players per frame it sends, the friend
        # logs what it draws with the host time of that frame; the same host frame must look the same
        host.evaluate("""(() => { const T = __cricket, n = T.net, f = n.hostFrame; window.__hlog = new Map();
          n.hostFrame = function (now) { f.call(this, now); const c = T.camProxy, A = T.netActors();
            __hlog.set(now, [c.position.x, c.position.y, c.position.z, A[0].root.position.x, A[0].root.position.z, A[3].root.position.x, A[3].root.position.z]);
            if (__hlog.size > 4000) __hlog.delete(__hlog.keys().next().value); }; })()""")
        guest.evaluate("""(() => { const T = __cricket, n = T.net, f = n.guestFrame; window.__glog = [];
          n.guestFrame = function (dt) { const r = f.call(this, dt); if (r) { const c = T.camProxy, A = T.netActors();
            __glog.push([n.shownT, c.position.x, c.position.y, c.position.z, A[0].root.position.x, A[0].root.position.z, A[3].root.position.x, A[3].root.position.z]);
            if (__glog.length > 4000) __glog.shift(); } return r; }; })()""")
        # the match: two fake phones join and autoplay
        host.click('[data-act=versus]'); host.wait_for_timeout(500)
        host.evaluate("__phones[0].press('a', 300)"); host.wait_for_timeout(500)
        host.evaluate("__phones[1].press('a', 300)"); host.wait_for_timeout(500)
        host.evaluate("__phones[0].hold('a', true)"); host.wait_for_timeout(1500); host.evaluate("__phones[0].hold('a', false)")
        host.evaluate("__phones.forEach(P => P.auto = 'play')")
        seen, t0 = set(), time.time()
        shot = lambda k: (host.screenshot(path=f'{OUT}/{k}_host.png'), guest.screenshot(path=f'{OUT}/{k}_guest.png'))
        while time.time() - t0 < 240:
            s = host.evaluate("""(() => { const G = __cricket.G; return { screen: G.screen, phase: G.phase, walk: !!G.walk, replay: !!G.replay, drs: !!G.drs, cut: !!G.cutaway,
              banner: document.getElementById('banner').classList.contains('on') }; })()""")
            key = None
            if s['walk'] and 'walkout' not in seen: key = 'walkout'
            elif s['phase'] == 'runup' and 'runup' not in seen: key = 'runup'
            elif s['phase'] == 'hit' and 'hit' not in seen: key = 'hit'
            elif s['replay'] and 'replay' not in seen: key = 'replay'
            elif s['drs'] and 'drs' not in seen: key = 'drs'
            elif s['cut'] and 'cutaway' not in seen: key = 'cutaway'
            elif s['banner'] and 'banner' not in seen: key = 'banner'
            elif s['screen'] == 'break' and 'break' not in seen: key = 'break'
            elif s['screen'] == 'end': key = 'end'
            if key:
                host.wait_for_timeout(120 if key != 'walkout' else 1500)
                shot(key); seen.add(key)
                if key == 'break': host.click('#break-menu [data-act=continue]'); host.wait_for_timeout(2500); break
                if key == 'end': break
            host.wait_for_timeout(100)
        # a second friend joining now, part way through: the same kits, faces and board straight away
        g2 = b.new_context(viewport={'width': 1280, 'height': 720}).new_page()
        g2.on('pageerror', lambda e: errs.append('guest2: ' + str(e)[:300]))
        g2.goto(invite.replace('localhost', '127.0.0.1'))
        g2.wait_for_function('window.__cricket && __cricket.people.ready && __cricket.net', timeout=60000)
        g2.click('#net-go'); g2.wait_for_function('__cricket.net.stats().frames > 30', timeout=30000); g2.wait_for_timeout(1500)
        kits = "__cricket.netActors().map(A => A.kitKey || '')"
        hk, gk = host.evaluate(kits), g2.evaluate(kits)
        same = sum(1 for x, y in zip(hk, gk) if x == y)
        print(f'late joiner: {same}/{len(hk)} players in the same kit and face', '' if same == len(hk) else list(zip(hk, gk)))
        if same != len(hk): fails.append('late joiner kits differ')
        sc = "document.getElementById('sb-score').textContent + ' ' + document.getElementById('sb-overs').textContent"
        if host.evaluate(sc) != g2.evaluate(sc): fails.append(f'late joiner scoreboard: {host.evaluate(sc)} vs {g2.evaluate(sc)}')
        g2.screenshot(path=f'{OUT}/late_guest.png'); host.screenshot(path=f'{OUT}/late_host.png')
        hl = {round(k, 3): v for k, v in host.evaluate("[...__hlog.entries()]")}
        gl = guest.evaluate("__glog")
        n, worst, bad = 0, 0, 0
        for g in gl:
            h = hl.get(round(g[0], 3))
            if not h: continue
            n += 1
            e = max(abs(x - y) for x, y in zip(h, g[1:]))
            worst = max(worst, e); bad += e > 0.01
        print(f'frame-exact parity: {n} drawn frames matched to the host frame they show, worst {worst:.4f} m, {bad} off by > 1 cm')
        if n < 500 or bad: fails.append(f'parity: {n} frames, {bad} off')
        st = guest.evaluate('__cricket.net.stats()')
        print('moments:', sorted(seen))
        print('friend:', json.dumps({k: st[k] for k in ('ran', 'frames', 'packets', 'delay', 'age', 'applyMs')}))
        if errs: fails.append('page errors: ' + '; '.join(errs[:8]))
        b.close()
finally:
    srv.terminate()
print('\n'.join('FAIL ' + f for f in fails) if fails else 'ALL PASS')
sys.exit(1 if fails else 0)
