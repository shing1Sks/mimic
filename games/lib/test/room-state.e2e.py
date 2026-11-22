# End-to-end check of the online room drawn by the friend's laptop (state sync: games/lib/mimic-sync.js,
# games/cricket/net.js), headless Chromium:
#   - the lobby's friend link opens the game page with ?join=; that page joins as a state viewer;
#   - it mirrors the lobby, gives the friend a phone QR marked as theirs;
#   - two phone pages take the seats; the match starts; the host shows only its own view;
#   - the friend's page draws the friend's own view, its players matching the host's bone for bone
#     (compared on a still moment), at a measured delay, and the host judges with that delay;
#   - bytes per frame, frames dropped; and an audit: anything that moved on the host during play that
#     the friend's page is not sent (local decor excluded) is listed.
# Usage: python games/lib/test/room-state.e2e.py [outdir]
import json, os, socket, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else None


def free_port():
    for n in range(8820, 8990, 2):
        try:
            for host, port in (('127.0.0.1', n), ('0.0.0.0', n + 1)):
                s = socket.socket(); s.bind((host, port)); s.close()
            return n
        except OSError:
            pass
    raise SystemExit('no free port')


PORT = free_port()
PHONE_INIT = """
if (typeof DeviceOrientationEvent !== 'undefined') setInterval(() => {
  const n = () => (Math.random() - 0.5) * 0.02;
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 10 + n(), beta: 90 + n(), gamma: 5 + n() }));
}, 16);
"""
ARGS = ['--headless=new', '--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
        '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']

# every Object3D's local transform, visibility and material opacity, by uuid
SNAP = """(() => { const out = {}; __cricket.scene.traverse(o => {
  const m = o.material && !Array.isArray(o.material) ? o.material : null;
  out[o.uuid] = [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.scale.x, o.scale.y, o.scale.z, o.visible ? 1 : 0, m ? m.opacity : -1]; });
  return out; })()"""
# what the host sends, and what the friend's page animates by itself (crowd, cheerleaders, fans, flags, world)
COVER = """(() => { const T = __cricket, P = T.people, s = new Set();
  const add = o => { if (o) s.add(o.uuid); };
  add(T.camProxy);
  for (const A of T.netActors()) { add(A.root); A.model.traverse(o => { if (o.isBone) add(o); }); add(A.helmet); }
  for (const e of T.netObjects()) if (e.obj) { add(e.obj()); }
  T.scene.traverse(o => { if (o.parent && s.has(o.parent.uuid) && o.parent.geometry && o.parent.geometry.type === 'RingGeometry') add(o); });   // the marker's dot and halo (their materials are sent)
  const local = new Set();
  const sub = o => { if (o) o.traverse(x => local.add(x.uuid)); };
  (P.cheer || []).forEach(c => { sub(c.A.root); c.poms.forEach(sub); sub(c.plat); });
  (P.fans || []).forEach(f => { sub(f.A.root); if (f.flag) { sub(f.flag.flag); sub(f.flag.pole); } });
  return { covered: [...s], local: [...local] }; })()"""
NAME = """(ids => { const out = {}; const want = new Set(ids); __cricket.scene.traverse(o => { if (!want.has(o.uuid)) return;
  const path = []; let p = o; while (p && path.length < 5) { path.push((p.name || p.type) + (p.isBone ? '(bone)' : '')); p = p.parent; } out[o.uuid] = path.join(' < '); }); return out; })"""


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg, flush=True)
    if not cond:
        check.failed = True
check.failed = False


