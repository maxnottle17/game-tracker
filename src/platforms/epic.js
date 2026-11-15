// Epic Games: no public API. This signs in the way the Epic launcher does (the same
// approach as the open-source Legendary launcher). The user signs in on Epic's own
// site and pastes a one-time code; their password never comes here.
// The play time endpoint is undocumented, so it is the most likely part to break.
const { json, mapLimit } = require('../http');

const CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a';
const CLIENT_SECRET = 'daafbccc737745039dffe53d94fc76cf';
const BASIC = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
const UA = 'UELauncher/11.0.1-14907503+++Portal+Release-Live Windows/10.0.19041.1.256.64bit';
const STORE_UA = 'EpicGamesLauncher/14.0.8-22004686+++Portal+Release-Live';

const OAUTH = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token';
const LIBRARY = 'https://library-service.live.use1a.on.epicgames.com/library/api/public';
const CATALOG = 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared';
const GQL = 'https://launcher.store.epicgames.com/graphql';

const LOGIN_URL = 'https://www.epicgames.com/id/login?redirectUrl='
  + encodeURIComponent(`https://www.epicgames.com/id/api/redirect?clientId=${CLIENT_ID}&responseType=code`);

async function session(form) {
  const { body } = await json(OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: BASIC, 'User-Agent': UA },
    body: new URLSearchParams({ ...form, token_type: 'eg1' }).toString(),
  });
  if (body.errorCode || !body.access_token) throw new Error('Epic refused the sign-in.');
  return {
    accessToken: body.access_token,
    accessExpiresAt: Date.parse(body.expires_at) || Date.now() + 3600e3,
    refreshToken: body.refresh_token,
    refreshExpiresAt: Date.parse(body.refresh_expires_at) || 0,
    accountId: body.account_id,
    name: body.displayName || 'Epic account',
  };
}

async function link(input) {
  const raw = String(input.code || '');
  const m = raw.match(/"authorizationCode"\s*:\s*"([0-9a-f]{32})"/i) || raw.match(/\b([0-9a-f]{32})\b/i);
  if (!m) throw new Error('The Epic code is 32 letters and numbers (the "authorizationCode" value).');
  try {
    return await session({ grant_type: 'authorization_code', code: m[1] });
  } catch (e) {
    throw new Error('Epic did not accept that code. Codes only work once and expire in a few minutes: get a fresh one.');
  }
}

const get = (token, url) => json(url, { headers: { Authorization: `bearer ${token}`, 'User-Agent': UA } }).then((r) => r.body);

async function gql(token, query, variables) {
  const { body } = await json(GQL, {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'User-Agent': STORE_UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (body.errors && !body.data) throw new Error('Epic store query failed.');
  return body.data || {};
}

const Q_TOTAL = `query Achievement($sandboxId: String!, $locale: String!) {
  Achievement { productAchievementsRecordBySandbox(sandboxId: $sandboxId, locale: $locale) { totalAchievements } } }`;
const Q_USER = `query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) {
  PlayerAchievement { playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) { records { totalUnlocked } } } }`;

function pickImage(keyImages) {
  const order = ['DieselGameBox', 'OfferImageWide', 'DieselGameBoxTall', 'Thumbnail'];
  for (const type of order) {
    const hit = (keyImages || []).find((k) => k.type === type && k.url);
    if (hit) return hit.url;
  }
  return null;
}

async function sync(account, cache) {
  let accountPatch = null;
  let token = account.accessToken;
  if (!token || Date.now() > (account.accessExpiresAt || 0) - 60000) {
    let s;
    try {
      s = await session({ grant_type: 'refresh_token', refresh_token: account.refreshToken });
    } catch (e) {
      throw new Error('Epic sign-in has expired. Unlink and link the account again with a fresh code.');
    }
    accountPatch = s; // Epic issues a new refresh token every time; it must be saved.
    token = s.accessToken;
  }
  const accountId = (accountPatch || account).accountId;

  let playtime;
  try {
    playtime = await get(token, `${LIBRARY}/playtime/account/${accountId}/all`);
  } catch (e) {
    const err = new Error(`Epic's play time service did not answer as expected (${e.message}) Epic has no official API for this, so it may have changed.`);
    err.accountPatch = accountPatch;
    throw err;
  }
  if (!Array.isArray(playtime)) playtime = [];

  // The play time list only has internal app names; the library maps them to games.
  const records = [];
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const r = await get(token, `${LIBRARY}/items?includeMetadata=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    records.push(...(r.records || []));
    cursor = r.responseMetadata && r.responseMetadata.nextCursor;
    if (!cursor) break;
  }
  const byApp = new Map(records.map((r) => [r.appName, r]));

  const info = cache.info || (cache.info = {});   // appName -> { name, image }
  const ach = cache.ach || (cache.ach = {});      // appName -> { seconds, unlocked, total }
  const notes = [];
  let unnamed = 0;
  let achFailed = 0;

  const timed = playtime.filter((p) => p.totalTime > 0 && p.artifactId);
  const rows = await mapLimit(timed, 3, async (p) => {
    const rec = byApp.get(p.artifactId);
    if (!rec) { unnamed++; return null; }

    if (!info[p.artifactId]) {
      try {
        const r = await get(token, `${CATALOG}/namespace/${rec.namespace}/bulk/items?id=${rec.catalogItemId}&includeDLCDetails=false&includeMainGameDetails=true&country=US&locale=en`);
        const item = r[rec.catalogItemId];
        if (item && item.title) info[p.artifactId] = { name: item.title, image: pickImage(item.keyImages) };
      } catch { /* retried next sync */ }
    }
    const meta = info[p.artifactId];
    if (!meta) { unnamed++; return null; }

    const known = ach[p.artifactId];
    if (!known || known.seconds !== p.totalTime) {
      try {
        const t = await gql(token, Q_TOTAL, { sandboxId: rec.namespace, locale: 'en' });
        const total = (t.Achievement && t.Achievement.productAchievementsRecordBySandbox
          && t.Achievement.productAchievementsRecordBySandbox.totalAchievements) || 0;
        let unlocked = 0;
        if (total) {
          const u = await gql(token, Q_USER, { epicAccountId: accountId, sandboxId: rec.namespace });
          const recs = (u.PlayerAchievement && u.PlayerAchievement.playerAchievementGameRecordsBySandbox
            && u.PlayerAchievement.playerAchievementGameRecordsBySandbox.records) || [];
          unlocked = recs.reduce((n, x) => n + (x.totalUnlocked || 0), 0);
        }
        ach[p.artifactId] = { seconds: p.totalTime, unlocked, total };
      } catch {
        achFailed++;
      }
    }
    const a = ach[p.artifactId];
    return {
      id: p.artifactId,
      name: meta.name,
      minutes: Math.round(p.totalTime / 60),
      achUnlocked: a ? a.unlocked : null,
      achTotal: a ? a.total : null,
      lastPlayed: null, // Epic does not report this.
      image: meta.image,
    };
  });

  if (unnamed) notes.push(`${unnamed} played item(s) could not be matched to a game name and were left out.`);
  if (achFailed) notes.push(`Achievements could not be read for ${achFailed} game(s). Epic's achievement data is unofficial and often unavailable.`);
  return { games: rows.filter(Boolean), notes, accountPatch };
}

module.exports = { link, sync, LOGIN_URL };
