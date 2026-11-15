'use strict';
// Stats tab. Uses the helpers defined in app.js (h, $, fmtInt, fmtHours, PLATFORMS, cleanName, normName).
//
// What is exact and what is estimated:
//  - Totals, achievements, unlock dates and first/last played dates come straight from the platforms.
//  - No platform says WHEN the hours were played. The timeline therefore spreads each game's total
//    across the months between its first and last dated activity: half evenly, half following its
//    dated activity (achievement unlocks, first and last played). Games with no start date are left out.
//  - The "recorded" chart is exact, but only exists from the day the app started tracking.

const statsView = { mode: 'year', sig: '' };
const PLATFORM_ORDER = ['steam', 'xbox', 'psn', 'epic'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EARLIEST = Date.UTC(2000, 0, 1);

const monthIndex = (t) => { const d = new Date(t); return d.getFullYear() * 12 + d.getMonth(); };
const monthLabel = (m) => `${MONTHS[m % 12]} ${Math.floor(m / 12)}`;
const dateLabel = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const approxHours = (mins) => `≈ ${fmtInt(mins / 60)} h`;
const validDate = (t) => Number.isFinite(t) && t > EARLIEST && t <= Date.now() + 864e5;

function ageText(from) {
  const a = new Date(from); const b = new Date();
  let months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0);
  months = Math.max(0, months);
  const y = Math.floor(months / 12); const m = months % 12;
  if (!y) return `${m} month${m === 1 ? '' : 's'}`;
  return `${y} yr${y === 1 ? '' : 's'}${m ? ` ${m} mo` : ''}`;
}

function gameDates(g) {
  const events = (g.events || []).map((s) => s * 1000).filter(validDate);
  const first = g.firstPlayed ? Date.parse(g.firstPlayed) : NaN;
  const last = g.lastPlayed ? Date.parse(g.lastPlayed) : NaN;
  const points = [...events];
  if (validDate(first)) points.push(first);
  if (validDate(last)) points.push(last);
  return { events, points, hasStart: events.length > 0 || validDate(first) };
}

function buildModel() {
  const months = new Map(); // monthIndex -> { total, plat: {}, games: Map }
  const spans = new Map();  // game name -> { name, minutes, start, end, platform, top }
  let undated = 0; let placed = 0;
  const bucket = (map, key) => {
    let b = map.get(key);
    if (!b) { b = { total: 0, plat: {}, games: new Map() }; map.set(key, b); }
    return b;
  };
  const add = (b, g, mins) => {
    b.total += mins;
    b.plat[g.platform] = (b.plat[g.platform] || 0) + mins;
    const k = normName(g.name);
    const e = b.games.get(k) || { name: cleanName(g.name), minutes: 0, platform: g.platform };
    e.minutes += mins;
    b.games.set(k, e);
  };

  for (const g of state.games) {
    if (!g.minutes) continue;
    const d = gameDates(g);
    if (!d.hasStart) { undated += g.minutes; continue; }
    placed += g.minutes;
    let start = d.points[0]; let end = d.points[0];
    for (const p of d.points) { if (p < start) start = p; if (p > end) end = p; }
    const a = monthIndex(start); const z = monthIndex(end); const n = z - a + 1;
    for (let m = a; m <= z; m++) add(bucket(months, m), g, (g.minutes * 0.5) / n);
    for (const p of d.points) add(bucket(months, monthIndex(p)), g, (g.minutes * 0.5) / d.points.length);

    const k = normName(g.name);
    const s = spans.get(k) || { name: cleanName(g.name), minutes: 0, start, end, platform: g.platform, top: 0 };
    s.minutes += g.minutes; s.start = Math.min(s.start, start); s.end = Math.max(s.end, end);
    if (g.minutes > s.top) { s.top = g.minutes; s.platform = g.platform; }
    spans.set(k, s);
  }

  const years = new Map();
  for (const [m, b] of months) {
    const y = bucket(years, Math.floor(m / 12));
    y.total += b.total;
    for (const [p, v] of Object.entries(b.plat)) y.plat[p] = (y.plat[p] || 0) + v;
    for (const [k, e] of b.games) {
      const t = y.games.get(k) || { name: e.name, minutes: 0, platform: e.platform };
      t.minutes += e.minutes;
      y.games.set(k, t);
    }
  }
  const peak = (map) => [...map].sort((a, b) => b[1].total - a[1].total)[0] || null;

  // Exact unlock timestamps (Steam and Xbox).
  const achYears = new Map(); const weekday = new Array(7).fill(0); const hour = new Array(24).fill(0);
  let dayCount = new Map();
  for (const g of state.games) {
    for (const s of g.events || []) {
      const t = s * 1000;
      if (!validDate(t)) continue;
      const d = new Date(t);
      const y = achYears.get(d.getFullYear()) || {};
      y[g.platform] = (y[g.platform] || 0) + 1;
      achYears.set(d.getFullYear(), y);
      weekday[(d.getDay() + 6) % 7]++;
      hour[d.getHours()]++;
      const key = d.toLocaleDateString('sv');
      dayCount.set(key, (dayCount.get(key) || 0) + 1);
    }
  }
  const bestDay = [...dayCount].sort((a, b) => b[1] - a[1])[0] || null;

  return { months, years, spans: [...spans.values()], undated, placed, peakYear: peak(years), peakMonth: peak(months), achYears, weekday, hour, bestDay };
}

