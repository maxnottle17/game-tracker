// Steam: official Web API. Needs the user's own API key and a profile whose
// "Game details" privacy setting is Public.
const { json, mapLimit } = require('../http');

const API = 'https://api.steampowered.com';

function keyError(e) {
  if (e.status === 401 || e.status === 403) return new Error('Steam rejected the API key. Check it was copied in full.');
  return e;
}

async function resolveSteamId(key, input) {
  const direct = input.match(/\b(7656119\d{10})\b/);
  if (direct) return direct[1];
  const m = input.match(/steamcommunity\.com\/id\/([^/?#\s]+)/i);
  const vanity = m ? m[1] : input.replace(/\/+$/, '');
  if (!/^[\w-]{2,64}$/.test(vanity)) throw new Error("That doesn't look like a Steam profile link or ID.");
  const { body } = await json(`${API}/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${encodeURIComponent(vanity)}`).catch((e) => { throw keyError(e); });
  if (!body.response || body.response.success !== 1) throw new Error(`Steam has no profile called "${vanity}".`);
  return body.response.steamid;
}

async function link(input) {
  const apiKey = String(input.apiKey || '').trim();
  const profile = String(input.profile || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(apiKey)) throw new Error('A Steam API key is 32 letters and numbers.');
  if (!profile) throw new Error('Enter your Steam profile link or ID.');
  const steamId = await resolveSteamId(apiKey, profile);
  const { body } = await json(`${API}/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`).catch((e) => { throw keyError(e); });
  const player = body.response && body.response.players && body.response.players[0];
  if (!player) throw new Error('Steam could not find that profile.');
  return { apiKey, steamId, name: player.personaname };
}

async function sync(account, cache) {
  const { apiKey, steamId } = account;
  const { body } = await json(
    `${API}/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`
  ).catch((e) => { throw keyError(e); });
  const owned = body.response && body.response.games;
  if (!owned) {
    throw new Error('Steam returned no games. Set "Game details" to Public in your Steam profile privacy settings, then sync again.');
  }

  const played = owned.filter((g) => g.playtime_forever > 0);
  const ach = cache.ach || (cache.ach = {});
  let failed = 0;

  await mapLimit(played, 6, async (g) => {
    const known = ach[g.appid];
    // Achievements can only change when playtime does, so skip unchanged games.
    if (known && known.minutes === g.playtime_forever && known.times) return;
    try {
      const r = await json(`${API}/ISteamUserStats/GetPlayerAchievements/v1/?key=${apiKey}&steamid=${steamId}&appid=${g.appid}`);
      const list = (r.body.playerstats && r.body.playerstats.achievements) || [];
      const done = list.filter((a) => a.achieved);
      // Unlock times are the only dated history Steam gives; the Stats tab is built on them.
      ach[g.appid] = { minutes: g.playtime_forever, unlocked: done.length, total: list.length, times: done.map((a) => a.unlocktime).filter((t) => t > 0) };
    } catch (e) {
      if (e.status === 400) {
        // Steam's answer for a game that has no achievements.
        ach[g.appid] = { minutes: g.playtime_forever, unlocked: 0, total: 0, times: [] };
      } else {
        failed++;
      }
    }
  });

  const games = played.map((g) => {
    const a = ach[g.appid];
    return {
      id: String(g.appid),
      name: g.name || `App ${g.appid}`,
      minutes: g.playtime_forever,
      achUnlocked: a ? a.unlocked : null,
      achTotal: a ? a.total : null,
      lastPlayed: g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : null,
      events: a && a.times ? a.times : [],
      recentMinutes: g.playtime_2weeks || 0,
      image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
    };
  });

  // Account creation date (only visible when the profile is public).
  let accountPatch = null;
  try {
    const s = await json(`${API}/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`);
    const player = s.body.response && s.body.response.players && s.body.response.players[0];
    if (player && player.timecreated) accountPatch = { created: new Date(player.timecreated * 1000).toISOString(), name: player.personaname || account.name };
  } catch { /* optional */ }

  const notes = [];
  if (failed) notes.push(`Achievements could not be read for ${failed} game(s); they will be retried next sync.`);
  return { games, notes, accountPatch };
}

module.exports = { link, sync };
