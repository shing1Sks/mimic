// Teams: fictional IPL-style franchises and national sides, fictional players.
// Run: node games/cricket/test/teams.test.js
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'teams.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}

check('14 teams: 8 franchises and 6 national sides', T.TEAMS.length === 14 && T.TEAMS.filter(t => t.kind === 'franchise').length === 8 && T.TEAMS.filter(t => t.kind === 'nation').length === 6);
check('India and Pakistan are there', ['India', 'Pakistan'].every(n => T.TEAMS.some(t => t.name === n)));
check('every team: id, name, 3-letter short, kit colours, a css colour', T.TEAMS.every(t => t.id && t.name && /^[A-Z]{3}$/.test(t.short) && [t.shirt, t.pants, t.accent].every(c => Number.isInteger(c) && c >= 0 && c <= 0xffffff) && /^#[0-9a-f]{6}$/i.test(t.css)), T.TEAMS.map(t => t.short));
check('ids and short names unique', new Set(T.TEAMS.map(t => t.id)).size === 14 && new Set(T.TEAMS.map(t => t.short)).size === 14);
check('11 players per team, unique within the team', T.TEAMS.every(t => t.players.length === 11 && new Set(t.players).size === 11));
const all = T.TEAMS.flatMap(t => t.players);
check('no player name used twice anywhere', new Set(all).size === all.length, all.length - new Set(all).size);
const REAL = ['Mumbai Indians', 'Chennai Super Kings', 'Royal Challengers', 'Kolkata Knight Riders', 'Sunrisers', 'Rajasthan Royals', 'Delhi Capitals', 'Punjab Kings', 'Lucknow Super Giants', 'Gujarat Titans', 'Daredevils', 'Kings XI', 'Deccan Chargers'];
check('no real IPL franchise name in any team name', T.TEAMS.every(t => !REAL.some(r => t.name.toLowerCase().includes(r.toLowerCase()))));
const FAMOUS = ['Virat Kohli', 'Rohit Sharma', 'MS Dhoni', 'Sachin Tendulkar', 'Babar Azam', 'Shaheen Afridi', 'Jasprit Bumrah', 'Steve Smith', 'Joe Root', 'Ben Stokes', 'Kane Williamson', 'Kagiso Rabada', 'Shubman Gill', 'Hardik Pandya', 'Rishabh Pant', 'Pat Cummins', 'Mitchell Starc', 'Quinton de Kock', 'Trent Boult', 'Mohammad Rizwan'];
check('no famous real player names', !all.some(n => FAMOUS.includes(n)));
const idx = id => T.TEAMS.findIndex(t => t.id === id);
check('pickOther never returns the taken team', T.TEAMS.every(t => T.pickOther(t.id, t.id) !== t.id && idx(T.pickOther(t.id, t.id)) >= 0));
check('pickOther keeps a free choice', T.pickOther('pak', 'ind') === 'pak');
check('pickOther steps the way the player is cycling (backwards too), wrapping round', T.pickOther('pak', 'pak', -1) === 'ind' && T.pickOther('ind', 'ind', -1) === T.TEAMS[T.TEAMS.length - 1].id && T.pickOther('pak', 'pak', 1) === 'aus');
const t0 = T.TEAMS[0], L = T.lineup(t0);
check('lineup: batters in order, wrapping', L.batter(0) === t0.players[0] && L.batter(2) === t0.players[2] && L.batter(11) === t0.players[0]);
check('lineup: bowlers are the last five, in rotation', [0, 1, 2, 3, 4, 5].map(L.bowler).join() === [10, 9, 8, 7, 6, 10].map(i => t0.players[i]).join());
check('byId finds a team; an unknown id falls back to the first', T.byId('ind').name === 'India' && T.byId('nope') === T.TEAMS[0]);

{
  // review: distinct teams must also look distinct (kits on the field, the crowd halves, the HUD)
  const rgb = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255], hex = s => rgb(parseInt(s.slice(1), 16));
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const close = [];
  for (let i = 0; i < T.TEAMS.length; i++) for (let j = i + 1; j < T.TEAMS.length; j++) {
    const a = T.TEAMS[i], b = T.TEAMS[j];
    if (d(rgb(a.shirt), rgb(b.shirt)) < 45) close.push(a.short + '/' + b.short + ' shirt');
    if (d(hex(a.css), hex(b.css)) < 45) close.push(a.short + '/' + b.short + ' css');
  }
  check('every pair of teams is told apart by shirt and HUD colour (RGB distance >= 45)', close.length === 0, close);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
