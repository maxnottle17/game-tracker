// Everything the app remembers lives in one JSON file in %APPDATA%\GameTracker.
// It holds the account keys/tokens, so it stays on this PC and is never served to the UI.
const fs = require('fs');
const path = require('path');

const DEMO = process.env.DEMO === '1';
const dir = process.env.DATA_DIR
  || path.join(process.env.APPDATA || path.join(require('os').homedir(), '.config'), 'GameTracker');
const file = path.join(dir, 'store.json');

// history:  { 'YYYY-MM-DD': { 'platform:gameId': minutesPlayed } } recorded from sync to sync
// baseline: { platform: { gameId: minutes } } the totals at the last sync, to measure the next change
const empty = () => ({ accounts: {}, games: {}, sync: {}, cache: {}, history: {}, baseline: {}, baselineAt: {}, trackingSince: null });

let data = empty();

function load() {
  if (DEMO) { data = require('./demo-data')(); return; }
  try {
    data = { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Keep the unreadable file so nothing is lost, then start fresh.
      try { fs.renameSync(file, `${file}.broken-${Date.now()}`); } catch { /* ignore */ }
    }
    data = empty();
  }
}

function save() {
  if (DEMO) return;
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

module.exports = { load, save, get: () => data, file, DEMO };
