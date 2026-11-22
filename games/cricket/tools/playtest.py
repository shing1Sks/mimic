# Willowlight scripted playtest on the real GPU with fake Mimic phones (playtest-init.js):
# title, options, solo menu and lobby at three laptop sizes (fit checks), a two-phone lobby (join,
# swap, hold to start) and a two-player match played by the fake phones, then solo nets.
# Usage: python games/cricket/tools/playtest.py <outdir> [scenarios=title,versus,solo]
# Needs the game server (tools/serve.py) on 127.0.0.1:8765. Headless and muted.
import sys, os, json, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
which = (sys.argv[2] if len(sys.argv) > 2 else 'title,versus,solo').split(',')
INIT = open(os.path.join(HERE, 'playtest-init.js'), encoding='utf8').read()
ARGS = ['--headless=new', '--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
URL = 'http://127.0.0.1:8765/cricket/'
report = {}


def page(b, w, h, settings=None):
    pg = b.new_page(viewport={'width': w, 'height': h})
    errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:300]))
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text[:300]) if m.type == 'error' else None)
    pg.add_init_script(INIT)
    s = json.dumps(settings or {})
    pg.add_init_script("try { localStorage.setItem('willowlight.settings', JSON.stringify(%s)); } catch (e) {}" % s)
    pg.goto(URL)
    pg.wait_for_function("window.__cricket && __cricket.people.ready", timeout=60000)
    pg.wait_for_timeout(800)
    return pg, errs


def state(pg):
    return pg.evaluate("""(() => { const T = __cricket, G = T.G, i = T.inn(); return { screen: G.screen, phase: G.phase, fps: Math.round(T.fps),
      score: i ? [i.runs, i.wkts, i.balls] : null, inn: G.match ? G.match.i : null, tags: G.lastTags, out: G.outcome && G.outcome.type,
      stroke: G.stroke && G.stroke.kind, rs: T.renderScale, shadows: T.shadows }; })()""")


def fits(pg):
    """Every visible element of the open screen (or the HUD) inside the viewport."""
    return pg.evaluate("""(() => { const bad = []; const W = innerWidth, H = innerHeight;
      document.querySelectorAll('.screen:not(.hidden) *, #hud:not(.hidden) *').forEach(el => {
        if (!el.offsetParent) return; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
        if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) bad.push((el.id || el.className || el.tagName) + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
      }); return bad.slice(0, 8); })()""")


def play(pg, secs, tag, shots):
    t0 = time.time(); seen = set(); fps = []
    while time.time() - t0 < secs:
        s = state(pg); fps.append(s['fps'])
        if s['screen'] in ('break', 'end'): break
        key = None
        want = lambda k: k in shots and k not in seen
        if s['phase'] == 'runup' and want('runup'): key = 'runup'; pg.wait_for_timeout(500)
        elif s['phase'] == 'flight' and want('flight'): key = 'flight'; pg.wait_for_timeout(200)
        elif s['phase'] == 'hit' and want('hit'): key = 'hit'; pg.wait_for_timeout(500)
        elif want('replay') and pg.evaluate("!!__cricket.G.replay"): key = 'replay'; pg.wait_for_timeout(900)
        elif want('banner') and pg.evaluate("document.getElementById('banner').classList.contains('on')"): key = 'banner'
        if key:
            pg.screenshot(path='%s/%s_%s.png' % (out, tag, key)); seen.add(key)
        pg.wait_for_timeout(120)
    return fps


