// Xbox: Microsoft has no public API for personal use, so this goes through
// OpenXBL (xbl.io), a third-party gateway. The user creates a free personal key there.
const { json } = require('../http');

const API = 'https://api.xbl.io';

function call(apiKey, path, opts = {}) {
  return json(API + path, {
    ...opts,
    headers: { 'X-Authorization': apiKey, Accept: 'application/json', 'Accept-Language': 'en-US', ...(opts.headers || {}) },
  }).catch((e) => {
    if (e.status === 401 || e.status === 403) throw new Error('OpenXBL rejected the key. Check it was copied in full.');
    if (e.status === 429) throw new Error('OpenXBL hourly request limit reached. Try again in an hour.');
    throw e;
  });
}

const unwrap = (body) => (body && body.content !== undefined ? body.content : body);

async function link(input) {
  const apiKey = String(input.apiKey || '').trim();
  if (apiKey.length < 20) throw new Error('Paste your OpenXBL personal API key.');
  const { body } = await call(apiKey, '/v2/account');
  const user = (unwrap(body).profileUsers || [])[0];
  if (!user) throw new Error('OpenXBL did not return an Xbox profile for that key.');
  const tag = (user.settings || []).find((s) => s.id === 'Gamertag');
  return { apiKey, xuid: String(user.id), name: tag ? tag.value : 'Xbox account' };
}

// Pull every { name: 'MinutesPlayed', titleid, value } out of a stats reply,
// wherever it sits in the response.
function collectMinutes(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => collectMinutes(n, out)); return; }
  const id = node.titleid || node.titleId;
  if (node.name === 'MinutesPlayed' && id && node.value !== undefined && node.value !== null) {
    const v = Number(node.value);
    if (Number.isFinite(v)) out[String(id)] = v;
  }
  Object.values(node).forEach((n) => collectMinutes(n, out));
}

async function sync(account, cache) {
  const { apiKey, xuid } = account;
  const { body } = await call(apiKey, '/v2/titles');
  const titles = (unwrap(body).titles || []).filter((t) => !t.type || t.type === 'Game');

  const mins = cache.minutes || (cache.minutes = {}); // titleId -> { minutes, lastPlayed }
  const lastPlayedOf = (t) => (t.titleHistory && t.titleHistory.lastTimePlayed) || null;
  const stale = titles.filter((t) => {
    const k = mins[t.titleId];
    return !k || k.lastPlayed !== lastPlayedOf(t);
  });

  const notes = [];
  let statsFailed = false;
  for (let i = 0; i < stale.length && !statsFailed; i += 50) {
    const chunk = stale.slice(i, i + 50);
    try {
      const r = await call(apiKey, '/v2/player/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xuids: [xuid], stats: chunk.map((t) => ({ name: 'MinutesPlayed', titleId: String(t.titleId) })) }),
      });
      const found = {};
      collectMinutes(r.body, found);
      for (const t of chunk) {
        // Titles with no reply are Xbox 360 era or apps that never recorded time.
        mins[t.titleId] = { minutes: found[String(t.titleId)] ?? null, lastPlayed: lastPlayedOf(t) };
      }
    } catch (e) {
      statsFailed = true;
      notes.push(`Play time could not be read for some games (${e.message}) They will be retried next sync.`);
    }
  }

  // Achievement unlock dates, for the Stats tab. Only refetched when the unlocked count changes,
  // and capped, because OpenXBL's free plan has an hourly request limit.
  const unlockedNow = titles.reduce((n, t) => n + ((t.achievement && t.achievement.currentAchievements) || 0), 0);
  if (cache.eventsKey !== unlockedNow) {
    try {
      const events = {};
      let token = null;
      let complete = false;
      for (let page = 0; page < 12; page++) {
        const r = await call(apiKey, `/v3/achievements?maxItems=1000${token ? `&continuationToken=${encodeURIComponent(token)}` : ''}`);
        const c = unwrap(r.body) || {};
        for (const a of c.achievements || []) {
          const when = a.progression && Date.parse(a.progression.timeUnlocked);
          const title = a.titleAssociations && a.titleAssociations[0] && a.titleAssociations[0].id;
          if (a.progressState !== 'Achieved' || !title || !(when > Date.UTC(2005, 0, 1))) continue;
          (events[String(title)] || (events[String(title)] = [])).push(Math.round(when / 1000));
        }
        token = c.pagingInfo && c.pagingInfo.continuationToken;
        if (!token || !(c.achievements || []).length) { complete = true; break; }
      }
      cache.events = events;
      if (complete) cache.eventsKey = unlockedNow;
      else notes.push('Only part of your Xbox achievement history could be read this time; more will be added next sync.');
    } catch (e) {
      notes.push(`Xbox achievement dates could not be read (${e.message})`);
    }
  }
  const eventsByTitle = cache.events || {};

  const games = titles.map((t) => {
    const a = t.achievement || {};
    const k = mins[t.titleId];
    return {
      id: String(t.titleId),
      name: t.name || `Title ${t.titleId}`,
      minutes: k && k.minutes !== null ? k.minutes : null,
      achUnlocked: a.currentAchievements ?? null,
      // Xbox reports a total of 0 for some older games even when some are unlocked.
      achTotal: a.totalAchievements ? a.totalAchievements : null,
      gamerscore: a.currentGamerscore ?? null,
      lastPlayed: lastPlayedOf(t),
      events: eventsByTitle[String(t.titleId)] || [],
      // Where it was played (PC, iOS, XboxOne...), to tell same-named versions apart.
      device: Array.isArray(t.devices) && t.devices.length ? t.devices.join(' / ') : null,
      image: t.displayImage ? String(t.displayImage).replace(/^http:/, 'https:') : null,
    };
  });

  const untimed = games.filter((g) => g.minutes === null).length;
  if (untimed && !statsFailed) notes.push(`${untimed} game(s) have no play time on Xbox's records (usually Xbox 360 games).`);
  return { games, notes };
}

module.exports = { link, sync };
