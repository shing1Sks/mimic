/*
 * Willowlight - teams. Pure data (node games/cricket/test/teams.test.js).
 *
 * National sides and IPL-style city franchises. Every franchise name and every player is made up
 * for Willowlight: no real franchise, player or logo (the game is public). Kit colours are plain
 * colours, not anyone's marks.
 */
(function (root) {
  'use strict';
  const T = (id, name, short, kind, shirt, pants, accent, css, players) => ({ id, name, short, kind, shirt, pants, accent, css, players: players.split(', ') });

  const TEAMS = [
    T('ind', 'India', 'IND', 'nation', 0x1f5fd1, 0x0d2a5c, 0xff9933, '#3b82f6',
      'Aarav Malhotra, Kabir Deshmukh, Vihaan Rathore, Ishaan Kulkarni, Arjun Saxena, Dhruv Bhatia, Rudra Chauhan, Tanmay Joshi, Pranav Nair, Harjot Sandhu, Neel Trivedi'),
    T('pak', 'Pakistan', 'PAK', 'nation', 0x0b8a4b, 0x0a3d24, 0xffffff, '#22c55e',
      'Saad Qureshi, Hamza Siddiqui, Faizan Mirza, Danish Abbasi, Zain Chaudhry, Bilal Awan, Taimur Niazi, Raheel Lodhi, Arsalan Bhatti, Shahzaib Gondal, Owais Paracha'),
    T('aus', 'Australia', 'AUS', 'nation', 0xf5c518, 0x0f5132, 0x0f5132, '#facc15',
      'Liam Whitfield, Lachlan Harland, Cooper McKenzie, Riley Carver, Archie Doyle, Toby Prescott, Harrison Lyle, Flynn Bramwell, Brodie Ashby, Jack Kerridge, Hamish Thorley'),
    T('eng', 'England', 'ENG', 'nation', 0x1a2c6b, 0x0f1840, 0xd62839, '#4f6bd8',
      'Oliver Pembroke, George Ashcroft, Alfie Whitmore, Theo Fairley, Edward Hollins, Rory Danvers, Henry Kingsley, Barnaby Marlow, Jasper Thorne, Hugo Brampton, Felix Ridley'),
    T('rsa', 'South Africa', 'RSA', 'nation', 0x0c7a43, 0x0a3b22, 0xffb81c, '#16a34a',
      'Thabo Nkosi, Sipho Dlamini, Ruan van der Berg, Pieter Joubert, Lwazi Mahlangu, Wian Venter, Bongani Ndlovu, Tiaan Fourie, Sizwe Mokoena, Hendrik Visagie, Neo Khumalo'),
    T('nzl', 'New Zealand', 'NZL', 'nation', 0x111111, 0x1f1f1f, 0xbfbfbf, '#9ca3af',
      'Tama Ngata, Nico Whitcombe, Blake Ellison, Wiremu Parata, Mason McLeod, Jett Henare, Kauri Rowe, Ari Pohatu, Rawiri Tane, Callum Lindqvist, Quinn Te Rangi'),
    T('mum', 'Mumbai Monsoons', 'MUM', 'franchise', 0x0e8f8f, 0x12304a, 0xd4af37, '#14b8a6',
      'Advait Kamath, Siddharth Hegde, Om Pawar, Yash Shetty, Kunal Ahuja, Rohan Menon, Aditya Rao, Manav Sethi, Samar Iyengar, Declan Rourke, Jarrod Fenwick'),
    T('che', 'Chennai Cyclones', 'CHE', 'franchise', 0xf2c200, 0x1d3f8f, 0x1d3f8f, '#fbbf24',
      'Vivaan Pillai, Karthik Raghavan, Nakul Srinivasan, Tejas Ramanathan, Arvind Sundaram, Bharath Kannan, Mithun Rangan, Pradeep Elango, Surya Balaji, Tobias Grant, Marlon Pierce'),
    T('blr', 'Bengaluru Bolts', 'BLR', 'franchise', 0xc8102e, 0x111111, 0xd4af37, '#ef4444',
      'Chirag Gowda, Nikhil Shenoy, Varun Bhat, Akash Urs, Pavan Kini, Sameer Hosmani, Vinay Rai, Darshan Kote, Keerthan Alva, Brett Lawson, Zane Mitchell'),
    T('kol', 'Kolkata Thunder', 'KOL', 'franchise', 0x4b2c82, 0x24133f, 0xe0b84a, '#8b5cf6',
      'Arnab Banerjee, Souvik Ghosh, Rishi Mukherjee, Debjit Sen, Anirban Dutta, Subho Chatterjee, Tathagata Roy, Indranil Basu, Pritam Mitra, Kieran Walsh, Nathan Okafor'),
    T('hyd', 'Hyderabad Hawks', 'HYD', 'franchise', 0xf26522, 0x1a1a1a, 0x111111, '#f97316',
      'Saketh Reddy, Vamsi Naidu, Abhiram Varma, Rithvik Goud, Harsha Kondapalli, Charan Teja, Mohit Raju, Bhargav Chowdary, Anvesh Tummala, Rafael Cortez, Jason Pike'),
    T('jai', 'Jaipur Jaguars', 'JAI', 'franchise', 0xe5469b, 0x23234f, 0x23234f, '#ec4899',
      'Rajveer Shekhawat, Bhavesh Chouhan, Lakshya Meena, Ajeet Bhati, Hemant Solanki, Pratap Jodha, Yuvan Garg, Kartikeya Mathur, Nirav Dadhich, Lewis Garrow, Andre Baptiste'),
    T('del', 'Delhi Comets', 'DEL', 'franchise', 0x1e4fbf, 0xc8102e, 0xc8102e, '#2563eb',
      'Ayaan Khanna, Shaurya Kapoor, Vedant Mehra, Ritvik Arora, Kabir Bakshi, Jai Tandon, Uday Sehgal, Moksh Bhasin, Priyansh Grover, Ethan Cole, Mikael Forsberg'),
    T('pun', 'Punjab Panthers', 'PUN', 'franchise', 0xb3122b, 0x8a8f98, 0xd9d9d9, '#dc2626',
      'Gurpreet Dhillon, Harman Grewal, Jaskaran Bajwa, Amrit Brar, Ekam Sekhon, Prabhjot Virk, Sukhman Randhawa, Taranveer Cheema, Inderjit Bains, Callum Briggs, Marcus Lindo'),
  ];

  const byId = id => TEAMS.find(t => t.id === id) || TEAMS[0];
  /** The team a seat gets when it wants `id` but the other seat has `taken`: the next one round. */
  function pickOther(id, taken) {
    if (id !== taken) return id;
    const i = TEAMS.findIndex(t => t.id === id);
    return TEAMS[(i + 1) % TEAMS.length].id;
  }
  /** Names for a team's innings: batter(n) by batting order (n = wickets down), bowler(over) from the last five. */
  function lineup(team) {
    const p = team.players;
    return { batter: n => p[((n % 11) + 11) % 11], bowler: over => p[10 - (((over % 5) + 5) % 5)] };
  }

  const api = { TEAMS, byId, pickOther, lineup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Teams = api; }
})(typeof window !== 'undefined' ? window : null);
