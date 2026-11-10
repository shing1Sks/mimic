# End-to-end check of the browser controller: a PC game page and phone pages (emulated
# deviceorientation) in Chromium, connected over WebRTC through the dev signaling in tools/serve.py.
# Starts its own server on a spare port (the one on 8765 is left alone).
# Usage: python games/lib/test/mimic-link.e2e.py [outdir] [page=controller-test.html]
import json, os, statistics, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'recordings', 'mimic-link-e2e')
PAGE = sys.argv[2] if len(sys.argv) > 2 else 'controller-test.html'
def free_port():
    import socket
    s = socket.socket(); s.bind(('127.0.0.1', 0)); n = s.getsockname()[1]; s.close(); return n
PORT = free_port()
os.makedirs(OUT, exist_ok=True)

# the phone page sees sensors as events; this drives them at 60 Hz with a little noise (real sensors
# never repeat a sample exactly, and the Grip/Wand signature needs changing samples)
PHONE_INIT = """
window.__orient = { alpha: 0, beta: 0, gamma: 0 };
window.__vib = [];
navigator.vibrate = p => { window.__vib.push(p); return true; };
setInterval(() => {
  const o = window.__orient, n = () => (Math.random() - 0.5) * 0.02;
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: o.alpha + n(), beta: o.beta + n(), gamma: o.gamma + n() }));
}, 16);
"""