def main():
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
            host.goto(f'http://127.0.0.1:{PORT}/cricket/')
            host.wait_for_function('window.__cricket && __cricket.people.ready && __cricket.net', timeout=60000)
            host.click('[data-act=versus]')
            host.wait_for_function("document.getElementById('online-url').value.length > 0", timeout=15000)
            invite = host.evaluate("document.getElementById('online-url').value")
            check('/cricket/?' in invite and 'join=' in invite, f'the friend link opens the game itself: {invite}')

            guest = b.new_context(viewport={'width': 1440, 'height': 810}).new_page()
            guest.on('pageerror', lambda e: errs.append('guest: ' + str(e)[:300]))
            guest.on('console', lambda m: errs.append('guest console: ' + m.text[:200]) if m.type == 'error' else None)
            guest.goto(invite.replace('localhost', '127.0.0.1'))
            guest.wait_for_function('window.__cricket && __cricket.people.ready && __cricket.net', timeout=60000)
            guest.click('#net-go')
            try:
                guest.wait_for_function('__cricket.net.stats().frames > 60', timeout=30000)
            except Exception:
                print('  guest:', guest.evaluate("JSON.stringify({ st: __cricket.net.stats(), open: __cricket.net.link.open, off: __cricket.net.link.state.off, host: MimicRoom.viewers ? 1 : 0 })"))
                print('  host viewers:', host.evaluate("JSON.stringify(MimicRoom.viewers())"), errs[:5])
                raise
            check(guest.evaluate("!document.getElementById('lobby').classList.contains('hidden')"), 'the friend sees the lobby, mirrored')
            guest.wait_for_function("!!document.querySelector('#net-phone .qr svg')", timeout=10000)
            purl = guest.evaluate('__cricket.net.link.state.phoneUrl')
            check('guest=v-' in purl, f'the friend gets a phone QR marked as theirs: {purl}')
            v0 = host.evaluate("MimicRoom.viewers()[0]")
            check(v0['kind'] == 'state', f"the host sees a state viewer: {v0['kind']}")

            phones = []
            for u in [host.evaluate("MimicLink.url('grip')"), purl]:
                ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
                ctx.grant_permissions(['accelerometer', 'gyroscope', 'magnetometer'])
                ctx.add_init_script(PHONE_INIT)
                ph = ctx.new_page(); ph.on('pageerror', lambda e: errs.append('phone: ' + str(e)[:300]))
                ph.goto(u.replace('localhost', '127.0.0.1'))
                ph.wait_for_function("__mimicPhone.S.conn === 'ok'", timeout=20000)
                ph.wait_for_function('__mimicPhone.R.on === true', timeout=5000)
                ph.tap('.mode[data-mode=grip]')
                phones.append(ph)
            host.wait_for_function('MimicLink.phones().filter(p => p.connected).length === 2', timeout=20000)
            # each phone presses HOLD until it has a seat (a busy headless host can miss a short press)
            for n, ph in enumerate(phones):
                for _ in range(8):
                    if host.evaluate("document.querySelectorAll('#lobby .slot.joined').length") > n: break
                    ph.evaluate("__mimicPhone.press('a', true)"); ph.wait_for_timeout(300); ph.evaluate("__mimicPhone.press('a', false)")
                    host.wait_for_timeout(700)
            host.wait_for_function("document.querySelectorAll('#lobby .slot.joined').length === 2", timeout=10000)
            phones[0].evaluate("__mimicPhone.press('a', true)")
            host.wait_for_function("__cricket.G.inGame", timeout=30000)
            phones[0].evaluate("__mimicPhone.press('a', false)")
            check(True, 'both phones seated, the match is on')
            cover = host.evaluate(COVER)
            covered, local = set(cover['covered']), set(cover['local'])
            # the walk-out, then a ball or two: watch for anything moving that is not sent
            s0 = host.evaluate(SNAP); moved = set()
            for i in range(24):
                host.wait_for_timeout(400)
                if i == 8: host.keyboard.press('Space')
                s1 = host.evaluate(SNAP)
                for k, v in s1.items():
                    a = s0.get(k)
                    if a is None or any(abs(x - y) > 1e-4 for x, y in zip(a, v)): moved.add(k)
                s0 = s1
            unc = [k for k in moved if k not in covered and k not in local]
            names = host.evaluate(NAME, unc) if unc else {}
            print('  moved:', len(moved), 'covered:', len([k for k in moved if k in covered]), 'local decor:', len([k for k in moved if k in local]), 'not sent:', len(unc))
            for k in list(names)[:30]: print('   not sent:', names[k], host.evaluate("(id => { let r = null; __cricket.scene.traverse(o => { if (o.uuid === id) r = [o.type, o.material && o.material.type, o.geometry && o.geometry.type, o.visible, o.parent && o.parent.geometry && o.parent.geometry.type]; }); return r; })", k))
            check(host.evaluate("__cricket.room.seat") == 1 and host.evaluate("__cricket.room.kind") == 'state', 'the host knows seat 2 is the friend, by state')
            check(host.evaluate("!document.getElementById('hud').classList.contains('split')"), 'no split screen on the host')
            # a still moment: the bowler waiting at his mark; compare host and friend, bone for bone
            host.wait_for_function("__cricket.G.phase === 'ready' && !__cricket.G.walk", timeout=30000)
            host.wait_for_timeout(1200)
            pose = """(() => { const T = __cricket, out = [];
              for (const A of T.netActors()) { const r = A.root.position; const bs = []; let sk = null; A.model.traverse(o => { if (!sk && o.isSkinnedMesh) sk = o.skeleton; }); sk.bones.forEach(o => bs.push([o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.name]));
                out.push({ p: [r.x, r.y, r.z], v: A.root.visible, b: bs }); }
              return { actors: out, cam: [T.camera.position.x, T.camera.position.y, T.camera.position.z],
                       want: (T.camSt[1] ? [T.camSt[1].cam.position.x, T.camSt[1].cam.position.y, T.camSt[1].cam.position.z] : null), t: performance.now() }; })()"""
            hp, gp = host.evaluate(pose), guest.evaluate(pose)
            worstP, worstQ = 0, 0
            for a, g in zip(hp['actors'], gp['actors']):
                if not a['v']: continue
                worstP = max(worstP, max(abs(x - y) for x, y in zip(a['p'], g['p'])))
                for qa, qg in zip(a['b'], g['b']):
                    d = abs(sum(x * y for x, y in zip(qa[:4], qg[:4])))
                    import math
                    ang = 2 * math.degrees(math.acos(min(1, d)))
                    if ang > 8: print('   bone off: actor', hp['actors'].index(a), qa[4], round(ang, 1))
                    worstQ = max(worstQ, ang)
            # (the idle players still breathe: a few degrees between two moments ~D apart is the motion itself)
            check(worstP < 0.05, f'the friend sees the players where the host has them (worst {worstP * 100:.1f} cm)')
            check(worstQ < 8, f'and posed the same, bone for bone (worst {worstQ:.2f} deg)')
            camd = max(abs(x - y) for x, y in zip(gp['cam'], hp['want']))
            check(camd < 0.3, f"the friend's camera is their own seat's view ({camd:.3f} m off)")
            if OUT:
                host.screenshot(path=os.path.join(OUT, 'state_host.png')); guest.screenshot(path=os.path.join(OUT, 'state_guest.png'))
            check(guest.evaluate("getComputedStyle(document.getElementById('prompt-bat')).display") == 'none', 'the friend sees only their own prompt')
            check(host.evaluate("getComputedStyle(document.getElementById('prompt-bowl')).display") == 'none' and host.evaluate("getComputedStyle(document.getElementById('tips')).display") == 'none', 'the host sees only theirs (no bowling card while batting)')
            st = guest.evaluate('__cricket.net.stats()')
            vw = host.evaluate("MimicRoom.viewers().find(v => v.kind === 'state')")
            bpf = vw['bytes'] / max(1, vw['sent'])
            print('  host fps', round(host.evaluate('__cricket.fps')), ' friend fps', round(guest.evaluate('__cricket.fps')))
            print('  friend:', json.dumps(st), ' host sent', vw['sent'], 'frames,', round(bpf), 'B/frame, dropped', vw['dropped'])
            print('  host encode/send:', host.evaluate('JSON.stringify(__cricket.net.stats())'))
            check(st['age'] is not None and st['age'] < st['delay'] + st['interval'] + 3, f"picture delay {st['age']:.1f} ms: playout {st['delay']:.1f} (floor {st['floor']:.1f} + jitter {st['jitter']:.1f}) + under a frame ({st['interval']:.1f}) on this machine (rtt {st['rtt']:.1f})")
            r = st['ran']
            check(r.get('sfx', 0) >= 1 and r.get('dom', 0) > 10 and r.get('actor', 0) > 10, f"sounds, HUD and kits reach the friend: {r}")
            check(st['applyMs'] < 2.0, f"drawing the state costs the friend's page {st['applyMs']:.2f} ms a frame")
            check(bpf < 2500, f'about {bpf:.0f} bytes a frame ({bpf * 60 * 8 / 1000:.0f} kbit/s at 60 fps)')
            lag = host.evaluate("MimicRoom.delayFor(MimicLink.phones().find(p => p.guest).guest)")
            check(lag > 0, f"the friend's swings are judged with their delay: {lag} ms")
            check(not [e for e in errs if 'favicon' not in e], f'no page errors: {errs[:6]}')
            b.close()
    finally:
        srv.terminate()
    print('FAILED' if check.failed else 'ALL PASS')
    sys.exit(1 if check.failed else 0)


main()
