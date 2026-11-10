"""Quick look/perf probe: python tools/probe.py <outdir> "<query>" [pose phi deg] ...
Opens practice with the fake Wand, holds an arm pose (arm angle from hanging, + forward),
optionally gripping, prints fps and saves a screenshot per query."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
items = sys.argv[2:] or ['']
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'])
    for i, it in enumerate(items):
        q, _, pose = it.partition('|')
        phi, grip = (pose.split(',') + ['0', '1'])[:2] if pose else ('0', '1')
        page = b.new_page(viewport={'width': 1600, 'height': 900})
        page.add_init_script(path=os.path.join(HERE, 'playtest-init.js'))
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto('http://127.0.0.1:8765/bowling/?' + q, wait_until='domcontentloaded', timeout=90000)
        try:
            page.wait_for_function("window.__emb && __emb.G.mode === 'title'", timeout=60000)
        except Exception:
            print("LOAD FAIL", errs, page.evaluate("document.querySelector('.ld-txt').textContent")); raise
        page.click('[data-act="practice"]')
        page.evaluate("""() => { const K = BW.Kin; __fake.hold({ axes: K.encodePad(K.DEFAULT_Q0), center: true }); }""")
        time.sleep(0.3); page.evaluate("() => __fake.hold({ center: false })"); time.sleep(0.6)
        page.evaluate(f"""() => {{ const K = BW.Kin; __fake.hold({{ axes: K.encodePad(K.mul(K.swingRot(0, {phi} * Math.PI / 180, 0), K.DEFAULT_Q0)), a: {'true' if grip == '1' else 'false'}, t: performance.now() }}); }}""")
        time.sleep(3.5)
        fps = page.evaluate("__emb.G.fps.v")
        page.screenshot(path=os.path.join(OUT, f'probe{i}.png'))
        print(i, repr(it), 'fps', round(fps, 1), errs[:3])
        page.close()
    b.close()
