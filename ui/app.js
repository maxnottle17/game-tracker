'use strict';

const PLATFORMS = {
  steam: { label: 'Steam', short: 'Steam' },
  xbox: { label: 'Xbox', short: 'Xbox' },
  psn: { label: 'PlayStation', short: 'PS' },
  nintendo: { label: 'Nintendo', short: 'Nintendo' },
  epic: { label: 'Epic Games', short: 'Epic' },
};

let state = null;
const view = { platform: 'all', search: '', sort: 'hours', combine: true, versions: false };
try { Object.assign(view, JSON.parse(localStorage.getItem('view-options') || '{}')); } catch { /* use defaults */ }
const saveOptions = () => { try { localStorage.setItem('view-options', JSON.stringify({ combine: view.combine, versions: view.versions })); } catch { /* ignore */ } };
const expanded = new Set(); // rows whose breakdown is open
const linkErrors = {};
const linkBusy = {};

const $ = (id) => document.getElementById(id);

// Build elements without innerHTML, so game names from the internet are always plain text.
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const fmtInt = (n) => Math.round(n).toLocaleString('en');
function fmtHours(mins) {
  if (mins === null || mins === undefined) return 'no time data';
  if (mins < 60) return `${Math.round(mins)} min`;
  const hrs = mins / 60;
  return `${hrs.toLocaleString('en', { minimumFractionDigits: hrs < 100 ? 1 : 0, maximumFractionDigits: hrs < 100 ? 1 : 0 })} h`;
}
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const normName = (s) => String(s).toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, '');

const cleanName = (s) => String(s).replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();

// "Minecraft for Windows", "Minecraft: Java Edition", "Minecraft (iOS)" -> "Minecraft".
// Only known platform / edition wording at the END of a name is removed, so sequels and
// spin-offs ("Minecraft Dungeons") stay separate games.
const SEP = '[\\s:,\\-–—]+';
const DEVICE = '(?:windows(?:\\s*\\d+)?|win\\s*\\d+|pc|mac|ios|iphone|ipad|android|mobile|nintendo switch|switch|xbox one|xbox series x\\s*\\|\\s*s|xbox series [xs]|xbox series|xbox 360|xbox|ps\\s?[345]|playstation(?:\\s*[345])?)';
const TAIL_RULES = [
  /\s*[([][^)\]]*[)\]]\s*$/,
  new RegExp(`\\s+for\\s+${DEVICE}(?:\\s*(?:&|and|/|\\+)\\s*${DEVICE})*$`, 'i'),
  new RegExp(`${SEP}${DEVICE}(?:\\s+(?:edition|version))?$`, 'i'),
  new RegExp(`${SEP}(?:the\\s+)?(?:game of the year|[\\w'’]+)\\s+(?:edition|version)$`, 'i'),
  new RegExp(`${SEP}(?:remastered|remaster|hd|goty|game of the year|director['’]?s cut|definitive|deluxe|ultimate|complete|enhanced|launcher|preview|beta|demo)$`, 'i'),
];
function baseTitle(name) {
  let s = cleanName(name);
  for (let changed = true; changed;) {
    changed = false;
    for (const rule of TAIL_RULES) {
      const next = s.replace(rule, '').trim();
      if (next && next !== s) { s = next; changed = true; }
    }
  }
  return s;
}

// ---------- leaderboard ----------

