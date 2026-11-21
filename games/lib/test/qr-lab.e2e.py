# End-to-end check of the local Wi-Fi QR flow and its recordings (headless Chromium):
#   - tools/serve.py --https serves the phone page on https://<wifi address>:<port+1>, and the game's QR
#     points there (with the game's recording session in the URL);
#   - an emulated phone (self-signed certificate accepted, deviceorientation driven in swings) joins
#     the Swing Lab (games/lab/) over WebRTC through the shared signaling mailbox;
#   - the lab reads its swings through the cricket bat maths;
#   - nothing is lost: the game's log has every packet (link.pkt), pong and swing, and the phone
#     filed its own raw log (readings + packets sent) into the same recordings folder, packet for packet.
# Starts its own server on a spare port and removes only the recording folder it made.
# Usage: python games/lib/test/qr-lab.e2e.py
import json, os, shutil, socket, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
REC = os.path.join(ROOT, 'recordings')


def free_port():
    # a fixed low range: Windows reserves blocks of the high ephemeral ports (Hyper-V), which then
    # refuse a bind on 0.0.0.0 even when a quick probe on 127.0.0.1 looked free
    for n in range(8790, 8990, 2):
        try:
            for host, port in (('127.0.0.1', n), ('0.0.0.0', n + 1)):
                s = socket.socket(); s.bind((host, port)); s.close()
            return n
        except OSError:
            pass
    raise SystemExit('no free port pair in 8790-8990')


PORT = free_port()
HTTP = bool(os.environ.get('PHONE_HTTP'))   # phone page on http://127.0.0.1 instead of the https twin

# swings: beta sweeps 150 -> -30 deg in 240 ms (and back slowly), every 1.2 s, with sensor noise
PHONE_INIT = """
window.__vib = [];
navigator.vibrate = p => { window.__vib.push(p); return true; };
const T0 = performance.now();
if (typeof DeviceOrientationEvent !== 'undefined') setInterval(() => {   // (not on the blank page before load)
  const t = (performance.now() - T0) % 1200, n = () => (Math.random() - 0.5) * 0.02;
  let beta;
  if (t < 400) beta = 150;
  else if (t < 640) beta = 150 - 180 * (1 - Math.cos(Math.PI * (t - 400) / 240)) / 2;
  else beta = -30 + 180 * Math.min(1, (t - 640) / 560);
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 10 + n(), beta: beta + n(), gamma: 5 + n() }));
}, 16);
"""


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        check.failed = True
check.failed = False


