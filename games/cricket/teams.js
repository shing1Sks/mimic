/*
 * Willowlight - teams. Pure data (node games/cricket/test/teams.test.js).
 *
 * National sides and IPL-style city franchises with real players (the user asked for real names,
 * 2026-11-14). Franchise names, logos and kits stay made up: no team's trademarks. Squads are a
 * recent, well-known XI for each side (batting order first, the last five bowl), not a live roster.
 *
 * Each player: "Name:look" with look = skin,beard,hair[,build] and a trailing * for the keeper.
 *   skin 0..4 (fair to dark), beard 0 clean / 1 stubble / 2 full, hair k black / b brown / y fair /
 *   r ginger / g grey, build T tall / s short / h heavy.
 */
(function (root) {
  'use strict';
  const T = (id, name, short, kind, shirt, pants, accent, css, roster) => {
    const ps = roster.split(';').map(x => x.trim()).filter(Boolean).map(parse);
    return { id, name, short, kind, shirt, pants, accent, css, players: ps.map(p => p.name), looks: ps.map(p => p.look), keeper: Math.max(0, ps.findIndex(p => p.keeper)) };
  };
  function parse(s) {
    const keeper = s.endsWith('*'), [name, l] = s.replace(/\*$/, '').split(':');
    const [skin, beard, hair, build] = (l || '2,1,k').split(',');
    return { name: name.trim(), keeper, look: { skin: +skin, beard: +beard, hair: hair || 'k', build: build || '' } };
  }

  const TEAMS = [
    T('ind', 'India', 'IND', 'nation', 0x1f5fd1, 0x0d2a5c, 0xff9933, '#3b82f6',
      'Rohit Sharma:2,2,k,h; Shubman Gill:1,1,k; Virat Kohli:2,2,k; Shreyas Iyer:2,1,k; KL Rahul:2,2,k*; Hardik Pandya:2,1,k,T; Ravindra Jadeja:2,2,k; Axar Patel:2,1,k,T; Kuldeep Yadav:2,1,k,s; Jasprit Bumrah:2,1,k; Mohammed Siraj:3,2,k'),
    T('pak', 'Pakistan', 'PAK', 'nation', 0x0b8a4b, 0x0a3d24, 0xffffff, '#22c55e',
      'Fakhar Zaman:1,2,k,h; Saim Ayub:2,0,k; Babar Azam:2,1,k; Mohammad Rizwan:2,2,k*; Salman Ali Agha:2,1,k; Khushdil Shah:2,2,k,h; Shadab Khan:1,1,k; Abrar Ahmed:2,2,k; Shaheen Shah Afridi:1,1,k,T; Naseem Shah:1,1,k; Haris Rauf:2,1,k,T'),
    T('aus', 'Australia', 'AUS', 'nation', 0xf5c518, 0x0f5132, 0x0f5132, '#facc15',
      'Travis Head:0,1,y; Mitchell Marsh:0,2,b,h; Steve Smith:0,0,b; Glenn Maxwell:0,1,b; Josh Inglis:0,0,b*; Marcus Stoinis:1,2,k,h; Cameron Green:0,0,r,T; Pat Cummins:0,0,k,T; Adam Zampa:0,2,b; Mitchell Starc:0,1,b,T; Josh Hazlewood:0,1,b,T'),
    T('eng', 'England', 'ENG', 'nation', 0x1a2c6b, 0x0f1840, 0xd62839, '#a5b4fc',
      'Phil Salt:0,1,b; Ben Duckett:0,1,b,s; Joe Root:0,0,b; Harry Brook:0,0,b; Jos Buttler:0,1,b*; Liam Livingstone:0,1,b,h; Ben Stokes:0,2,r; Adil Rashid:2,2,k; Jofra Archer:3,1,k,T; Mark Wood:0,1,b; Brydon Carse:0,1,b,T'),
    T('rsa', 'South Africa', 'RSA', 'nation', 0x6abf3a, 0x0a3b22, 0xffb81c, '#84cc16',
      'Quinton de Kock:0,1,b*; Ryan Rickelton:0,1,b; Aiden Markram:0,1,b; Rassie van der Dussen:0,2,b; Heinrich Klaasen:0,2,b,h; David Miller:0,1,y; Marco Jansen:0,0,b,T; Keshav Maharaj:2,1,k; Kagiso Rabada:4,1,k; Anrich Nortje:0,1,b; Lungi Ngidi:4,1,k,T'),
    T('nzl', 'New Zealand', 'NZL', 'nation', 0x111111, 0x1f1f1f, 0xbfbfbf, '#9ca3af',
      'Devon Conway:0,1,b; Rachin Ravindra:2,0,k; Kane Williamson:0,2,b; Daryl Mitchell:0,1,y,T; Tom Latham:0,1,b*; Glenn Phillips:0,1,b; Mitchell Santner:0,1,b; Michael Bracewell:0,2,b; Matt Henry:0,1,b; Trent Boult:0,1,b; Lockie Ferguson:0,2,b'),
    T('mum', 'Mumbai Monsoons', 'MUM', 'franchise', 0x0e8f8f, 0x12304a, 0xd4af37, '#14b8a6',
      'Rohit Sharma:2,2,k,h; Ryan Rickelton:0,1,b*; Will Jacks:0,1,b; Suryakumar Yadav:2,1,k; Tilak Varma:2,0,k; Hardik Pandya:2,1,k,T; Naman Dhir:2,1,k; Mitchell Santner:0,1,b; Deepak Chahar:2,1,k; Trent Boult:0,1,b; Jasprit Bumrah:2,1,k'),
    T('che', 'Chennai Cyclones', 'CHE', 'franchise', 0x5ec8f2, 0x1d3f8f, 0x1d3f8f, '#38bdf8',
      'Ruturaj Gaikwad:2,1,k; Devon Conway:0,1,b; Rachin Ravindra:2,0,k; Shivam Dube:2,1,k,T; MS Dhoni:2,1,k*; Ravindra Jadeja:2,2,k; Sam Curran:0,0,b; Noor Ahmad:2,0,k,s; Khaleel Ahmed:2,1,k,T; Matheesha Pathirana:3,0,k; Anshul Kamboj:2,1,k'),
    T('blr', 'Bengaluru Bolts', 'BLR', 'franchise', 0xc8102e, 0x111111, 0xd4af37, '#ef4444',
      'Phil Salt:0,1,b; Virat Kohli:2,2,k; Rajat Patidar:2,2,k; Liam Livingstone:0,1,b,h; Jitesh Sharma:2,1,k*; Tim David:1,1,k,T; Krunal Pandya:2,2,k; Suyash Sharma:2,0,k; Bhuvneshwar Kumar:2,1,k; Josh Hazlewood:0,1,b,T; Yash Dayal:2,1,k'),
    T('kol', 'Kolkata Thunder', 'KOL', 'franchise', 0x4b2c82, 0x24133f, 0xe0b84a, '#8b5cf6',
      'Rahmanullah Gurbaz:2,1,k*; Sunil Narine:3,1,k; Ajinkya Rahane:2,1,k; Venkatesh Iyer:2,1,k,T; Rinku Singh:2,1,k; Andre Russell:4,2,k,h; Ramandeep Singh:2,1,k; Varun Chakaravarthy:2,1,k; Harshit Rana:2,1,k,T; Vaibhav Arora:2,1,k; Spencer Johnson:0,1,b,T'),
    T('hyd', 'Hyderabad Hawks', 'HYD', 'franchise', 0xf26522, 0x1a1a1a, 0x111111, '#f97316',
      'Travis Head:0,1,y; Abhishek Sharma:2,1,k; Ishan Kishan:2,1,k,s; Heinrich Klaasen:0,2,b,h*; Nitish Kumar Reddy:2,1,k; Aniket Verma:2,0,k; Pat Cummins:0,0,k,T; Harshal Patel:2,2,k; Mohammed Shami:2,2,k; Zeeshan Ansari:2,1,k; Jaydev Unadkat:2,1,k'),
    T('jai', 'Jaipur Jaguars', 'JAI', 'franchise', 0xe5469b, 0x23234f, 0x23234f, '#ec4899',
      'Yashasvi Jaiswal:2,1,k; Sanju Samson:2,1,k*; Nitish Rana:2,1,k; Riyan Parag:2,1,k; Dhruv Jurel:2,1,k; Shimron Hetmyer:4,1,k; Wanindu Hasaranga:3,1,k; Maheesh Theekshana:3,1,k; Jofra Archer:3,1,k,T; Sandeep Sharma:2,1,k; Tushar Deshpande:2,1,k'),
    T('del', 'Delhi Comets', 'DEL', 'franchise', 0xf2f2f2, 0xc8102e, 0xc8102e, '#e2e8f0',
      'Jake Fraser-McGurk:0,0,b; Faf du Plessis:0,2,b; Abishek Porel:2,0,k; KL Rahul:2,2,k*; Tristan Stubbs:0,1,b,T; Ashutosh Sharma:2,1,k; Axar Patel:2,1,k,T; Kuldeep Yadav:2,1,k,s; Mitchell Starc:0,1,b,T; Mukesh Kumar:2,1,k; T Natarajan:3,1,k'),
    T('pun', 'Punjab Panthers', 'PUN', 'franchise', 0x8a8f98, 0x6b1020, 0xd9d9d9, '#be123c',
      'Prabhsimran Singh:2,1,k*; Priyansh Arya:2,1,k; Shreyas Iyer:2,1,k; Josh Inglis:0,0,b; Nehal Wadhera:2,1,k; Shashank Singh:2,1,k; Marcus Stoinis:1,2,k,h; Marco Jansen:0,0,b,T; Yuzvendra Chahal:2,1,k,s; Arshdeep Singh:2,1,k,T; Harpreet Brar:2,2,k'),
  ];

  // signatures: a bowler's run-up (long for the big quicks, a short burst, a few steps for spinners)
  // and how he celebrates a wicket (wings: arms spread; leap: a jump and a turn; sky: pointing up; fist)
  const RUNS = {
    spin: 'Kuldeep Yadav, Ravindra Jadeja, Axar Patel, Shadab Khan, Abrar Ahmed, Adam Zampa, Adil Rashid, Keshav Maharaj, Mitchell Santner, Michael Bracewell, Noor Ahmad, Krunal Pandya, Suyash Sharma, Sunil Narine, Varun Chakaravarthy, Wanindu Hasaranga, Maheesh Theekshana, Yuzvendra Chahal, Harpreet Brar, Zeeshan Ansari',
    long: 'Mitchell Starc, Shaheen Shah Afridi, Haris Rauf, Pat Cummins, Josh Hazlewood, Mark Wood, Kagiso Rabada, Anrich Nortje, Lungi Ngidi, Lockie Ferguson, Matt Henry, Trent Boult, Marco Jansen, Naseem Shah, Mohammed Shami, Spencer Johnson, Harshit Rana, Khaleel Ahmed, Brydon Carse, Mohammed Siraj',
    short: 'Jasprit Bumrah, Matheesha Pathirana, Jofra Archer, Bhuvneshwar Kumar, Deepak Chahar',
  };
  const CELS = { wings: 'Shaheen Shah Afridi', leap: 'Mohammed Siraj, Wanindu Hasaranga', sky: 'Mitchell Starc, Keshav Maharaj', fist: 'Kagiso Rabada, Jasprit Bumrah, Pat Cummins, Haris Rauf, Lockie Ferguson' };
  const inList = (tbl, name) => Object.keys(tbl).find(k => tbl[k].split(', ').includes(name));
  /** A player's signature: { run: 'long'|'short'|'spin'|'mid', cel: 'wings'|'leap'|'sky'|'fist'|'cheer' }. */
  const sig = name => ({ run: inList(RUNS, name) || 'mid', cel: inList(CELS, name) || 'cheer' });

  const byId = id => TEAMS.find(t => t.id === id) || TEAMS[0];
  /** The team a seat gets when it wants `id` but the other seat has `taken`: the next one round, in the direction dir (+1/-1). */
  function pickOther(id, taken, dir) {
    if (id !== taken) return id;
    const i = TEAMS.findIndex(t => t.id === id), n = TEAMS.length;
    return TEAMS[(i + (dir < 0 ? -1 : 1) + n) % n].id;
  }
  /** Names for a team's innings: batter(n) by batting order (n = wickets down), bowler(over) from the last five. */
  function lineup(team) {
    const p = team.players, w = n => ((n % 11) + 11) % 11, b = over => 10 - (((over % 5) + 5) % 5);
    return {
      batter: n => p[w(n)], bowler: over => p[b(over)],
      batterIdx: w, bowlerIdx: b,
      /** The ten in the field while `bowlerIdx` bowls: the keeper first, then the rest in order. */
      fielders: bowlerIdx => [team.keeper].concat(p.map((_, i) => i).filter(i => i !== team.keeper && i !== bowlerIdx)).slice(0, 10),
    };
  }

  const api = { TEAMS, byId, pickOther, lineup, sig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Teams = api; }
})(typeof window !== 'undefined' ? window : null);