// ---------- chart pieces ----------

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function showTip(e, node) {
  const tip = $('tip');
  tip.replaceChildren(node);
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const x = Math.min(window.innerWidth - r.width - 8, e.clientX + 14);
  const y = e.clientY + 16 + r.height > window.innerHeight ? e.clientY - r.height - 12 : e.clientY + 16;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => { $('tip').hidden = true; };

const swatch = (p) => h('i', { class: `sw ${p}` });
const tipRow = (left, right) => h('div', { class: 'r' }, h('span', {}, left), h('span', {}, right));

// cols: [{ label, segs: [{ cls, value }], tip: () => Node }]. Values share one axis.
function barChart(cols, { height = 220, unit = '' } = {}) {
  const max = niceMax(Math.max(0, ...cols.map((c) => c.segs.reduce((n, s) => n + s.value, 0))));
  const thin = cols.length > 40;
  const yaxis = h('div', { class: 'yaxis' });
  const plot = h('div', { class: 'plot' });
  yaxis.style.height = plot.style.height = `${height}px`;
  for (const f of [0.25, 0.5, 0.75, 1]) {
    const line = h('div', { class: 'grid' }); line.style.bottom = `${f * 100}%`; plot.append(line);
    const lab = h('span', {}, `${fmtInt(max * f)}${unit}`); lab.style.bottom = `${f * 100}%`; yaxis.append(lab);
  }
  const holder = h('div', { class: 'cols' });
  for (const c of cols) {
    const col = h('div', { class: `col${thin ? ' thin' : ''}` });
    for (const s of c.segs) {
      if (!(s.value > 0)) continue;
      const seg = h('i', { class: s.cls });
      seg.style.height = `${(s.value / max) * 100}%`;
      col.append(seg);
    }
    if (c.tip) {
      col.addEventListener('mousemove', (e) => showTip(e, c.tip()));
      col.addEventListener('mouseleave', hideTip);
    }
    holder.append(col);
  }
  plot.append(holder);
  return h('div', { class: 'chart' }, yaxis, plot, h('div', { class: 'xaxis' }, cols.map((c) => h('span', {}, c.label || ''))));
}

const legend = (platforms) => h('div', { class: 'legend' }, platforms.map((p) => h('span', {}, swatch(p), PLATFORMS[p].label)));

function periodTip(title, b) {
  const top = [...b.games.values()].sort((x, y) => y.minutes - x.minutes).slice(0, 6);
  return h('div', {},
    h('div', { class: 't' }, `${title} · ${approxHours(b.total)}`),
    PLATFORM_ORDER.filter((p) => b.plat[p] > 0).map((p) => tipRow([swatch(p), PLATFORMS[p].label], approxHours(b.plat[p]))),
    h('div', { class: 'sep' }),
    top.map((g) => tipRow([swatch(g.platform), g.name], fmtHours(g.minutes))));
}

// ---------- sections ----------

function accountCards(model) {
  return h('div', { class: 'acct-grid' }, PLATFORM_ORDER.filter((p) => state.accounts[p].linked).map((p) => {
    const acc = state.accounts[p];
    const games = state.games.filter((g) => g.platform === p);
    const mins = games.reduce((n, g) => n + (g.minutes || 0), 0);
    const ach = games.reduce((n, g) => n + (g.achUnlocked || 0), 0);
    let earliest = null; let firstGame = null;
    for (const g of games) {
      for (const t of gameDates(g).points) if (earliest === null || t < earliest) { earliest = t; firstGame = g; }
    }
    const created = acc.created ? Date.parse(acc.created) : null;
    const from = created || earliest;
    const yearsOld = from ? Math.max((Date.now() - from) / (365.25 * 864e5), 1 / 12) : null;
    const top = [...games].sort((a, b) => (b.minutes || 0) - (a.minutes || 0))[0];
    const peak = [...model.years].filter(([, b]) => b.plat[p] > 0).sort((a, b) => b[1].plat[p] - a[1].plat[p])[0];
    const recent = games.reduce((n, g) => n + (g.recentMinutes || 0), 0);
    const row = (k, v) => [h('dt', {}, k), h('dd', { title: String(v) }, v)];
    return h('div', { class: 'acct' },
      h('h3', {}, swatch(p), PLATFORMS[p].label),
      h('div', { class: 'who' }, acc.name || ''),
      h('div', { class: 'age' }, from ? ageText(from) : 'Unknown'),
      h('div', { class: 'since' }, created ? `Account created ${dateLabel(created)}`
        : earliest ? `At least this old: earliest activity on record is ${dateLabel(earliest)}. ${PLATFORMS[p].label} does not share the creation date.`
          : `${PLATFORMS[p].label} shares no dates, so the age cannot be worked out.`),
      h('dl', { class: 'kv' },
        row('Hours played', mins ? `${fmtInt(mins / 60)} h` : '–'),
        row('Games played', fmtInt(games.length)),
        row('Achievements', fmtInt(ach)),
        row('Average per year', yearsOld && mins ? `${fmtInt(mins / 60 / yearsOld)} h` : '–'),
        row('Most played', top && top.minutes ? cleanName(top.name) : '–'),
        row('Earliest game', firstGame ? cleanName(firstGame.name) : '–'),
        row('Biggest year', peak ? `${peak[0]} (${approxHours(peak[1].plat[p])})` : '–'),
        p === 'steam' ? row('Last 2 weeks', fmtHours(recent)) : []));
  }));
}

function headlineTiles(model) {
  const tile = (label, value, sub) => h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value', title: value }, value), h('div', { class: 'sub', title: sub || '' }, sub || ' '));
  const topOf = (b) => [...b.games.values()].sort((x, y) => y.minutes - x.minutes)[0];
  const longest = [...model.spans].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  const withAch = state.games.filter((g) => g.achTotal > 0 && g.achUnlocked !== null);
  const perfect = withAch.filter((g) => g.achUnlocked >= g.achTotal).length;
  const avg = withAch.length ? withAch.reduce((n, g) => n + Math.min(1, g.achUnlocked / g.achTotal), 0) / withAch.length : null;
  const dayTotal = model.weekday.reduce((a, b) => a + b, 0);
  const bestWd = model.weekday.indexOf(Math.max(...model.weekday));
  const bestHr = model.hour.indexOf(Math.max(...model.hour));
  const hr12 = (x) => `${x % 12 || 12}${x < 12 ? 'am' : 'pm'}`;
  const total = state.games.reduce((n, g) => n + (g.minutes || 0), 0);
  const top10 = [...state.games].sort((a, b) => (b.minutes || 0) - (a.minutes || 0)).slice(0, 10).reduce((n, g) => n + (g.minutes || 0), 0);
  return h('div', { class: 'tiles' },
    model.peakYear ? tile('Biggest year', String(model.peakYear[0]), `${approxHours(model.peakYear[1].total)} · mostly ${topOf(model.peakYear[1]).name}`) : null,
    model.peakMonth ? tile('Biggest month', monthLabel(model.peakMonth[0]), `${approxHours(model.peakMonth[1].total)} · mostly ${topOf(model.peakMonth[1]).name}`) : null,
    longest ? tile('Longest-running game', longest.name, `${spanText(longest)} from first to last play`) : null,
    dayTotal ? tile('Most active day', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][bestWd], `${Math.round((model.weekday[bestWd] / dayTotal) * 100)}% of achievement unlocks`) : null,
    dayTotal ? tile('Peak hour', `${hr12(bestHr)}–${hr12((bestHr + 1) % 24)}`, 'when most achievements unlock') : null,
    model.bestDay ? tile('Best single day', dateLabel(Date.parse(`${model.bestDay[0]}T12:00:00`)), `${model.bestDay[1]} achievements unlocked`) : null,
    tile('100% completed', fmtInt(perfect), `of ${fmtInt(withAch.length)} games with achievements`),
    avg !== null ? tile('Average completion', `${Math.round(avg * 100)}%`, 'across games with achievements') : null,
    tile('100-hour club', fmtInt(state.games.filter((g) => g.minutes >= 6000).length), `and ${fmtInt(state.games.filter((g) => g.minutes !== null && g.minutes < 60).length)} played under an hour`),
    total ? tile('Top 10 games', `${Math.round((top10 / total) * 100)}%`, 'of all your play time') : null);
}