def main():
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'tools', 'serve.py'), str(PORT), '--https'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    session = None
    try:
        info = {}
        for _ in range(150):
            try:
                info = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/signal-info', timeout=1)); break
            except Exception:
                time.sleep(0.1)
        check(info.get('https_port') == PORT + 1 and info.get('lan'), f'/signal-info names the https twin: {info}')
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, args=['--headless=new', '--mute-audio', '--disable-features=WebRtcHideLocalIpsWithMdns',
                                                       '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
            errs = []
            pc = b.new_context(viewport={'width': 1400, 'height': 900}).new_page()
            pc.on('pageerror', lambda e: errs.append('pc pageerror: ' + str(e)[:300]))
            pc.goto(f'http://127.0.0.1:{PORT}/lab/?rec=1')
            pc.wait_for_function('window.MimicLink && window.MimicProto && window.MimicRec && MimicRec.session', timeout=30000)
            session = pc.evaluate('MimicRec.session')
            url = pc.evaluate("MimicLink.showQR(null, 'grip').then(() => MimicLink.url('grip'))")
            pc.evaluate('MimicLink.hideQR()')
            check(url.startswith(f"https://{info['lan']}:{PORT + 1}/phone/"), f'QR points at the https phone page: {url}')
            check('rec=' + session in url, 'QR carries the recording session')

            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True)
            ctx.grant_permissions(['accelerometer', 'gyroscope', 'magnetometer'])
            ctx.add_init_script(PHONE_INIT)
            ph = ctx.new_page()
            ph.on('pageerror', lambda e: errs.append('phone pageerror: ' + str(e)[:300]))
            ph.goto(url if not HTTP else url.replace(f"https://{info['lan']}:{PORT + 1}", f'http://127.0.0.1:{PORT}'))
            check(ph.evaluate('window.isSecureContext'), 'phone page is a secure context (sensors allowed)')
            ph.wait_for_function("__mimicPhone.S.conn === 'ok'", timeout=20000)
            ph.wait_for_function('__mimicPhone.R.on === true', timeout=5000)
            ph.tap('.mode[data-mode=grip]')
            pc.wait_for_function('__lab.rows.length >= 4', timeout=20000)
            rows = pc.evaluate('__lab.rows')
            check(all(r['web'] > 1.4 for r in rows), f"lab reads the browser swings: {[round(r['web'], 1) for r in rows]}")
            pc.screenshot(path=os.path.join(REC, session, 'lab.png'))
            sent = ph.evaluate('__mimicPhone.S.sent')
            ph.goto('about:blank')   # leaving the page (pagehide): the phone flushes its last lines
            pc.wait_for_timeout(2500)   # the game's log flushes every 2 s
            pc.evaluate('MimicRec.stop()')
            pc.wait_for_timeout(800)
            b.close()

        folder = os.path.join(REC, session)
        files = os.listdir(folder)
        phone_files = [f for f in files if f.startswith('phone-') and f.endswith('.ndjson')]
        check(len(phone_files) == 1, f'phone log filed beside the game log: {files}')
        game = [json.loads(l) for l in open(os.path.join(folder, 'input.ndjson'), encoding='utf-8') if l.strip()]
        phone = [json.loads(l) for l in open(os.path.join(folder, phone_files[0]), encoding='utf-8') if l.strip()] if phone_files else []
        kinds = {}
        for o in phone:
            kinds[o['k']] = kinds.get(o['k'], 0) + 1
        check(phone and phone[0]['k'] == 'meta' and phone[0]['secure'], 'phone log starts with its meta (secure page)')
        # leaving the page sends the last lines as keepalive requests; headless Chromium refuses those
        # on a self-signed https origin (its certificate override dies with the page), so over https
        # only the final half second (one flush) may be missing. PHONE_HTTP=1 checks the final flush itself.
        if HTTP:
            check(any(o['k'] == 'pagehide' for o in phone), 'phone log runs to the page closing (final flush arrived)')
        check(kinds.get('do', 0) > 60 and kinds.get('tx', 0) > 60, f'phone log has raw readings and packets: {kinds}')
        pkts = [o for o in game if o.get('k') == 'ev' and o.get('name') == 'link.pkt']
        swings = [o for o in game if o.get('k') == 'ev' and o.get('name') == 'lab.swing']
        pongs = [o for o in game if o.get('k') == 'ev' and o.get('name') == 'link.pong']
        check(len(swings) >= 4 and len(pongs) >= 3, f'game log has swings ({len(swings)}) and clock pings ({len(pongs)})')
        tx_ok = {o['seq'] for o in phone if o['k'] == 'tx' and o['ok']}
        got = {o['seq'] for o in pkts}
        lost = len(tx_ok - got)
        logged = {o['seq'] for o in phone if o['k'] == 'tx'}
        late = sorted(got - logged)
        tail_only = all(q > max(logged) for q in late) if logged else False
        check(len(got) > 100 and lost == 0 and tail_only and len(late) <= (2 if HTTP else 40),
              f'every packet the phone logged as sent reached the game, and the phone log misses only its tail: {len(tx_ok) - lost} of {len(tx_ok)} reached, {len(late)} trailing not in the phone log')
        check(not errs, 'no page errors' + ('' if not errs else ': ' + ' | '.join(errs[:5])))
    finally:
        srv.terminate()
        if session and not os.environ.get('KEEP'):
            shutil.rmtree(os.path.join(REC, session), ignore_errors=True)   # only the folder this test made
    sys.exit(1 if check.failed else 0)


if __name__ == '__main__':
    main()