function buildRows() {
  const games = state.games.filter((g) => view.platform === 'all' || g.platform === view.platform);
  const groups = new Map();
  for (const g of games) {
    const key = view.versions ? `v:${normName(baseTitle(g.name))}`
      : view.combine ? `c:${normName(g.name)}` : `${g.platform}:${g.id}`;
    let row = groups.get(key);
    if (!row) {
      row = { key, name: cleanName(g.name), minutes: 0, hasTime: false, achUnlocked: 0, achTotal: 0, hasAch: false, lastPlayed: null, image: null, parts: [] };
      groups.set(key, row);
    }
    row.parts.push(g);
    if (g.minutes !== null) { row.minutes += g.minutes; row.hasTime = true; }
    // Games that simply have no achievements (0 of 0) are shown as a dash.
    if (g.achUnlocked !== null && g.achUnlocked !== undefined && (g.achUnlocked > 0 || g.achTotal)) {
      row.achUnlocked += g.achUnlocked; row.hasAch = true;
      // A total is only trustworthy when every part reports one.
      row.achTotal = row.achTotal === null || !g.achTotal ? null : row.achTotal + g.achTotal;
    }
    if (g.lastPlayed && (!row.lastPlayed || g.lastPlayed > row.lastPlayed)) row.lastPlayed = g.lastPlayed;
    if (!row.image && g.image) row.image = g.image;
  }
  let rows = [...groups.values()];
  for (const r of rows) {
    r.parts.sort((a, b) => (b.minutes || 0) - (a.minutes || 0));
    // Several differently named versions in one row: title it with the shared base name.
    r.versions = new Set(r.parts.map((p) => normName(p.name))).size;
    r.name = r.versions > 1 ? baseTitle(r.parts[0].name) : cleanName(r.parts[0].name);
    r.pct = r.hasAch && r.achTotal ? Math.min(100, (r.achUnlocked / r.achTotal) * 100) : null;
  }
  const q = view.search.trim().toLowerCase();
  const sorters = {
    hours: (a, b) => b.minutes - a.minutes || b.achUnlocked - a.achUnlocked,
    ach: (a, b) => b.achUnlocked - a.achUnlocked || b.minutes - a.minutes,
    pct: (a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.minutes - a.minutes,
    recent: (a, b) => (b.lastPlayed || '').localeCompare(a.lastPlayed || '') || b.minutes - a.minutes,
  };
  rows.sort(sorters[view.sort]);
  rows.forEach((r, i) => { r.rank = i + 1; }); // rank comes from the full list, so search doesn't renumber
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  return rows;
}

function renderTiles() {
  const games = state.games.filter((g) => view.platform === 'all' || g.platform === view.platform);
  const mins = games.reduce((n, g) => n + (g.minutes || 0), 0);
  const ach = games.reduce((n, g) => n + (g.achUnlocked || 0), 0);
  const titles = new Set(games.map((g) => normName(g.name))).size;
  const byPlat = Object.keys(PLATFORMS)
    .map((p) => [p, state.games.filter((g) => g.platform === p).reduce((n, g) => n + (g.minutes || 0), 0)])
    .filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
  const top = buildTop(games);
  const tile = (label, value, sub) => h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), h('div', { class: 'sub', title: sub || '' }, sub || ' '));
  $('tiles').replaceChildren(
    tile('Total played', mins ? `${fmtInt(mins / 60)} h` : '0 h', mins ? `about ${fmtInt(mins / 1440)} days` : ''),
    tile('Games played', fmtInt(titles), ''),
    tile('Achievements', fmtInt(ach), 'unlocked'),
    tile('Most played', top ? top.name : '–', top ? fmtHours(top.minutes) : ''),
    tile('By platform', byPlat.length ? PLATFORMS[byPlat[0][0]].label : '–', byPlat.map(([p, m]) => `${PLATFORMS[p].short} ${fmtInt(m / 60)} h`).join(' · ')),
  );
  const mp = $('tiles').children[3].querySelector('.value');
  mp.style.fontSize = '17px'; mp.style.lineHeight = '34px';
  mp.style.whiteSpace = 'nowrap'; mp.style.overflow = 'hidden'; mp.style.textOverflow = 'ellipsis';
}

function buildTop(games) {
  const m = new Map();
  for (const g of games) {
    const k = normName(g.name);
    const r = m.get(k) || { name: g.name, minutes: 0 };
    r.minutes += g.minutes || 0;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.minutes - a.minutes)[0] || null;
}

function renderChips() {
  const linked = Object.keys(PLATFORMS).filter((p) => state.accounts[p].linked);
  const chip = (id, label) => h('button', { class: `chip${view.platform === id ? ' active' : ''}`, onclick: () => { view.platform = id; renderBoard(); } }, label);
  $('chips').replaceChildren(chip('all', 'All platforms'), ...linked.map((p) => chip(p, PLATFORMS[p].label)));
}

