// Nintendo: no public API. This reads the play history that Nintendo's own "My Nintendo"
// app shows, signing in the way that app does (the approach used by several open-source
// tools). The user signs in on Nintendo's site and pastes the link behind the
// "Select this account" button; their password never comes here.
// Nintendo has no achievements, so only play time and dates are available.
const crypto = require('crypto');
const { json } = require('../http');

const CLIENT_ID = '5c38e31cd085304b';
const UA = 'com.nintendo.znej/1.13.0 (Android/7.1.2)';
const ACCOUNTS = 'https://accounts.nintendo.com/connect/1.0.0';

// Each sign-in attempt needs its own secret "verifier"; it stays in memory until used.
let attempt = null;
function loginUrl() {
  if (!attempt) {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const params = new URLSearchParams({
      state: crypto.randomBytes(36).toString('base64url'),
      client_id: CLIENT_ID,
      redirect_uri: `npf${CLIENT_ID}://auth`,
      scope: 'openid user user.mii user.email user.links[].id',
      response_type: 'session_token_code',
      session_token_code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      session_token_code_challenge_method: 'S256',
      theme: 'login_form',
    });
    attempt = { verifier, url: `${ACCOUNTS}/authorize?${params}` };
  }
  return attempt.url;
}

async function accessToken(sessionToken) {
  const { body } = await json(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': UA },
    body: JSON.stringify({ client_id: CLIENT_ID, session_token: sessionToken, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token' }),
  });
  if (!body.access_token) throw new Error('Nintendo did not return a sign-in token.');
  return body.access_token;
}

async function link(input) {
  const m = String(input.url || '').match(/session_token_code=([A-Za-z0-9._-]+)/);
  if (!m) throw new Error('Paste the link copied from the "Select this account" button. It starts with npf5c38e31cd085304b://auth');
  if (!attempt) loginUrl();
  let sessionToken;
  try {
    const { body } = await json(`${ACCOUNTS}/api/session_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, 'X-Platform': 'Android', 'X-ProductVersion': '2.5.0' },
      body: new URLSearchParams({ client_id: CLIENT_ID, session_token_code: m[1], session_token_code_verifier: attempt.verifier }).toString(),
    });
    sessionToken = body.session_token;
  } catch { /* handled below */ }
  if (!sessionToken) {
    attempt = null; // the next try starts from a fresh sign-in link
    throw new Error('Nintendo did not accept that link. Links work once and only with the sign-in page opened from this app: open the sign-in link again and copy a new one.');
  }
  attempt = null;

  const account = { sessionToken, name: 'Nintendo account' };
  try {
    const token = await accessToken(sessionToken);
    const { body } = await json('https://api.accounts.nintendo.com/2.0.0/users/me', { headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA } });
    if (body.nickname) account.name = body.nickname;
    if (body.createdAt) account.created = new Date(body.createdAt * 1000).toISOString();
  } catch { /* name and creation date are optional */ }
  return account;
}

async function sync(account) {
  let token;
  try {
    token = await accessToken(account.sessionToken);
  } catch (e) {
    throw new Error('Nintendo sign-in has expired. Unlink and link the account again.');
  }
  const { body } = await json('https://mypage-api.entry.nintendo.co.jp/api/v1/users/me/play_histories', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
  });

  const games = (body.playHistories || []).map((t) => ({
    id: String(t.titleId),
    name: t.titleName || `Title ${t.titleId}`,
    minutes: Number.isFinite(t.totalPlayedMinutes) ? t.totalPlayedMinutes : null,
    achUnlocked: null,
    achTotal: null,
    firstPlayed: t.firstPlayedAt || null,
    lastPlayed: t.lastPlayedAt || null,
    daysPlayed: t.totalPlayedDays ?? null,
    device: t.deviceType || null,
    image: t.imageUrl || null,
  }));

  // Nintendo also reports exact minutes per game for recent days; the app's daily log uses these directly.
  const daily = [];
  for (const d of body.recentPlayHistories || []) {
    const date = String(d.playedDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const t of d.dailyPlayHistories || []) {
      if (t.totalPlayedMinutes > 0) daily.push({ date, id: String(t.titleId), minutes: t.totalPlayedMinutes });
    }
  }
  return { games, notes: [], daily };
}

module.exports = { link, sync, loginUrl };
