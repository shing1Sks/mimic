// The Wand as a menu cursor: point the phone at the screen to move a pointer, press A to click
// whatever it is over. Games show it only in menus. Usage (after `mc.update()` each frame):
//   const cursor = MimicCursor.create(mc, { visible: () => inMenu, selector: 'button, .btn' });
//   ... each frame: if (cursor.update()) { /* A clicked something: skip your own A handling */ }
(function (root) {
  'use strict';
  const RADIUS = 28;          // px: a near miss still picks the button
  const TAU = 0.06;           // s: smoothing time constant (calms hand tremor, stays responsive)

  /** mc.pointer {x, y} (-1..1, +y up, may overshoot to 1.2) -> screen pixels, clamped. */
  function toScreen(p, w, h) {
    const x = (p.x + 1) / 2 * w, y = (1 - (p.y + 1) / 2) * h;
    return { x: Math.max(0, Math.min(w - 1, x)), y: Math.max(0, Math.min(h - 1, y)) };
  }

  function smooth(s, target, dt) {
    const k = 1 - Math.exp(-dt / TAU);
    return { x: s.x + (target.x - s.x) * k, y: s.y + (target.y - s.y) * k };
  }

  /** The clickable at (x, y), or the nearest within RADIUS. hit(x, y) -> clickable | null. */
  function pick(x, y, hit) {
    const c = hit(x, y);
    if (c) return c;
    for (const r of [RADIUS * 0.5, RADIUS]) {
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, e = hit(x + Math.cos(a) * r, y + Math.sin(a) * r);
        if (e) return e;
      }
    }
    return null;
  }

  const DEFAULT_SELECTOR = 'button, a[href], [data-act], .btn, .mi, .nav, .nav-item, .opt, input, select, [role="button"]';

  function create(mc, opts) {
    opts = opts || {};
    const selector = opts.selector || DEFAULT_SELECTOR;
    const el = document.createElement('div');
    el.className = 'mimic-cursor';
    el.innerHTML = '<i></i>';
    const css = document.createElement('style');
    css.textContent = `.mimic-cursor{position:fixed;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;z-index:2147483647;pointer-events:none;display:none;
      border-radius:50%;border:2px solid rgba(255,255,255,.95);box-shadow:0 0 0 2px rgba(0,0,0,.45),0 0 14px rgba(255,255,255,.35);transition:width .12s,height .12s,margin .12s}
      .mimic-cursor i{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff}
      .mimic-cursor.over{width:40px;height:40px;margin:-20px 0 0 -20px;border-color:#7cf2dc}
      .mimic-cursor.click{transform:scale(.8)}
      .mimic-hover{outline:2px solid rgba(124,242,220,.85)!important;outline-offset:2px}`;
    document.head.appendChild(css);
    document.body.appendChild(el);
    const hitAt = (x, y) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
      const h = document.elementFromPoint(x, y);
      const c = h && h.closest ? h.closest(selector) : null;
      return c && !c.disabled && c.offsetParent !== null ? c : null;
    };
    let pos = { x: innerWidth / 2, y: innerHeight / 2 }, last = performance.now(), hovering = null, clickT = 0;

    function setHover(c) {
      if (c === hovering) return;
      if (hovering) { hovering.classList.remove('mimic-hover'); hovering.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false })); hovering.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); }
      hovering = c;
      if (c) {
        c.classList.add('mimic-hover');
        c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: pos.x, clientY: pos.y }));
        c.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: pos.x, clientY: pos.y }));
        if (opts.onHover) opts.onHover(c);
      }
      api.hovering = c;
    }

    function click(c) {
      const o = { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, button: 0, view: root };
      if (c.matches('input[type="range"]')) {
        // A on a slider sets it where the cursor is
        const r = c.getBoundingClientRect(), f = Math.max(0, Math.min(1, (pos.x - r.left) / r.width));
        const lo = +c.min || 0, hi = c.max === '' ? 100 : +c.max;
        c.value = lo + f * (hi - lo);
        c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(t => c.dispatchEvent(new (t[0] === 'p' && root.PointerEvent ? PointerEvent : MouseEvent)(t, o)));
      c.click ? c.click() : c.dispatchEvent(new MouseEvent('click', o));
      if (c.focus) try { c.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }

    /** Call once per frame after mc.update(). Returns true if A clicked something this frame. */
    function update() {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      const show = mc.connected && mc.source === 'phone' && (!opts.visible || opts.visible());
      el.style.display = show ? 'block' : 'none';
      if (!show) { setHover(null); return false; }
      pos = smooth(pos, toScreen(mc.pointer, innerWidth, innerHeight), dt);
      el.style.transform = `translate(${pos.x.toFixed(1)}px,${pos.y.toFixed(1)}px)`;
      setHover(pick(pos.x, pos.y, hitAt));
      el.classList.toggle('over', !!hovering);
      if (clickT > 0 && now > clickT) { el.classList.remove('click'); clickT = 0; }
      if (hovering && mc.pressed('a')) {
        el.classList.add('click'); clickT = now + 120;
        click(hovering);
        return true;
      }
      return false;
    }

    const api = { update, hovering: null, element: el, get pos() { return pos; } };
    return api;
  }

  const api = { create, toScreen, smooth, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MimicCursor = api;
})(typeof window !== 'undefined' ? window : this);