def main():
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'tools', 'serve.py'), str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    report = {}
    try:
        time.sleep(0.8)
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, args=['--headless=new', '--mute-audio', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
            errs = []
            pc_ctx = b.new_context(viewport={'width': 1400, 'height': 860})
            pc = pc_ctx.new_page()
            pc.on('pageerror', lambda e: errs.append('pc pageerror: ' + str(e)[:300]))
            pc.on('console', lambda m: errs.append('pc ' + m.type + ': ' + m.text[:300]) if m.type == 'error' else None)
            pc.goto(f'http://127.0.0.1:{PORT}/{PAGE}')
            pc.wait_for_function('window.MimicLink && window.MimicProto', timeout=30000)
            url = pc.evaluate("MimicLink.showQR(null, 'grip').then(() => MimicLink.url('grip'))")
            report['qr_url'] = url
            pc.wait_for_timeout(400)
            pc.screenshot(path=f'{OUT}/pc_qr_panel.png')
            pc.evaluate('MimicLink.hideQR()')

            def phone(mode, name):
                ctx = b.new_context(viewport={'width': 390, 'height': 844} if mode != 'pad' else {'width': 844, 'height': 390},
                                    device_scale_factor=2, is_mobile=True, has_touch=True)
                ctx.grant_permissions(['accelerometer', 'gyroscope', 'magnetometer'])
                ctx.add_init_script(PHONE_INIT)
                pg = ctx.new_page()
                pg.on('pageerror', lambda e: errs.append(name + ' pageerror: ' + str(e)[:300]))
                pg.on('console', lambda m: errs.append(name + ' ' + m.type + ': ' + m.text[:300]) if m.type == 'error' else None)
                pg.goto(url.replace('mode=grip', 'mode=' + mode))
                return pg

            ph1 = phone('grip', 'phone1')
            ph1.wait_for_timeout(300)
            ph1.screenshot(path=f'{OUT}/phone_home.png')
            try:
                ph1.wait_for_function("__mimicPhone.S.conn === 'ok'", timeout=15000)
            except Exception:
                print('phone status:', ph1.evaluate("document.getElementById('status').textContent"), 'url', url)
                print('pc peers:', pc.evaluate("Array.from(MimicLink._peers.values()).map(p => ({ id: p.id, open: p.open, st: p.pc.connectionState, ice: p.pc.iceConnectionState }))"))
                print(chr(10).join(errs))
                raise
            ph1.tap('.mode[data-mode=grip]')
            try:
                pc.wait_for_function("MimicController.all().length >= 1 && MimicController.all()[0].update() && MimicController.all()[0].connected", timeout=15000)
            except Exception:
                print('phone S:', ph1.evaluate("(() => { const S = __mimicPhone.S; return { mode: S.mode, playing: S.playing, q: S.q, sent: S.sent, seq: S.seq, sensor: !!S.sensor, motion: __mimicPhone.C.motion && __mimicPhone.C.motion.readyState }; })()"))
                print('pc peers:', pc.evaluate("Array.from(MimicLink._peers.values()).map(p => ({ id: p.id, joined: p.joined, mode: p.mode, axes: p.axes, idx: p.index, seq: p.lastSeq }))"))
                print('pads:', pc.evaluate("navigator.getGamepads().filter(Boolean).map(g => [g.id, g.buttons.length, g.axes.length, Array.from(g.axes)])"))
                print(chr(10).join(errs))
                raise
            pc.wait_for_timeout(500)
            st = pc.evaluate("(() => { const m = MimicController.all()[0]; m.update(); return { mode: m.mode, yaw: m.yaw * 180 / Math.PI, n: MimicController.all().length, id: navigator.getGamepads().filter(Boolean).map(g => g.id) }; })()")
            report['phone1_initial'] = st
            assert st['mode'] == 'grip', st

            # yaw follows the phone; measure motion-to-game latency (both pages share this PC's clock)
            # (polled from here: an in-page promise awaited by Playwright stalled headless Chromium)
            lat = []
            for i in range(30):
                target = 30 if i % 2 == 0 else -20
                t0 = ph1.evaluate(f'(() => {{ __orient.alpha = {target}; return performance.timeOrigin + performance.now(); }})()')
                t1 = 0
                for k in range(3000):
                    t1 = pc.evaluate(f"(() => {{ const m = MimicController.all()[0]; m.update(); return Math.abs(m.yaw * 180 / Math.PI - ({target})) < 1 ? performance.timeOrigin + performance.now() : 0; }})()")
                    if t1: break
                assert t1, 'yaw never followed'
                lat.append(t1 - t0)
                pc.wait_for_timeout(120)
            report['motion_to_game_ms'] = {'median': round(statistics.median(lat), 1), 'p90': round(sorted(lat)[int(len(lat) * 0.9) - 1], 1), 'min': round(min(lat), 1), 'max': round(max(lat), 1)}
            yaw = pc.evaluate("(() => { const m = MimicController.all()[0]; m.update(); return m.yaw * 180 / Math.PI; })()")
            report['yaw_after_last_move'] = round(yaw, 2)
            assert abs(yaw - (-20)) < 1, yaw
            # centre: the current heading becomes straight ahead
            ph1.evaluate('__mimicPhone.centre()')
            pc.wait_for_timeout(300)
            yaw = pc.evaluate("(() => { const m = MimicController.all()[0]; m.update(); return m.yaw * 180 / Math.PI; })()")
            report['yaw_after_centre'] = round(yaw, 2)
            assert abs(yaw) < 1, yaw
            # buttons: hold A
            ph1.evaluate("__mimicPhone.press('a', true)")
            pc.wait_for_timeout(150)
            a = pc.evaluate("(() => { const m = MimicController.all()[0]; m.update(); return m.isDown('a'); })()")
            ph1.evaluate("__mimicPhone.press('a', false)")
            pc.wait_for_timeout(150)
            a2 = pc.evaluate("(() => { const m = MimicController.all()[0]; m.update(); return m.isDown('a'); })()")
            report['button_a'] = [a, a2]
            assert a and not a2
            ph1.screenshot(path=f'{OUT}/phone_grip.png')
            # rumble back to the phone through MimicController#rumble
            pc.evaluate('MimicController.all()[0].rumble(1, 120, 0)')
            ph1.wait_for_timeout(300)
            report['phone1_vibrate'] = ph1.evaluate('__vib.slice(-1)')
            assert report['phone1_vibrate'], 'no vibration reached the phone'
            report['link_stats_phone1'] = pc.evaluate('MimicLink.phones()[0]')

            # second phone (Wand) and a third (Pad)
            ph2 = phone('wand', 'phone2')
            ph2.wait_for_function("__mimicPhone.S.conn === 'ok'", timeout=15000)
            ph2.evaluate("__orient.alpha = 10")
            ph2.tap('.mode[data-mode=wand]')
            ph2.wait_for_timeout(200)
            ph2.evaluate("__orient.alpha = 25")
            pc.wait_for_function("MimicController.all().length === 2", timeout=15000)
            pc.wait_for_timeout(600)
            two = pc.evaluate("MimicController.all().map(m => { m.update(); return { mode: m.mode, connected: m.connected, yaw: Math.round(m.yaw * 180 / Math.PI) }; })")
            report['two_phones'] = two
            assert [x['mode'] for x in two] == ['grip', 'wand'], two
            assert abs(two[1]['yaw'] - 15) <= 1, two
            ph2.screenshot(path=f'{OUT}/phone_wand.png')

            ph3 = phone('pad', 'phone3')
            ph3.wait_for_function("__mimicPhone.S.conn === 'ok'", timeout=15000)
            ph3.tap('.mode[data-mode=pad]')
            ph3.wait_for_timeout(400)
            ph3.evaluate("__mimicPhone.press('a', true); __mimicPhone.press('up', true)")
            pc.wait_for_timeout(300)
            pad = pc.evaluate("(() => { const g = navigator.getGamepads().find(p => p && p.buttons.length === 16); return g && { id: g.id, a: g.buttons[0].pressed, hat: g.axes[9], axes: g.axes.length }; })()")
            report['pad_phone'] = pad
            assert pad and pad['a'] and abs(pad['hat'] + 1) < 1e-6, pad
            ph3.evaluate("__mimicPhone.press('a', false); __mimicPhone.press('up', false)")
            ph3.wait_for_timeout(200)
            ph3.screenshot(path=f'{OUT}/phone_pad.png')
            report['motion_controllers_with_pad_present'] = pc.evaluate('MimicController.all().length')
            pc.wait_for_timeout(1500)
            report['link_stats'] = pc.evaluate('MimicLink.phones()')
            pc.screenshot(path=f'{OUT}/pc_page.png')
            pc.evaluate("MimicLink.showQR(null, '')"); pc.wait_for_timeout(300)
            pc.screenshot(path=f'{OUT}/pc_qr_panel_3phones.png')

            # a phone leaving: closing its page removes its pad
            ph2.context.close()
            pc.wait_for_function("MimicController.all().length === 1", timeout=20000)
            report['after_phone2_left'] = pc.evaluate('MimicController.all().length')
            report['errors'] = errs
            b.close()
    finally:
        srv.terminate()
    print(json.dumps(report, indent=1))

main()
