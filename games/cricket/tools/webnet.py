# A browser phone (QR) batting over a fast and a slow network: the same player should time the ball
# the same on both. The fake phone (playtest-init.js, P.net) captures at 60 Hz; its samples arrive
# `delay` + up to `jitter` ms later, stamped as mimic-link stamps them. It swings at the ball as a
# well-timed player would; every ball's timing error and result are collected per network.
# Usage: python games/cricket/tools/webnet.py   (needs tools/serve.py on 127.0.0.1:8765; headless, muted)
import json, os, statistics, sys
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
INIT = open(os.path.join(HERE, 'playtest-init.js'), encoding='utf8').read()
URL = 'http://127.0.0.1:8765/cricket/'
NETS = [('same Wi-Fi', 5, 15), ('relay', 150, 60)]
if os.environ.get('BT'): NETS = [('bluetooth', None, 0)] + NETS
SECS = int(os.environ.get('SECS', 70))

COLLECT = """(() => { window.__balls = []; let last = null;
  setInterval(() => { const G = __cricket.G, c = G.contact;
    if (c && c !== last && c.state !== 'arrived') { last = c;
      __balls.push({ state: c.state, how: c.how || null, e: G.lastTiming == null ? null : +G.lastTiming.toFixed(4) }); G.lastTiming = null; } }, 15); })()"""


def run(b, name, delay, jitter):
    pg = b.new_page(viewport={'width': 1366, 'height': 657})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    pg.add_init_script(INIT)
    pg.add_init_script("try { localStorage.setItem('willowlight.settings', JSON.stringify({ lag: 2, howto: 1 })); } catch (e) {}")
    pg.goto(URL)
    pg.wait_for_function("window.__cricket && __cricket.people.ready", timeout=60000)
    pg.evaluate("__phones[1].on = false; __phones[0].timing = 0.02")
    if delay is not None: pg.evaluate("__phones[0].net = { delay: %d, jitter: %d }" % (delay, jitter))
    pg.wait_for_timeout(500)
    pg.click('[data-act=solo]'); pg.click('[data-act=nets-bat]'); pg.wait_for_timeout(300)
    pg.evaluate("__phones[0].auto = 'play'")
    pg.evaluate(COLLECT)
    pg.wait_for_timeout(SECS * 1000)
    balls = pg.evaluate('__balls'); web = pg.evaluate('__cricket.seats[0] && __cricket.seats[0].input && __cricket.seats[0].input.S.web')
    pg.close()
    played = [x for x in balls if x['e'] is not None]
    es = [x['e'] for x in played]
    leaves = sum(1 for x in balls if x['how'] == 'leave')
    if os.environ.get('V'): print(balls)
    print('%-10s delay %3s ms: %d balls, %d swung at, timing median %+.0f ms (sd %.0f), %d left alone, %d missed; web=%s errs=%d'
          % (name, delay, len(balls), len(played), 1000 * statistics.median(es) if es else float('nan'),
             1000 * statistics.pstdev(es) if len(es) > 1 else 0, leaves, sum(1 for x in balls if x['how'] == 'miss'), web, len(errs)))
    return es, leaves, errs, web


with sync_playwright() as p:
    b = p.chromium.launch(args=['--headless=new', '--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
    res = {n: run(b, n, d, j) for n, d, j in NETS}
    b.close()
(e0, l0, er0, w0), (e1, l1, er1, w1) = res['same Wi-Fi'], res['relay']
ok = (w0 and w1 and len(e0) >= 5 and len(e1) >= 5 and abs(statistics.median(e0)) < 0.025 and abs(statistics.median(e1)) < 0.025
      and abs(statistics.median(e1) - statistics.median(e0)) < 0.02 and not er0 and not er1)
print('PASS' if ok else 'FAIL', 'a slow link times the ball the same as a fast one')
sys.exit(0 if ok else 1)