function cover(row) {
  const initials = row.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const fallback = () => h('div', { class: 'cover' }, initials);
  if (!row.image) return fallback();
  const img = h('img', { class: 'cover', alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', src: row.image });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

// Total play time as years / months / weeks / days (a year is 365 days, a month 30).
function timePlayed(row) {
  if (!row.hasTime) return h('div', { class: 'timeplayed' }, h('span', { class: 'tlabel' }, 'Time played'), h('span', { class: 'muted' }, 'no play time recorded'));
  const mins = Math.round(row.minutes);
  let days = Math.floor(mins / 1440);
  const years = Math.floor(days / 365); days %= 365;
  const months = Math.floor(days / 30); days %= 30;
  const weeks = Math.floor(days / 7); days %= 7;
  const units = [[years, 'year'], [months, 'month'], [weeks, 'week'], [days, 'day'], [Math.floor((mins % 1440) / 60), 'hour'], [mins % 60, 'minute']];
  return h('div', { class: 'timeplayed' }, h('span', { class: 'tlabel' }, 'Time played'),
    units.map(([n, unit]) => h('span', { class: `unit${n ? '' : ' zero'}` }, h('b', {}, n), ` ${unit}${n === 1 ? '' : 's'}`)));
}

function renderBoard() {
  renderChips();
  renderTiles();
  const rows = buildRows();
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  const anyLinked = Object.values(state.accounts).some((a) => a.linked);
  const anySyncing = Object.values(state.accounts).some((a) => a.syncing);

  $('board').replaceChildren(...rows.map((r) => {
    const bar = h('i'); bar.style.width = `${Math.max(0.5, (r.minutes / max) * 100)}%`;
    const multi = r.parts.length > 1;
    const open = expanded.has(r.key);
    const perPlatform = new Map();
    for (const p of r.parts) perPlatform.set(p.platform, (perPlatform.get(p.platform) || 0) + (p.minutes || 0));
    const badges = [...perPlatform].map(([p, m]) => h('span', { class: `badge p-${p}` }, perPlatform.size > 1 ? `${PLATFORMS[p].short} ${fmtHours(m)}` : PLATFORMS[p].label));
    badges.push(h('button', { class: 'more', 'aria-expanded': String(open), onclick: () => { if (open) expanded.delete(r.key); else expanded.add(r.key); renderBoard(); } },
      open ? 'Hide breakdown' : multi ? `Breakdown (${r.parts.length}${r.versions > 1 ? ' versions' : ''})` : 'Breakdown'));
    const breakdown = open ? h('div', { class: 'breakdown' }, timePlayed(r), r.parts.map((p) => {
      const pbar = h('i'); pbar.style.width = `${r.minutes ? ((p.minutes || 0) / r.minutes) * 100 : 0}%`;
      const hasAch = p.achUnlocked !== null && p.achUnlocked !== undefined && (p.achUnlocked > 0 || p.achTotal);
      return h('div', { class: 'part' },
        h('span', { class: `badge p-${p.platform}` }, PLATFORMS[p.platform].label),
        h('span', { class: 'pname', title: p.name }, cleanName(p.name), p.device ? h('span', { class: 'muted' }, ` · ${p.device}`) : null),
        h('span', { class: 'bar' }, pbar),
        h('span', { class: 'phours' }, p.minutes === null ? '–' : fmtHours(p.minutes)),
        h('span', { class: 'pshare' }, r.minutes && p.minutes !== null ? `${Math.round((p.minutes / r.minutes) * 100)}%` : ''),
        h('span', { class: 'pach' }, hasAch ? `${fmtInt(p.achUnlocked)}${p.achTotal ? ` / ${fmtInt(p.achTotal)}` : ''} ach.` : '–'));
    })) : null;
    let ach = h('div', { class: 'ach' }, '–');
    if (r.hasAch) {
      const abar = h('i'); abar.style.width = `${r.pct ?? 0}%`;
      ach = h('div', { class: 'ach' },
        h('b', {}, fmtInt(r.achUnlocked)), r.achTotal ? ` / ${fmtInt(r.achTotal)}` : '', ' achievements',
        r.pct !== null ? h('div', { class: 'bar' }, abar) : null);
    }
    return h('li', { class: 'item' },
      h('div', { class: `row${r.rank <= 3 ? ` top${r.rank}` : ''}` },
        h('div', { class: 'rank' }, r.rank),
        cover(r),
        h('div', {}, h('div', { class: 'name', title: r.name }, r.name), h('div', { class: 'badges' }, badges), h('div', { class: 'bar' }, bar)),
        h('div', { class: 'hours' }, r.hasTime ? fmtHours(r.minutes) : '–', r.lastPlayed ? h('small', {}, `played ${ago(r.lastPlayed)}`) : null),
        ach),
      breakdown);
  }));
  $('combine').checked = view.combine || view.versions;
  $('combine').disabled = view.versions; // grouping versions already combines platforms
  $('versions').checked = view.versions;

  const empty = $('empty');
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    empty.textContent = !anyLinked ? 'No accounts linked yet. Open the Accounts tab to link Steam, Xbox, PlayStation or Epic.'
      : anySyncing ? 'Fetching your games…'
        : view.search ? 'No games match that search.' : 'No played games found yet. Try Sync now.';
  }
}

// ---------- accounts ----------

function steps(id) {
  const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  if (id === 'steam') return {
    steps: [
      ['Get your free key at ', a('https://steamcommunity.com/dev/apikey', 'steamcommunity.com/dev/apikey'), ' (any domain name works, e.g. ', h('code', {}, 'localhost'), ').'],
      ['In Steam: Profile → Edit Profile → Privacy Settings, set ', h('b', {}, 'Game details'), ' to Public.'],
      ['Paste the key and your profile link below.'],
    ],
    fields: [['apiKey', 'Steam Web API key', 'password'], ['profile', 'Profile link or SteamID (e.g. steamcommunity.com/id/yourname)', 'text']],
    caveat: 'Official Steam API. Hours and achievements are both reliable.',
  };
  if (id === 'xbox') return {
    steps: [
      ['Go to ', a('https://xbl.io', 'xbl.io'), ' and sign in with your Microsoft account.'],
      ['Create a personal API key on its dashboard and paste it below.'],
    ],
    fields: [['apiKey', 'OpenXBL API key', 'password']],
    caveat: 'Microsoft offers no public API, so this uses OpenXBL, a third-party service that sees your Xbox data. Its free plan has an hourly request limit. Xbox 360 games usually have no play time.',
  };
  if (id === 'psn') return {
    steps: [
      ['Sign in at ', a('https://www.playstation.com', 'playstation.com'), ' in your browser.'],
      ['In the same browser, open ', a('https://ca.account.sony.com/api/v1/ssocookie', 'ca.account.sony.com/api/v1/ssocookie'), '.'],
      ['Copy the 64-character ', h('code', {}, 'npsso'), ' value shown and paste it below.'],
    ],
    fields: [['npsso', 'NPSSO token', 'password']],
    caveat: 'Unofficial: uses the same service as the PlayStation phone app. The link lasts about two months, then needs a fresh token. Play time covers PS4/PS5 games; older games show trophies only.',
  };
  if (id === 'nintendo') return {
    steps: [
      ['Open ', a(state.nintendoLoginUrl, 'the Nintendo sign-in page'), ' and sign in to your Nintendo Account.'],
      ['On the page that follows, do NOT click the red ', h('b', {}, 'Select this account'), ' button. Right-click it and choose ', h('b', {}, 'Copy link address'), '.'],
      ['Paste the copied link below. It starts with ', h('code', {}, 'npf5c38e31cd085304b://auth'), '.'],
    ],
    fields: [['url', 'Copied link', 'password']],
    caveat: "Unofficial: reads the play history shown in Nintendo's own phone app, for Switch and Switch 2 games. Nintendo could object to third-party tools using an account this way, so link it only if you accept that risk. Play time and first/last played dates are available; Nintendo has no achievements.",
  };
  return {
    steps: [
      ['Open ', a(state.epicLoginUrl, 'the Epic sign-in page'), ' and sign in.'],
      ['You will land on a page of text. Copy the ', h('code', {}, 'authorizationCode'), ' value (or the whole page) and paste it below within a few minutes.'],
    ],
    fields: [['code', 'Authorization code', 'password']],
    caveat: 'Unofficial and the least dependable of the platforms: it signs in the way the Epic launcher does. Play time usually works; achievements are often missing and "last played" is not available.',
  };
}

function renderAccounts() {
  // Don't rebuild while the user is typing in a form.
  const active = document.activeElement;
  if (active && active.tagName === 'INPUT' && $('accounts').contains(active)) return;

  $('accounts').replaceChildren(...Object.keys(PLATFORMS).map((id) => {
    const acc = state.accounts[id];
    const info = steps(id);
    const title = h('h2', { class: `p-${id}` }, h('span', { class: 'dot' }), h('span', {}, PLATFORMS[id].label));

    if (acc.linked) {
      const s = acc.sync;
      const stateLine = acc.syncing ? h('p', { class: 'state' }, 'Syncing…')
        : !s ? h('p', { class: 'state' }, 'Linked. Waiting for first sync.')
          : s.ok ? h('p', { class: 'state ok' }, `Synced ${ago(s.at)} · ${acc.count} games`)
            : h('p', { class: 'state bad' }, `Last sync failed ${ago(s.at)}: ${s.error}`);
      return h('div', { class: 'card' }, title,
        h('p', { class: 'state' }, 'Linked as ', h('b', {}, acc.name || 'account')),
        stateLine,
        (s && s.notes || []).map((n) => h('p', { class: 'note' }, n)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', disabled: acc.syncing, onclick: () => act(`/api/sync/${id}`) }, 'Sync'),
          h('button', { class: 'btn ghost', onclick: () => { if (confirm(`Unlink ${PLATFORMS[id].label}? Its games will be removed from the leaderboard.`)) act(`/api/unlink/${id}`); } }, 'Unlink')),
        h('p', { class: 'caveat' }, info.caveat));
    }

    const inputs = {};
    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const body = {};
      for (const [k, el] of Object.entries(inputs)) body[k] = el.value;
      linkBusy[id] = true; delete linkErrors[id];
      document.activeElement.blur(); renderAccounts();
      try { state = await api(`/api/link/${id}`, body); } catch (err) { linkErrors[id] = err.message; }
      linkBusy[id] = false;
      render(); poll();
    } },
      info.fields.map(([key, label, type]) => {
        inputs[key] = h('input', { type, autocomplete: 'off', spellcheck: false, required: true });
        return h('label', { class: 'field' }, h('span', {}, label), inputs[key]);
      }),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'submit', disabled: !!linkBusy[id] }, linkBusy[id] ? 'Checking…' : `Link ${PLATFORMS[id].label}`)),
      linkErrors[id] ? h('p', { class: 'msg bad' }, linkErrors[id]) : null);

    return h('div', { class: 'card' }, title, h('p', { class: 'state' }, 'Not linked'),
      h('ol', {}, info.steps.map((s) => h('li', {}, s))), form, h('p', { class: 'caveat' }, info.caveat));
  }));
}

