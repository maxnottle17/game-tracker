// Made-up data for trying the UI without real accounts (run with DEMO=1). Nothing is saved.
module.exports = function demo() {
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const g = (id, name, hours, u, t, last) => ({ id, name, minutes: hours === null ? null : Math.round(hours * 60), achUnlocked: u, achTotal: t, lastPlayed: last === null ? null : day(last), image: null });
  // Repeatable pseudo-random numbers, so the sample charts look the same every run.
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const dated = (store) => {
    for (const [platform, list] of Object.entries(store.games)) {
      for (const game of list) {
        if (platform === 'epic' || platform === 'nintendo' || game.lastPlayed === null) continue;
        const end = Date.parse(game.lastPlayed);
        const start = end - (200 + rnd() * 2600) * 864e5;
        if (platform === 'psn') game.firstPlayed = new Date(start).toISOString();
        else {
          // Unlocks bunch up near the start of a game's life, at evening hours.
          game.events = Array.from({ length: game.achUnlocked || 0 }, () => {
            const t = new Date(start + (end - start) * Math.pow(rnd(), 2.2));
            t.setHours(15 + Math.floor(rnd() * 9), Math.floor(rnd() * 60));
            return Math.round(t.getTime() / 1000);
          });
        }
      }
    }
    for (let i = 0; i < 30; i++) {
      if (rnd() < 0.3) continue;
      const log = {};
      log['steam:1'] = Math.round(20 + rnd() * 150);
      if (rnd() < 0.5) log['xbox:12'] = Math.round(15 + rnd() * 90);
      if (rnd() < 0.25) log['psn:21'] = Math.round(30 + rnd() * 120);
      store.history[new Date(Date.now() - i * 864e5).toLocaleDateString('sv')] = log;
    }
    return store;
  };
  return dated({
    history: {},
    trackingSince: day(30),
    accounts: {
      steam: { name: 'DemoPlayer', created: day(3400) }, xbox: { name: 'DemoTag' }, psn: { name: 'demo_psn' }, epic: { name: 'DemoEpic' },
      nintendo: { name: 'DemoNin', created: day(2900) },
    },
    games: {
      steam: [
        g('1', 'Orbital Drift', 412.5, 48, 60, 1), g('2', 'Hollow Harbor', 188.2, 31, 31, 12),
        g('3', 'Tiny Kingdoms', 96.4, 12, 80, 40), g('4', 'Circuit Breakers', 51, 0, 0, 3),
        g('5', 'Paper Planes', 0.6, 1, 22, 300),
      ],
      xbox: [
        g('11', 'Orbital Drift', 77.3, 20, 60, 5), g('12', 'Night Shift Racing', 240.1, 55, 71, 2),
        g('13', 'Legacy Quest 360', null, 14, null, 900),
        { ...g('14', 'Cubeworld for Windows', 150.5, 30, 120, 4), device: 'PC' },
        { ...g('15', 'Cubeworld', 61.2, 12, 120, 30), device: 'iOS' },
        { ...g('16', 'Cubeworld Dungeons', 20, 5, 50, 90), device: 'XboxOne' },
      ],
      psn: [
        g('21', 'Lantern & Ash', 133.7, 37, 52, 8), g('22', 'Night Shift Racing™', 18.9, 6, 71, 60),
        g('23', 'Skyline Courier', 64, 22, 40, 20),
      ],
      epic: [
        g('31', 'Tiny Kingdoms', 22.5, 4, 80, null), g('32', 'Brickfall', 9.2, null, null, null),
        g('33', 'Cubeworld: Java Edition', 88, null, null, null),
      ],
      nintendo: [
        { ...g('41', 'Kart Carnival', 210.4, null, null, 6), firstPlayed: day(2800), device: 'HAC' },
        { ...g('42', 'Island Neighbours', 356, null, null, 45), firstPlayed: day(2400), device: 'HAC' },
        { ...g('43', 'Cubeworld', 47.5, null, null, 200), firstPlayed: day(1900), device: 'HAC' },
      ],
    },
    sync: {
      steam: { at: day(0.01), ok: true, notes: [] },
      xbox: { at: day(0.01), ok: true, notes: ["1 game(s) have no play time on Xbox's records (usually Xbox 360 games)."] },
      psn: { at: day(0.01), ok: true, notes: [] },
      epic: { at: day(0.01), ok: true, notes: ['Achievements could not be read for 1 game(s).'] },
      nintendo: { at: day(0.01), ok: true, notes: [] },
    },
    cache: {},
  });
};
