// Small fetch helpers. Error messages never include the URL's query string,
// because Steam puts the API key there.

async function request(url, opts = {}) {
  const { timeout = 30000, ...rest } = opts;
  try {
    return await fetch(url, { ...rest, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    const host = new URL(url).host;
    const why = (e.cause && e.cause.code) || e.name || 'network error';
    throw new Error(`Could not reach ${host} (${why}).`);
  }
}

async function json(url, opts = {}) {
  const res = await request(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(`${new URL(url).host} answered with error ${res.status}.`);
    err.status = res.status;
    err.body = body;
    err.retryAfter = Number(res.headers.get('retry-after')) || 0;
    throw err;
  }
  if (body === null) {
    throw new Error(`${new URL(url).host} sent a reply that was not JSON.`);
  }
  return { body, headers: res.headers };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

module.exports = { request, json, mapLimit };
