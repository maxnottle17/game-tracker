// Everything the app remembers lives in one JSON file, store.json, in a folder the user
// picks the first time they run the app. It holds account keys/tokens, so it is never
// served to the UI and never belongs in the project folder.
//
// The only thing kept at a fixed place is a tiny pointer file saying where that folder is:
//   %APPDATA%\GameTracker\config.json  ->  { "dataDir": "D:\\Somewhere\\GameTracker" }
const fs = require('fs');
const path = require('path');

const DEMO = process.env.DEMO === '1';
const baseDir = path.join(process.env.APPDATA || path.join(require('os').homedir(), '.config'), 'GameTracker');
const configFile = path.join(baseDir, 'config.json');
const FILE = 'store.json';

// history:  { 'YYYY-MM-DD': { 'platform:gameId': minutesPlayed } } recorded from sync to sync
// baseline: { platform: { gameId: minutes } } the totals at the last sync, to measure the next change
const empty = () => ({ accounts: {}, games: {}, sync: {}, cache: {}, history: {}, baseline: {}, baselineAt: {}, trackingSince: null });

let data = empty();
let dir = null;

function findDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  try {
    const c = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (c.dataDir) return c.dataDir;
  } catch { /* no pointer yet */ }
  // Installs from before the folder was selectable keep using the original place.
  if (fs.existsSync(path.join(baseDir, FILE))) return baseDir;
  return null;
}

function readFrom(folder) {
  const file = path.join(folder, FILE);
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Keep the unreadable file so nothing is lost, then start fresh.
      try { fs.renameSync(file, `${file}.broken-${Date.now()}`); } catch { /* ignore */ }
    }
    return empty();
  }
}

function load() {
  if (DEMO) { data = require('./demo-data')(); dir = '(demo data, nothing is saved)'; return; }
  dir = findDir();
  // A chosen folder that has gone missing (unplugged drive, deleted) must not be silently
  // replaced by an empty one: the app asks again instead.
  if (dir && !fs.existsSync(dir)) return;
  if (dir) data = readFrom(dir);
}

function save() {
  if (DEMO || !configured()) return;
  const file = path.join(dir, FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

const configured = () => DEMO || (!!dir && fs.existsSync(dir));
const missingDir = () => (!DEMO && dir && !fs.existsSync(dir) ? dir : null);

// Choose the data folder (first run), or move the data to a new one (later).
function setDir(input) {
  if (DEMO) throw new Error('The data folder cannot be changed in demo mode.');
  const raw = String(input || '').trim().replace(/^"|"$/g, '');
  if (!raw || !path.isAbsolute(raw)) throw new Error('Enter a full folder path, for example D:\\GameTracker.');
  const target = path.resolve(raw);
  try {
    fs.mkdirSync(target, { recursive: true });
    const probe = path.join(target, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch (e) {
    throw new Error(`That folder cannot be created or written to (${e.code || e.message}).`);
  }

  const moving = configured() && path.resolve(dir).toLowerCase() !== target.toLowerCase();
  const targetHasData = fs.existsSync(path.join(target, FILE));
  const oldFile = configured() ? path.join(dir, FILE) : null;

  if (moving && targetHasData) throw new Error('That folder already has Game Tracker data in it. Pick a different folder.');
  // First run: a folder that already holds data (e.g. from another PC) is adopted as it is.
  if (!configured()) data = targetHasData ? readFrom(target) : empty();

  dir = target;
  save();
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ dataDir: target }, null, 1));
  if (moving && oldFile) {
    // The copy in the new place is written and confirmed above; now remove the old one.
    try { fs.unlinkSync(oldFile); } catch { /* ignore */ }
  }
}

module.exports = { load, save, get: () => data, DEMO, configured, missingDir, setDir, dataDir: () => dir, defaultDir: baseDir };
