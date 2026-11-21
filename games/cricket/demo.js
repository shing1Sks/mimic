/*
 * Willowlight - the how-to before an innings: how to hold the phone and what each movement does,
 * as short animated steps (a hand, the phone, the arm), one card per player about to bat or bowl.
 * Any button, a click, Space or Enter skips it. CK.Demo.show(roles, done), roles: [{ role: 'bowl' |
 * 'bat', who, keys: { a, centre } }].
 */
(function () {
  'use strict';
  const CK = window.CK = window.CK || {};
  const STEP_MS = 3400;

  // the pieces, drawn with the shoulder at (0, 0) and the arm pointing up (-y): a sleeve, a fist round
  // the phone (its top out of the fist), and a bat on top of it for batting. Everything turns about the
  // shoulder with SVG's own animation (no CSS pivots to get wrong).
  const D = '2.2s';
  const spin = (vals, times, dur) => `<animateTransform attributeName="transform" type="rotate" values="${vals}" ${times ? `keyTimes="${times}"` : ''} dur="${dur || D}" repeatCount="indefinite" calcMode="${times ? 'spline' : 'linear'}" ${times ? `keySplines="${times.split(';').slice(1).map(() => '0.45 0 0.35 1').join(';')}"` : ''}/>`;
  const keyAnim = (on) => on === 'whip' ? `<animate attributeName="fill" values="#ffc24d;#ffc24d;#8a92ad;#8a92ad" keyTimes="0;0.44;0.47;1" dur="${D}" repeatCount="indefinite"/>` : '';
  const phone = (key, back) => `<g class="ph"><rect x="-11" y="-142" width="22" height="46" rx="5" class="ph-body"/>${back ? '<circle cx="-4" cy="-134" r="2.6" class="ph-cam"/>' : '<rect x="-8" y="-138" width="16" height="35" rx="2" class="ph-screen"/>'}<rect x="10" y="-130" width="3" height="11" rx="1.5" class="ph-key${key === 'on' ? ' on' : ''}">${keyAnim(key)}</rect></g>`;
  const fist = `<rect x="-15" y="-102" width="30" height="27" rx="10" class="skin"/><rect x="-15" y="-96" width="30" height="5" rx="2.5" class="skin-d"/><rect x="-15" y="-88" width="30" height="5" rx="2.5" class="skin-d"/>`;
  const sleeve = `<rect x="-10" y="-80" width="20" height="84" rx="10" class="sleeve"/>`;
  const bat = `<rect x="-3.5" y="-174" width="7" height="36" rx="2" class="bat-handle"/><rect x="-12" y="-266" width="24" height="96" rx="7" class="bat-blade"/><rect x="-12" y="-266" width="24" height="10" rx="5" class="bat-toe"/>`;
  const arm = (o = {}) => `${o.bat ? bat : ''}${sleeve}${fist}${o.phone || phone(o.key)}`;
  // place(x, y, scale, rotation or animation, contents)
  const place = (x, y, s, rot, inner) => `<g transform="translate(${x} ${y}) scale(${s})"><g ${typeof rot === 'number' ? `transform="rotate(${rot})"` : ''}>${typeof rot === 'string' ? rot : ''}${inner}</g></g>`;
  const strip = `<path d="M150 196 L174 92 L214 92 L238 196 Z" class="pitch"/><rect x="176" y="96" width="36" height="3" class="crease"/>`;
  const label = (x, y, t, s) => `<text x="${x}" y="${y}" class="v-t">${t}</text>${s ? `<text x="${x}" y="${y + 13}" class="v-s">${s}</text>` : ''}`;

  const ART = {
    bowl: [
      // 1 the grip: top of the phone out of the fist, along the forearm; thumb on Vol Down
      `${place(110, 196, 1, 0, arm())}<g class="tag"><text x="140" y="52">TOP</text><path d="M136 56 l-12 8"/><text x="140" y="80">VOL DOWN</text><path d="M136 76 l-10 -6"/></g>`,
      // 2 aim: hold still, then tilt; the ring on the strip follows
      `${strip}<circle cx="194" cy="150" r="9" class="ring"><animate attributeName="cy" values="150;150;172;172;124;124;150" keyTimes="0;0.15;0.35;0.55;0.75;0.92;1" dur="2.8s" repeatCount="indefinite"/></circle>
       ${place(70, 196, 0.95, spin('0;0;14;14;-10;-10;0', '0;0.15;0.35;0.55;0.75;0.92;1', '2.8s'), arm())}`,
      // 3 run in: hold Vol Down, the arm goes back
      `${place(128, 112, 0.62, spin('-20;-105;-105', '0;0.5;1', '2.2s'), arm({ key: 'on' }))}<g class="runner"><circle cx="196" cy="182" r="3.5"/><circle cx="210" cy="182" r="3.5"/><circle cx="224" cy="182" r="3.5"/></g><text x="120" y="190" class="hint-t">HOLD VOL DOWN · RUN IN</text>`,
      // 4 whip it over and let go at the top
      `${place(108, 118, 0.62, spin('-105;-105;0;80;80', '0;0.15;0.45;0.7;1', D), arm({ key: 'whip' }))}
       <circle r="5" class="ball" cx="108" cy="30" opacity="0"><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.44;0.46;0.8;1" dur="${D}" repeatCount="indefinite"/><animate attributeName="cx" values="108;108;236" keyTimes="0;0.45;1" dur="${D}" repeatCount="indefinite"/><animate attributeName="cy" values="30;30;130" keyTimes="0;0.45;1" dur="${D}" repeatCount="indefinite"/></circle>
       <text x="120" y="190" class="hint-t">LET GO AS IT COMES OVER</text>`,
      // 5 variations: a twist, a wrist turned, the hand turned over
      `${place(45, 150, 0.6, 0, `${sleeve}${fist}<g>${phone()}<animateTransform attributeName="transform" type="scale" values="1 1;-0.35 1;1 1" dur="1.4s" repeatCount="indefinite"/></g>`)}<path d="M30 52 a15 6 0 1 0 30 0" class="arc"/>${label(45, 168, 'TWIST', 'spin · fast arm: cutter')}
       ${place(120, 150, 0.6, spin('0;0;26;26;0', '0;0.2;0.4;0.8;1', '2.4s'), arm())}${label(120, 168, 'WRIST TURNED', 'swing')}
       ${place(195, 150, 0.6, 0, `${sleeve}${fist}<g>${phone()}<animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.3;0.4;0.8;0.9" dur="2.4s" repeatCount="indefinite"/></g><g opacity="0">${phone(null, true)}<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.3;0.4;0.8;0.9" dur="2.4s" repeatCount="indefinite"/></g>`)}${label(195, 168, 'HAND OVER', 'slower ball')}`,
    ],
    bat: [
      // 1 the phone is the handle: its top is the blade
      `${place(120, 198, 0.62, 0, arm({ bat: true }))}<g class="tag"><text x="146" y="52">BLADE</text><path d="M142 50 l-12 4"/><text x="146" y="112">HANDLE = PHONE</text><path d="M142 110 l-10 0"/></g>`,
      // 2 stance: the phone points down like a grounded bat; then align
      `${place(120, 18, 0.58, 180, arm({ bat: true }))}<text x="200" y="100" class="hint-t">CENTRE</text><text x="200" y="112" class="v-s">to align</text>`,
      // 3 swing as it arrives: fastest at the bottom of the arc, where the ball is
      `${place(96, 92, 0.36, spin('320;320;180;40;40', '0;0.2;0.5;0.72;1', D), arm({ bat: true }))}
       <circle r="5" class="ball"><animate attributeName="cx" values="236;236;100" keyTimes="0;0.15;0.5" dur="${D}" repeatCount="indefinite"/><animate attributeName="cy" values="110;110;176" keyTimes="0;0.15;0.5" dur="${D}" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.52;0.56" dur="${D}" repeatCount="indefinite"/></circle>
       <text x="120" y="194" class="hint-t">FASTEST AT THE BALL = THE MIDDLE</text>`,
      // 4 straight bat or cross bat
      `${place(62, 74, 0.31, spin('320;320;180;60;60', '0;0.15;0.5;0.75;1', '1.8s'), arm({ bat: true }))}${label(65, 170, 'STRAIGHT BAT', 'full balls: drive')}
       ${place(168, 108, 0.27, spin('-100;-100;0;100;100', '0;0.15;0.5;0.75;1', '1.8s'), arm({ bat: true }))}${label(175, 170, 'CROSS BAT', 'short balls: pull')}`,
      // 5 leave it, or a gentle push
      `${place(65, 26, 0.42, 180, arm({ bat: true }))}${label(65, 170, 'KEEP STILL', 'leave it')}
       ${place(175, 26, 0.42, spin('180;180;158;158;180', '0;0.25;0.5;0.7;1', '1.6s'), arm({ bat: true }))}${label(175, 170, 'GENTLE PUSH', 'defend')}`,
    ],
  };
  const COPY = {
    bowl: [
      ['HOLD IT LIKE THE BALL', 'Phone in your bowling hand, its top pointing out of your fist along your forearm. Thumb on <b>{a}</b>.'],
      ['AIM WITH A TILT', 'Hold still for a moment, then tilt: toward the screen pitches it fuller, back pulls it shorter, sideways moves the line.'],
      ['HOLD TO RUN IN', 'Hold <b>{a}</b> and your bowler runs in. Keep holding while your arm swings back.'],
      ['WHIP IT OVER, LET GO', 'Bring your arm over the top and let go of <b>{a}</b> as it comes over. A faster arm bowls faster.'],
      ['MIX IT UP', 'Twist your wrist as you let go for spin (with a fast arm, a cutter). Wrist turned from your usual grip swings it. Turn your hand right over for a slower ball.'],
    ],
    bat: [
      ['THE PHONE IS THE HANDLE', 'Hold it like a bat handle: the top of the phone is the blade.'],
      ['TAKE YOUR STANCE', 'Point the phone down like a grounded bat and press <b>{c}</b> so the game knows where forward is.'],
      ['SWING AS IT ARRIVES', 'Swing so your bat is fastest when the ball reaches you: that’s the middle. Your swing’s path aims the shot.'],
      ['STRAIGHT OR CROSS', 'A straight bat drives the full ones; a flat, cross-bat swing pulls the short ones.'],
      ['LEAVE OR DEFEND', 'Keep still to leave it alone. A small, gentle push blocks it.'],
    ],
  };

  let open = null;
  function close() {
    if (!open) return;
    const o = open; open = null;
    clearInterval(o.timer);
    o.el.classList.remove('on');
    setTimeout(() => { o.el.hidden = true; o.el.innerHTML = ''; }, 260);
    o.done && o.done();
  }
  /** o: { step (start here), hold (no auto-advance: tests and captures) } */
  function show(roles, done, o2) {
    o2 = o2 || {};
    const el = document.getElementById('demo');
    if (!el || !roles.length) { done && done(); return; }
    if (open) close();
    const panes = roles.map(r => {
      const fill = s => s.replace(/\{a\}/g, r.keys.a).replace(/\{c\}/g, r.keys.centre);
      return `<div class="demo-pane" data-role="${r.role}">
        <div class="demo-head"><span class="demo-kick">${r.role === 'bowl' ? 'HOW TO BOWL' : 'HOW TO BAT'}</span>${r.who ? `<span class="demo-who">${r.who}</span>` : ''}</div>
        <div class="demo-body"><svg class="demo-art" viewBox="0 0 240 200" aria-hidden="true"></svg>
        <div class="demo-copy"><h3></h3><p></p><div class="demo-dots">${COPY[r.role].map(() => '<i></i>').join('')}</div></div></div>
        <template>${JSON.stringify(COPY[r.role].map(([h, p]) => [h, fill(p)]))}</template></div>`;
    }).join('');
    el.innerHTML = `<div class="demo-wrap${roles.length > 1 ? ' two' : ''}">${panes}<div class="demo-skip">Any button, a click or Space to skip</div></div>`;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('on'));
    const o = open = { el, done, step: (o2.step || 0) - 1, timer: 0 };
    const paneEls = [...el.querySelectorAll('.demo-pane')];
    const go = () => {
      o.step++;
      if (o.step >= 5) { close(); return; }
      paneEls.forEach(p => {
        const role = p.dataset.role, copy = JSON.parse(p.querySelector('template').innerHTML);
        const svg = p.querySelector('svg');
        svg.innerHTML = ART[role][o.step];
        svg.classList.remove('play'); void svg.getBoundingClientRect(); svg.classList.add('play');
        p.querySelector('h3').textContent = copy[o.step][0];
        p.querySelector('p').innerHTML = copy[o.step][1];
        p.querySelectorAll('.demo-dots i').forEach((d, i) => { d.className = i < o.step ? 'done' : i === o.step ? 'now' : ''; });
      });
    };
    go();
    if (!o2.hold) o.timer = setInterval(go, STEP_MS);
    el.onclick = close;
  }
  CK.Demo = { show, close, get open() { return !!open; } };
})();