function spanText(s) {
  const months = Math.max(1, Math.round((s.end - s.start) / (30.44 * 864e5)));
  const y = Math.floor(months / 12); const m = months % 12;
  return y ? `${y} yr${y === 1 ? '' : 's'}${m ? ` ${m} mo` : ''}` : `${m} month${m === 1 ? '' : 's'}`;
}

function timeline(model) {
  const used = PLATFORM_ORDER.filter((p) => [...model.years.values()].some((b) => b.plat[p] > 0));
  let cols = [];
  if (statsView.mode === 'year') {
    const ys = [...model.years.keys()];
    const lo = Math.min(...ys); const hi = new Date().getFullYear();
    for (let y = lo; y <= hi; y++) {
      const b = model.years.get(y) || { total: 0, plat: {}, games: new Map() };
      cols.push({ label: hi - lo > 16 && (y - lo) % 2 ? '' : String(y), segs: used.map((p) => ({ cls: p, value: (b.plat[p] || 0) / 60 })), tip: () => periodTip(String(y), b) });
    }
  } else {
    const ms = [...model.months.keys()];
    const lo = Math.min(...ms); const hi = monthIndex(Date.now());
    const everyOtherYear = hi - lo > 150;
    for (let m = lo; m <= hi; m++) {
      const b = model.months.get(m) || { total: 0, plat: {}, games: new Map() };
      const yr = Math.floor(m / 12);
      cols.push({ label: m % 12 === 0 && !(everyOtherYear && yr % 2) ? String(yr) : '', segs: used.map((p) => ({ cls: p, value: (b.plat[p] || 0) / 60 })), tip: () => periodTip(monthLabel(m), b) });
    }
  }
  const toggle = h('div', { class: 'seg' }, ['year', 'month'].map((mode) => h('button', {
    class: statsView.mode === mode ? 'on' : '', onclick: () => { statsView.mode = mode; statsView.sig = ''; renderStats(); },
  }, mode === 'year' ? 'By year' : 'By month')));
  return h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, legend(used), toggle), barChart(cols, { height: 240, unit: ' h' }));
}