// ---------- shell ----------

// A text box + Browse button for picking a folder; used on first run and when moving the data later.
function folderForm(initial, label, onDone) {
  const input = h('input', { type: 'text', value: initial || '', spellcheck: false, 'aria-label': 'Folder path' });
  const msg = h('p', { class: 'msg bad' });
  const go = h('button', { class: 'btn', type: 'submit' }, label);
  const browse = h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
    browse.disabled = true; browse.textContent = 'Choosing…';
    try { const r = await api('/api/browse', {}); if (r.dir) input.value = r.dir; } catch { /* type the path instead */ }
    browse.disabled = false; browse.textContent = 'Browse…';
  } }, 'Browse…');
  return h('form', { onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = ''; go.disabled = true;
    try { state = await api('/api/data-dir', { dir: input.value }); onDone(); } catch (err) { msg.textContent = err.message; }
    go.disabled = false;
  } }, h('div', { class: 'folder-form' }, input, browse, go), msg);
}

function renderSetup() {
  document.querySelector('main').hidden = true;
  document.querySelector('.tabs').hidden = true;
  $('sync-all').hidden = true;
  $('sync-status').textContent = '';
  const box = $('setup');
  box.hidden = false;
  if (box.childElementCount) return; // built once, so typing is not wiped by the next refresh
  box.append(h('div', { class: 'card' },
    h('h2', {}, 'Welcome to Game Tracker'),
    state.missingDir
      ? h('p', { class: 'msg bad' }, `Your data folder could not be found: ${state.missingDir}. Reconnect that drive and restart the app, or choose a folder below (choosing the same folder again picks your data back up).`)
      : h('p', {}, 'First, choose where Game Tracker keeps your private data on this PC.'),
    h('ul', {},
      h('li', {}, 'This folder will hold your account keys and sign-in tokens, your game list and your play history.'),
      h('li', {}, 'It stays on this PC. Nothing in it is uploaded anywhere.'),
      h('li', {}, 'Pick somewhere only you can open. You can move it later from the Accounts tab.')),
    folderForm(state.missingDir || state.defaultDir, 'Use this folder', () => { box.replaceChildren(); render(); poll(); })));
}

