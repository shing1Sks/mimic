# End-to-end check of the online room (games/lib/mimic-room.js, games/room/), headless Chromium:
#   - the cricket lobby shows the friend's link;
#   - the friend's room page joins as a viewer: live video of the game, the HUD/menus mirrored,
#     a phone QR; it reads the host's clock off the frames and reports the picture delay;
#   - two phone pages (the host's, and the friend's from the room page's QR, carrying &guest=) take
#     the seats; the match starts with the friend's seat remote: the canvas grows the friend's own
#     view beside the screen and the friend's video shows it.
# Starts its own server on a spare port. Usage: python games/lib/test/room.e2e.py [outdir]
import os, socket, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else None


def free_port():
    for n in range(8800, 8990, 2):
        try:
            for host, port in (('127.0.0.1', n), ('0.0.0.0', n + 1)):
                s = socket.socket(); s.bind((host, port)); s.close()
            return n
        except OSError:
            pass
    raise SystemExit('no free port in 8800-8990')


PORT = free_port()
PHONE_INIT = """
if (typeof DeviceOrientationEvent !== 'undefined') setInterval(() => {
  const n = () => (Math.random() - 0.5) * 0.02;
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 10 + n(), beta: 90 + n(), gamma: 5 + n() }));
}, 16);
"""
ARGS = ['--headless=new', '--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
        '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']


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
            host.wait_for_function('window.__cricket && __cricket.people.ready', timeout=60000)
            host.click('[data-act=versus]')
            host.wait_for_function("document.getElementById('online-url').value.length > 0", timeout=15000)
            invite = host.evaluate("document.getElementById('online-url').value")
            check('/room/?' in invite and 'room=' in invite and 'game=cricket' in invite, f'lobby shows the friend link: {invite}')

            gctx = b.new_context(viewport={'width': 1440, 'height': 810})
            guest = gctx.new_page()
            guest.on('pageerror', lambda e: errs.append('guest: ' + str(e)[:300]))
            guest.goto(invite.replace('localhost', '127.0.0.1'))
            guest.click('#r-go')
            guest.wait_for_function("document.body.classList.contains('live')", timeout=20000)
            guest.wait_for_function("document.getElementById('r-video').videoWidth > 0", timeout=20000)
            vw = guest.evaluate("[document.getElementById('r-video').videoWidth, document.getElementById('r-video').videoHeight]")
            check(vw[0] > 0, f'friend gets the video: {vw}')
            check(guest.evaluate("document.getElementById('r-video').srcObject.getAudioTracks().length") == 1, 'and the game sound')
            guest.wait_for_function("!!document.querySelector('#r-mirror #lobby')", timeout=10000)
            check(guest.evaluate("!document.querySelector('#r-mirror #lobby').classList.contains('hidden')"), 'friend sees the lobby, mirrored')
            guest.wait_for_function("!!document.querySelector('#r-phone .qr svg')", timeout=10000)
            purl = guest.evaluate('__room.state.phoneUrl')
            check('guest=v-' in purl, f'friend gets a phone QR marked as theirs: {purl}')
            host.wait_for_function("MimicRoom.viewers().some(v => v.delayMs != null)", timeout=20000)
            d = host.evaluate("MimicRoom.viewers()[0].delayMs")
            check(0 <= d < 600, f'host knows the friend\'s picture delay: {d} ms')
            if OUT: guest.screenshot(path=os.path.join(OUT, 'room_lobby.png'))
            st = host.evaluate("document.getElementById('online-state').textContent")
            check('watching' in st, f'lobby says the friend is watching: {st}')

            phones = []
            for i, u in enumerate([host.evaluate("MimicLink.url('grip')"), purl]):
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
            check(host.evaluate("MimicLink.phones().filter(p => p.guest).length") == 1, 'host tells the friend\'s phone apart')
            guest.wait_for_function("document.getElementById('r-phone').classList.contains('joined')", timeout=10000)
            check(True, 'friend\'s page shows the phone connected')
            for ph in phones:
                ph.evaluate("__mimicPhone.press('a', true)"); ph.wait_for_timeout(150); ph.evaluate("__mimicPhone.press('a', false)")
                host.wait_for_timeout(500)
            host.wait_for_function("document.querySelectorAll('#lobby .slot.joined').length === 2", timeout=10000)
            check(True, 'both phones took a seat')
            if OUT: host.screenshot(path=os.path.join(OUT, 'room_host_lobby.png'))
            phones[0].evaluate("__mimicPhone.press('a', true)"); host.wait_for_timeout(1400); phones[0].evaluate("__mimicPhone.press('a', false)")
            host.wait_for_function("__cricket.G.inGame", timeout=10000)
            host.wait_for_timeout(1500)
            cw = host.evaluate("[document.querySelector('#stage canvas').clientWidth, innerWidth]")
            check(cw[0] > cw[1] + 500, f'canvas grows the friend\'s view beside the screen: {cw}')
            # skip the walk-out, then compare the two views
            host.keyboard.press('Space'); host.wait_for_timeout(2500)
            if OUT:
                host.screenshot(path=os.path.join(OUT, 'room_host_game.png'))
                guest.screenshot(path=os.path.join(OUT, 'room_guest_game.png'))
            host.wait_for_timeout(5000)
            vw2 = guest.evaluate("[document.getElementById('r-video').videoWidth, document.getElementById('r-video').videoHeight]")
            print('  stats:', host.evaluate("""(async () => { const v = [...MimicRoom._viewers().values()][0]; const st = await v.pc.getStats(); const o = [];
              st.forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video') o.push({ w: r.frameWidth, fps: r.framesPerSecond, q: r.qualityLimitationReason, dur: r.qualityLimitationDurations, enc: r.encoderImplementation, tb: r.targetBitrate });
                if (r.type === 'candidate-pair' && r.nominated) o.push({ avail: r.availableOutgoingBitrate }); }); return JSON.stringify(o); })()"""))
            check(vw2[0] >= 960, f"the friend's picture is sharp after a few seconds: {vw2}")
            check(guest.evaluate("getComputedStyle(document.querySelector('#r-mirror #prompt-bat')).display") == 'none', 'friend sees only their own prompt')
            check(host.evaluate("getComputedStyle(document.getElementById('prompt-bowl')).display") == 'none', 'host sees only their own prompt')
            if OUT: guest.screenshot(path=os.path.join(OUT, 'room_guest_game2.png'))
            views = host.evaluate("__cricket.G.views")
            check(len(views) == 2 and views[0] != views[1], f'each player has their own view: {views}')
            check(host.evaluate("!document.getElementById('hud').classList.contains('split')"), 'no split screen on the host')
            lag = host.evaluate("MimicRoom.delayFor(MimicLink.phones().find(p => p.guest).guest)")
            check(lag > 0, f'the friend\'s swings get their picture delay: {lag} ms')
            check(not errs, f'no page errors: {errs[:5]}')
            b.close()
    finally:
        srv.terminate()
    print('FAILED' if check.failed else 'ALL PASS')
    sys.exit(1 if check.failed else 0)


main()