MATCH_JS = "__cricket.G.match && __cricket.G.match.innings.map(i => [i.runs, i.wkts, i.balls, i.overs.flat().concat(i.cur).join(' ')])"

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    if 'title' in which:
        for (w, h) in [(1366, 657), (1536, 753), (1920, 969)]:
            pg, errs = page(b, w, h)
            pg.screenshot(path='%s/title_%d.png' % (out, w))
            r = {'fits': fits(pg)}
            pg.click('[data-act=options]'); pg.wait_for_timeout(300)
            pg.screenshot(path='%s/options_%d.png' % (out, w)); r['fits_opts'] = fits(pg)
            pg.click('#opts-menu [data-act=back]'); pg.click('[data-act=solo]'); pg.wait_for_timeout(300)
            pg.screenshot(path='%s/solo_%d.png' % (out, w)); r['fits_solo'] = fits(pg)
            pg.click('#solo-menu [data-act=back]'); pg.click('[data-act=versus]'); pg.wait_for_timeout(400)
            pg.screenshot(path='%s/lobby_%d.png' % (out, w)); r['fits_lobby'] = fits(pg)
            r['errs'] = errs; report['title_%d' % w] = r
            pg.close()
    if 'versus' in which:
        pg, errs = page(b, 1600, 900, {'lag': 0, 'overs': 0, 'wkts': 0})
        pg.click('[data-act=versus]'); pg.wait_for_timeout(500)
        pg.evaluate("__phones[0].press('a', 300)"); pg.wait_for_timeout(500)
        pg.evaluate("__phones[1].press('a', 300)"); pg.wait_for_timeout(500)
        pg.evaluate("__phones[1].press('one', 300)"); pg.wait_for_timeout(500)
        pg.screenshot(path='%s/versus_lobby.png' % out)
        swapped = pg.evaluate("__cricket.lobby.st.firstBat")
        pg.evaluate("__phones[0].press('one', 300)"); pg.wait_for_timeout(500)
        pg.evaluate("__phones[0].hold('a', true)"); pg.wait_for_timeout(1300); pg.evaluate("__phones[0].hold('a', false)")
        pg.wait_for_timeout(300)
        pg.evaluate("__phones.forEach(P => P.auto = 'play')")
        st = state(pg)
        fps = play(pg, 100, 'versus', {'runup', 'flight', 'hit', 'banner', 'replay'})
        s1 = state(pg)
        r_break = None
        if s1['screen'] == 'break':
            pg.screenshot(path='%s/versus_break.png' % out); r_break = fits(pg)
            pg.click('#break-menu [data-act=continue]'); pg.wait_for_timeout(500)
            fps += play(pg, 100, 'versus2', {'runup', 'hit', 'banner'})
        s2 = state(pg)
        if s2['screen'] == 'end': pg.screenshot(path='%s/versus_end.png' % out)
        report['versus'] = {'start': st, 'after1': s1, 'end': s2, 'swapped': swapped, 'fits_break': r_break,
                            'fps_min': min(fps) if fps else None, 'fps_avg': sum(fps) / max(1, len(fps)),
                            'log0': pg.evaluate("__phones[0].log.length"), 'log1': pg.evaluate("__phones[1].log.length"),
                            'errs': errs[:10], 'match': pg.evaluate(MATCH_JS)}
        pg.close()
    if 'wicket' in which:
        # the batter never moves, the bowler aims at the stumps: bowled / lbw, then the replay
        pg, errs = page(b, 1366, 657, {'lag': 0, 'overs': 0, 'wkts': 0})
        pg.click('[data-act=versus]'); pg.wait_for_timeout(500)
        for i in (0, 1):
            pg.evaluate("__phones[%d].press('a', 300)" % i); pg.wait_for_timeout(600)
        pg.evaluate("__phones[0].hold('a', true)"); pg.wait_for_timeout(1300); pg.evaluate("__phones[0].hold('a', false)")
        pg.wait_for_timeout(300)
        pg.evaluate("__phones.forEach((P, i) => { const s = __cricket.seats.findIndex(x => x.mc && x.mc.slot === i); if (__cricket.inn().bowl === s) { P.auto = 'play'; P.spinChance = 0; P.arm = [17, 19]; P.aimElev = -9; } })")
        fps = play(pg, 60, 'wicket', {'replay', 'banner'})
        report['wicket'] = {'state': state(pg), 'match': pg.evaluate(MATCH_JS), 'fps_avg': sum(fps) / max(1, len(fps)), 'errs': errs[:10]}
        pg.close()
    if 'solo' in which:
        pg, errs = page(b, 1366, 657, {'lag': 0})
        pg.evaluate("__phones[1].on = false")
        pg.wait_for_timeout(300)
        pg.click('[data-act=solo]'); pg.click('[data-act=nets-bat]'); pg.wait_for_timeout(300)
        pg.evaluate("__phones[0].auto = 'play'")
        fps = play(pg, 45, 'solo_bat', {'runup', 'flight', 'hit', 'banner'})
        sb = state(pg); mb = pg.evaluate(MATCH_JS); hud = fits(pg)
        pg.evaluate("__cricket.toTitle()"); pg.wait_for_timeout(300)
        pg.click('[data-act=solo]'); pg.click('[data-act=nets-bowl]'); pg.wait_for_timeout(300)
        fps2 = play(pg, 45, 'solo_bowl', {'runup', 'flight', 'hit', 'banner'})
        report['solo'] = {'bat': sb, 'bat_match': mb, 'hud_fits': hud, 'bowl': state(pg), 'bowl_match': pg.evaluate(MATCH_JS),
                          'fps_avg': sum(fps + fps2) / max(1, len(fps + fps2)), 'errs': errs[:10]}
        pg.close()
    b.close()
print(json.dumps(report, indent=1))