function yearCards(model) {
  return h('div', { class: 'years' }, [...model.years].sort((a, b) => b[0] - a[0]).map(([y, b]) => {
    const top = [...b.games.values()].sort((x, z) => z.minutes - x.minutes).slice(0, 5);
    return h('div', { class: 'year' },
      h('h3', {}, h('span', {}, String(y), model.peakYear && model.peakYear[0] === y ? h('small', {}, '  biggest year') : null), h('small', {}, approxHours(b.total))),
      top.map((g) => h('div', { class: 'g' }, swatch(g.platform), h('span', { title: g.name }, g.name), h('span', {}, fmtHours(g.minutes)))));
  }));
}

function lifespans(model) {
  const top = [...model.spans].sort((a, b) => b.minutes - a.minutes).slice(0, 15);
  if (!top.length) return null;
  const lo = Math.min(...top.map((s) => s.start)); const hi = Date.now(); const range = Math.max(1, hi - lo);
  const y0 = new Date(lo).getFullYear(); const y1 = new Date(hi).getFullYear();
  const ticks = y1 === y0 ? [y0] : [y0, Math.round((y0 + y1) / 2), y1].filter((v, i, a) => a.indexOf(v) === i);
  return h('div', { class: 'panel' }, h('div', { class: 'spans' },
    top.map((s) => {
      const bar = h('i', { class: `sw ${s.platform}` });
      bar.style.left = `${((s.start - lo) / range) * 100}%`;
      bar.style.width = `${Math.max(0.6, ((s.end - s.start) / range) * 100)}%`;
      const track = h('div', { class: 'track' }, bar);
      track.addEventListener('mousemove', (e) => showTip(e, h('div', {}, h('div', { class: 't' }, s.name),
        tipRow('First activity', dateLabel(s.start)), tipRow('Last played', dateLabel(s.end)), tipRow('Span', spanText(s)), tipRow('Total', fmtHours(s.minutes)))));
      track.addEventListener('mouseleave', hideTip);
      return [h('div', { class: 'n', title: s.name }, s.name), track, h('div', { class: 'hrs' }, fmtHours(s.minutes))];
    }),
    h('div', { class: 'axis' }, ticks.map((t) => h('span', {}, String(t))))));
}