function renderDataLocation() {
  const box = $('data-loc');
  if (box.querySelector('form')) return; // a move is being typed in: leave it alone
  const holder = h('div', {});
  box.replaceChildren(
    h('h2', {}, 'Where your data is kept'),
    h('p', { class: 'state' }, 'Account keys, sign-in tokens, game list and play history are stored in this folder on this PC:'),
    h('p', { class: 'path' }, state.dataDir || ''),
    state.demo ? null : h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: (e) => {
      e.target.hidden = true;
      holder.append(folderForm(state.dataDir, 'Move data here', () => { box.replaceChildren(); render(); }));
    } }, 'Move to another folder…')),
    holder);
}

function renderTop() {
  const accs = Object.values(state.accounts);
  const busy = accs.some((a) => a.syncing);
  const last = accs.map((a) => a.sync && a.sync.at).filter(Boolean).sort().pop();
  const failed = Object.keys(PLATFORMS).filter((p) => state.accounts[p].linked && state.accounts[p].sync && !state.accounts[p].sync.ok);
  $('sync-status').textContent = state.demo ? 'Demo data' : busy ? 'Syncing…'
    : failed.length ? `${failed.map((p) => PLATFORMS[p].label).join(', ')} failed to sync (see Accounts)`
      : last ? `Updated ${ago(last)}` : '';
  $('sync-all').disabled = busy || !accs.some((a) => a.linked);
}

