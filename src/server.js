// Game Tracker: local web app. Only listens on this PC (127.0.0.1).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');

const PORT = Number(process.env.PORT) || 47830;
const UI_DIR = path.join(__dirname, '..', 'ui');
const PLATFORMS = {
  steam: require('./platforms/steam'),
  xbox: require('./platforms/xbox'),
  psn: require('./platforms/psn'),
  epic: require('./platforms/epic'),
  nintendo: require('./platforms/nintendo'),
};
const AUTO_SYNC_MS = 6 * 3600e3;

store.load();
const syncing = {};

async function syncPlatform(id) {
  const data = store.get();
  const account = data.accounts[id];
  if (!account || syncing[id] || store.DEMO || !store.configured()) return;
  syncing[id] = true;
  const cache = data.cache[id] || (data.cache[id] = {});
  try {
    const result = await PLATFORMS[id].sync(account, cache);
    if (!data.accounts[id]) return; // unlinked while syncing
    if (result.accountPatch) Object.assign(data.accounts[id], result.accountPatch);
    if (result.daily) {
      // The platform reports exact minutes per day itself, so use those as they are.
      for (const d of result.daily) (data.history[d.date] || (data.history[d.date] = {}))[`${id}:${d.id}`] = d.minutes;
      if (!data.trackingSince) data.trackingSince = new Date().toISOString();
    } else {
      recordHistory(id, result.games);
    }
    data.games[id] = result.games;
    data.sync[id] = { at: new Date().toISOString(), ok: true, notes: result.notes || [] };
  } catch (e) {
    if (data.accounts[id]) {
      if (e.accountPatch) Object.assign(data.accounts[id], e.accountPatch);
      // Keep the last good game list; just record what went wrong.
      data.sync[id] = { at: new Date().toISOString(), ok: false, error: e.message, notes: [] };
    }
  } finally {
    syncing[id] = false;
    store.save();
  }
}

// The platforms only report lifetime totals, so real day-by-day history has to be built here:
// each sync, the growth in every game's total since the previous sync is logged against today.
function recordHistory(id, games) {
  const data = store.get();
  const now = Date.now();
  const totals = (list) => Object.fromEntries((list || []).filter((g) => g.minutes !== null && g.minutes !== undefined).map((g) => [g.id, g.minutes]));
  if (!data.baseline[id]) {
    // First time: start from what was already known, so only new play is counted.
    data.baseline[id] = data.games[id] ? totals(data.games[id]) : totals(games);
    data.baselineAt[id] = data.sync[id] && data.sync[id].ok ? Date.parse(data.sync[id].at) : now;
    if (!data.trackingSince) data.trackingSince = new Date(data.baselineAt[id]).toISOString();
  }
  const base = data.baseline[id];
  // Nobody can play more minutes than have passed; this filters out totals that were
  // merely missing last time and then appeared all at once.
  const possible = Math.max(0, (now - data.baselineAt[id]) / 60000) + 5;
  const day = new Date(now).toLocaleDateString('sv'); // YYYY-MM-DD, local time
  for (const g of games) {
    if (g.minutes === null || g.minutes === undefined) continue;
    const delta = g.minutes - (base[g.id] || 0);
    if (delta > 0 && delta <= possible) {
      const log = data.history[day] || (data.history[day] = {});
      log[`${id}:${g.id}`] = (log[`${id}:${g.id}`] || 0) + delta;
    }
    base[g.id] = g.minutes;
  }
  data.baselineAt[id] = now;
}

function syncAll() {
  if (!store.configured()) return;
  for (const id of Object.keys(PLATFORMS)) syncPlatform(id);
}

function publicState() {
  if (!store.configured()) {
    // First run (or the chosen folder has gone missing): the UI shows the folder picker.
    return { needsSetup: true, defaultDir: store.defaultDir, missingDir: store.missingDir() };
  }
  const data = store.get();
  const accounts = {};
  const games = [];
  for (const id of Object.keys(PLATFORMS)) {
    const a = data.accounts[id];
    accounts[id] = {
      linked: !!a,
      name: a ? a.name : null,
      created: a && a.created ? a.created : null,
      syncing: !!syncing[id],
      sync: data.sync[id] || null,
      count: (data.games[id] || []).length,
    };
    if (a) for (const g of data.games[id] || []) games.push({ ...g, platform: id });
  }
  return { accounts, games, history: data.history || {}, trackingSince: data.trackingSince || null, dataDir: store.dataDir(),
    epicLoginUrl: PLATFORMS.epic.LOGIN_URL, nintendoLoginUrl: PLATFORMS.nintendo.loginUrl(), demo: store.DEMO };
}