function achievementCharts(model) {
  const ys = [...model.achYears.keys()];
  if (!ys.length) return h('p', { class: 'cap' }, 'No dated achievements yet. They appear after the next Steam or Xbox sync.');
  const used = PLATFORM_ORDER.filter((p) => [...model.achYears.values()].some((v) => v[p] > 0));
  const yearCols = [];
  for (let y = Math.min(...ys); y <= new Date().getFullYear(); y++) {
    const v = model.achYears.get(y) || {};
    const total = used.reduce((n, p) => n + (v[p] || 0), 0);
    yearCols.push({ label: String(y).slice(yearCols.length && ys.length > 9 ? 2 : 0), segs: used.map((p) => ({ cls: p, value: v[p] || 0 })),
      tip: () => h('div', {}, h('div', { class: 't' }, `${y} · ${fmtInt(total)} achievements`), used.filter((p) => v[p] > 0).map((p) => tipRow([swatch(p), PLATFORMS[p].label], fmtInt(v[p])))) });
  }
  const simple = (values, labels, names) => barChart(values.map((v, i) => ({ label: labels[i], segs: [{ cls: 'one', value: v }],
    tip: () => h('div', {}, h('div', { class: 't' }, names[i]), tipRow('Achievements', fmtInt(v))) })), { height: 150 });
  const hourNames = model.hour.map((_, i) => `${i % 12 || 12}${i < 12 ? 'am' : 'pm'}–${(i + 1) % 12 || 12}${(i + 1) % 24 < 12 ? 'am' : 'pm'}`);
  return h('div', { class: 'trio' },
    h('div', { class: 'panel' }, h('h3', {}, 'Per year'), barChart(yearCols, { height: 150 }), h('div', { class: 'panel-head' }, legend(used))),
    h('div', { class: 'panel' }, h('h3', {}, 'By day of the week'), simple(model.weekday, DAYS, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])),
    h('div', { class: 'panel' }, h('h3', {}, 'By time of day'), simple(model.hour, model.hour.map((_, i) => (i % 6 === 0 ? `${i % 12 || 12}${i < 12 ? 'am' : 'pm'}` : '')), hourNames)));
}