function render() {
  if (state.needsSetup) { renderSetup(); return; }
  $('setup').hidden = true;
  document.querySelector('main').hidden = false;
  document.querySelector('.tabs').hidden = false;
  $('sync-all').hidden = false;
  renderDataLocation();
  renderTop();
  renderBoard();
  renderStats();
  renderAccounts();
}

async function act(path) {
  try { state = await api(path, {}); } catch (e) { alert(e.message); }
  render(); poll();
}

let timer = null;
async function poll() {
  clearTimeout(timer);
  try { state = await api('/api/state'); render(); } catch { /* app closed */ }
  const busy = state && state.accounts && Object.values(state.accounts).some((a) => a.syncing);
  timer = setTimeout(poll, busy ? 1500 : 60000);
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
  $('view-board').hidden = tab.dataset.view !== 'board';
  $('view-stats').hidden = tab.dataset.view !== 'stats';
  $('view-accounts').hidden = tab.dataset.view !== 'accounts';
}));
$('search').addEventListener('input', (e) => { view.search = e.target.value; renderBoard(); });
$('sort').addEventListener('change', (e) => { view.sort = e.target.value; renderBoard(); });
$('combine').addEventListener('change', (e) => { view.combine = e.target.checked; saveOptions(); renderBoard(); });
$('versions').addEventListener('change', (e) => { view.versions = e.target.checked; saveOptions(); renderBoard(); });
$('sync-all').addEventListener('click', () => act('/api/sync'));
$('quit').addEventListener('click', async () => {
  if (!confirm('Stop Game Tracker? Run "Game Tracker.vbs" to start it again.')) return;
  await api('/api/quit', {}).catch(() => {});
  document.body.replaceChildren(h('p', { class: 'empty' }, 'Game Tracker has stopped. You can close this window.'));
});

poll();
