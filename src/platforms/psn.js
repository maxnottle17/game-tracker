// PlayStation: Sony has no public API. This uses the same calls as the PlayStation
// mobile app (as documented by the open-source psn-api project). The user signs in on
// Sony's own site and pastes the "NPSSO" sign-in token; their password never comes here.
const { request, json } = require('../http');

const AUTH = 'https://ca.account.sony.com/api/authz/v3/oauth';
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const BASIC = 'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
const REDIRECT = 'com.scee.psxandroid.scecompcall://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

async function tokenRequest(form) {
  const { body } = await json(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: BASIC },
    body: new URLSearchParams(form).toString(),
  });
  if (!body.access_token) throw new Error('PlayStation did not return a sign-in token.');
  return {
    accessToken: body.access_token,
    accessExpiresAt: Date.now() + (body.expires_in || 3600) * 1000,
    refreshToken: body.refresh_token,
    refreshExpiresAt: Date.now() + (body.refresh_token_expires_in || 0) * 1000,
  };
}

async function link(input) {
  const m = String(input.npsso || '').match(/[A-Za-z0-9]{64}/);
  if (!m) throw new Error('The NPSSO token is 64 letters and numbers. Copy just that value.');
  const q = new URLSearchParams({ access_type: 'offline', client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE });
  const res = await request(`${AUTH}/authorize?${q}`, { headers: { Cookie: `npsso=${m[0]}` }, redirect: 'manual' });
  const loc = res.headers.get('location') || '';
  if (!loc.includes('?code=')) {
    throw new Error('PlayStation did not accept that NPSSO token. It may have expired: sign in again and copy a fresh one.');
  }
  const code = new URLSearchParams(loc.split('redirect/')[1]).get('code');
  const tokens = await tokenRequest({ code, redirect_uri: REDIRECT, grant_type: 'authorization_code', token_format: 'jwt' });

  let name = 'PlayStation account';
  try {
    const r = await api(tokens.accessToken, 'https://m.np.playstation.com/api/userProfile/v1/internal/users/me/profiles');
    if (r.onlineId) name = r.onlineId;
  } catch { /* the name is only cosmetic */ }
  return { ...tokens, name };
}

async function api(accessToken, url) {
  const { body } = await json(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  if (body.error) throw new Error(`PlayStation error: ${body.error.message || 'request refused'}`);
  return body;
}

function durationToMinutes(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(d || '');
  if (!m) return null;
  return Math.round((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + (+m[4] || 0) / 60);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, '');

async function sync(account) {
  let accountPatch = null;
  let accessToken = account.accessToken;
  if (!accessToken || Date.now() > (account.accessExpiresAt || 0) - 60000) {
    let tokens;
    try {
      tokens = await tokenRequest({ refresh_token: account.refreshToken, grant_type: 'refresh_token', token_format: 'jwt', scope: SCOPE });
    } catch (e) {
      throw new Error('PlayStation sign-in has expired. Unlink and link the account again with a fresh NPSSO token.');
    }
    accountPatch = tokens;
    accessToken = tokens.accessToken;
  }

  const played = [];
  for (let offset = 0; offset < 5000;) {
    const r = await api(accessToken, `https://m.np.playstation.com/api/gamelist/v2/users/me/titles?categories=ps4_game,ps5_native_game,pspc_game,unknown&limit=200&offset=${offset}`);
    const batch = r.titles || [];
    played.push(...batch);
    offset += batch.length;
    if (!batch.length || offset >= (r.totalItemCount || 0)) break;
  }

  const trophyTitles = [];
  for (let offset = 0; offset < 5000;) {
    const r = await api(accessToken, `https://m.np.playstation.com/api/trophy/v1/users/me/trophyTitles?limit=800&offset=${offset}`);
    const batch = r.trophyTitles || [];
    trophyTitles.push(...batch);
    offset += batch.length;
    if (!batch.length || offset >= (r.totalItemCount || 0)) break;
  }

  const sum = (o) => (o ? (o.bronze || 0) + (o.silver || 0) + (o.gold || 0) + (o.platinum || 0) : 0);

  // PlayStation keeps play time and trophies in separate lists with no shared ID,
  // so they are paired up by game name.
  const byName = new Map();
  for (const t of played) {
    const key = norm(t.name);
    const g = byName.get(key);
    const minutes = durationToMinutes(t.playDuration) || 0;
    if (g) {
      // Same game on PS4 and PS5: add the time together.
      g.minutes += minutes;
      if ((t.lastPlayedDateTime || '') > (g.lastPlayed || '')) g.lastPlayed = t.lastPlayedDateTime;
      if (t.firstPlayedDateTime && (!g.firstPlayed || t.firstPlayedDateTime < g.firstPlayed)) g.firstPlayed = t.firstPlayedDateTime;
    } else {
      byName.set(key, {
        id: t.titleId, name: t.name, minutes, achUnlocked: null, achTotal: null,
        firstPlayed: t.firstPlayedDateTime || null,
        lastPlayed: t.lastPlayedDateTime || null, image: t.imageUrl || null,
      });
    }
  }
  for (const t of trophyTitles) {
    const key = norm(t.trophyTitleName);
    let g = byName.get(key);
    if (!g) {
      // Trophies with no play time on record (PS3 / Vita games, mostly).
      g = { id: t.npCommunicationId, name: t.trophyTitleName, minutes: null, achUnlocked: null, achTotal: null,
        lastPlayed: t.lastUpdatedDateTime || null, image: t.trophyTitleIconUrl || null };
      byName.set(key, g);
    }
    g.achUnlocked = (g.achUnlocked || 0) + sum(t.earnedTrophies);
    g.achTotal = (g.achTotal || 0) + sum(t.definedTrophies);
  }

  return { games: [...byName.values()], notes: [], accountPatch };
}

module.exports = { link, sync };