function recordedChart() {
  const names = new Map(state.games.map((g) => [`${g.platform}:${g.id}`, cleanName(g.name)]));
  const cols = []; let any = false;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const log = state.history[d.toLocaleDateString('sv')] || {};
    const plat = {}; const games = [];
    for (const [key, mins] of Object.entries(log)) {
      const p = key.split(':')[0];
      plat[p] = (plat[p] || 0) + mins;
      games.push({ p, name: names.get(key) || 'Unknown game', mins });
      any = true;
    }
    const total = Object.values(plat).reduce((a, b) => a + b, 0);
    cols.push({ label: i % 5 === 0 ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : '', segs: PLATFORM_ORDER.map((p) => ({ cls: p, value: (plat[p] || 0) / 60 })),
      tip: () => h('div', {}, h('div', { class: 't' }, `${dateLabel(d)} · ${fmtHours(total)}`),
        games.sort((a, b) => b.mins - a.mins).slice(0, 8).map((g) => tipRow([swatch(g.p), g.name], fmtHours(g.mins)))) });
  }
  const since = state.trackingSince ? `Tracking since ${dateLabel(Date.parse(state.trackingSince))}.` : 'Tracking starts with the next sync.';
  return [
    h('p', { class: 'cap' }, `Exact, not estimated: the app logs how much each game's total grows between syncs. ${since} Play is logged on the day the app syncs, so keep it running (or open it daily) for accurate days.`),
    any ? h('div', { class: 'panel' }, barChart(cols, { height: 160, unit: ' h' })) : h('div', { class: 'panel' }, h('p', { class: 'empty' }, 'Nothing recorded yet. Play something, then come back after the next sync.')),
  ];
}

function renderStats() {
  const root = $('view-stats');
  if (!root || !state) return;
  root.classList.add('stats');
  const sig = [statsView.mode, state.games.length, Object.keys(state.history || {}).length,
    ...Object.values(state.accounts).map((a) => `${a.linked}${a.sync ? a.sync.at : ''}`)].join('|');
  if (sig === statsView.sig) return; // unchanged: keep the charts (and any open tooltip) as they are
  statsView.sig = sig;
  hideTip();

  if (!state.games.length) {
    root.replaceChildren(h('p', { class: 'empty' }, 'Link an account and sync to see your stats.'));
    return;
  }
  const model = buildModel();
  const share = model.placed + model.undated ? Math.round((model.placed / (model.placed + model.undated)) * 100) : 0;
  root.replaceChildren(
    h('h2', {}, 'Your accounts'),
    h('p', { class: 'cap' }, 'How long each account has existed and what it adds up to.'),
    accountCards(model),

    h('h2', {}, 'Highlights'),
    h('p', { class: 'cap' }, 'Day and hour figures come from exact achievement unlock times (Steam and Xbox).'),
    headlineTiles(model),

    h('h2', {}, 'When you played the most'),
    h('p', { class: 'cap' }, `An estimate. No platform records when hours were played, so each game's total is spread between its first and last dated activity, weighted towards when its achievements were unlocked. ${share}% of your hours could be placed this way; the other ${fmtInt(model.undated / 60)} h belong to games with no start date (mostly Epic, and games without achievements). Hover a bar to see what you were playing.`),
    model.years.size ? timeline(model) : h('div', { class: 'panel' }, h('p', { class: 'empty' }, 'No dated activity yet. Run a sync to collect it.')),

    h('h2', {}, 'What you were playing, year by year'),
    h('p', { class: 'cap' }, 'Top five games for each year, from the same estimate.'),
    yearCards(model),

    h('h2', {}, 'How long each game lasted'),
    h('p', { class: 'cap' }, 'Your 15 most played dated games, from first activity on record to the last time played.'),
    lifespans(model),

    h('h2', {}, 'Achievements over time'),
    h('p', { class: 'cap' }, 'Exact unlock dates from Steam and Xbox. PlayStation and Epic do not provide them here.'),
    achievementCharts(model),

    h('h2', {}, 'Recorded play, last 30 days'),
    ...recordedChart());
}