function send(res, status, body, type = 'application/json') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(type === 'application/json' ? JSON.stringify(body) : body);
  res.writeHead(status, {
    'Content-Type': type + (type.startsWith('text/') || type === 'application/json' ? '; charset=utf-8' : ''),
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 20000) { reject(new Error('Too much data.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('Bad request.')); }
    });
    req.on('error', reject);
  });
}

// Opens the standard Windows "choose a folder" window and returns the chosen path ('' if cancelled).
function pickFolder() {
  if (process.platform !== 'win32') return Promise.resolve('');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0 }',
    '$owner.Show()',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = 'Choose where Game Tracker keeps your data'",
    '$d.ShowNewFolderButton = $true',
    "if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
    '$owner.Close()',
  ].join('; ');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 300000, encoding: 'utf8' },
      (err, stdout) => resolve(err ? '' : String(stdout).trim()));
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
// The window opens at this path (not "/") so Windows treats it as a different app from
// other local tools on 127.0.0.1 and gives it its own taskbar button.
const APP_PATH = '/game-tracker';

async function handle(req, res) {
  // Only this PC's own browser window may talk to the app: other websites are refused.
  const okHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  if (!okHosts.includes(req.headers.host)) return send(res, 403, { error: 'Forbidden' });
  const origin = req.headers.origin;
  if (origin && !okHosts.some((h) => origin === `http://${h}`)) return send(res, 403, { error: 'Forbidden' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] === 'api') {
    if (req.method === 'GET' && parts[1] === 'state') return send(res, 200, publicState());
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') return send(res, 415, { error: 'Bad request.' });
    const body = await readBody(req);
    const id = parts[2];
    const data = store.get();

    if (parts[1] === 'browse') return send(res, 200, { dir: await pickFolder() });
    if (parts[1] === 'data-dir') {
      const firstRun = !store.configured();
      try { store.setDir(body.dir); } catch (e) { return send(res, 400, { error: e.message }); }
      if (firstRun) syncAll(); // an adopted folder may already have linked accounts
      return send(res, 200, publicState());
    }
    if (!store.configured()) return send(res, 409, { error: 'Choose a data folder first.' });

    if (parts[1] === 'sync' && !id) { syncAll(); return send(res, 200, publicState()); }
    if (parts[1] === 'quit') { send(res, 200, { ok: true }); setTimeout(() => process.exit(0), 200); return; }
    if (!PLATFORMS[id]) return send(res, 404, { error: 'Unknown platform' });

    if (parts[1] === 'sync') { syncPlatform(id); return send(res, 200, publicState()); }
    if (parts[1] === 'unlink') {
      delete data.accounts[id]; delete data.games[id]; delete data.sync[id]; delete data.cache[id];
      delete data.baseline[id]; delete data.baselineAt[id];
      store.save();
      return send(res, 200, publicState());
    }
    if (parts[1] === 'link') {
      if (store.DEMO) return send(res, 400, { error: 'Linking is switched off in demo mode.' });
      try {
        data.accounts[id] = await PLATFORMS[id].link(body);
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
      delete data.sync[id]; delete data.cache[id];
      store.save();
      syncPlatform(id);
      return send(res, 200, publicState());
    }
    return send(res, 404, { error: 'Not found' });
  }

  if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain');
  const name = url.pathname === '/' || url.pathname === APP_PATH ? 'index.html'
    : url.pathname === '/favicon.ico' ? 'icon.ico' : path.basename(url.pathname);
  const type = MIME[path.extname(name)];
  if (!type) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(path.join(UI_DIR, name), (err, buf) => (err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, type)));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => { if (!res.headersSent) send(res, 500, { error: e.message }); });
});

server.on('error', (e) => {
  // Already running (EADDRINUSE): the existing copy keeps serving, this one just exits.
  console.error(e.code === 'EADDRINUSE' ? 'Game Tracker is already running.' : e.message);
  process.exit(e.code === 'EADDRINUSE' ? 0 : 1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Game Tracker running at http://127.0.0.1:${PORT}${store.DEMO ? ' (demo data)' : ''}`);
  if (store.configured()) {
    const data = store.get();
    const stale = (id) => !data.sync[id] || Date.now() - Date.parse(data.sync[id].at) > 3600e3;
    for (const id of Object.keys(PLATFORMS)) if (stale(id)) syncPlatform(id);
  }
  setInterval(syncAll, AUTO_SYNC_MS).unref();
});
