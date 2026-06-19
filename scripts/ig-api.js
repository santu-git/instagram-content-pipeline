'use strict';

const IG_API = 'https://graph.facebook.com/v25.0';
const FETCH_TIMEOUT_MS = 30_000;

async function withTimeout(promise, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(timeout);
  }
}

async function igPost(path, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token });
  let res;
  try {
    res = await withTimeout(
      fetch(`${IG_API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
      FETCH_TIMEOUT_MS
    );
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Instagram API request timeout after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new Error(`Instagram API network error: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`Instagram API HTTP ${res.status}: ${await res.text().catch(() => '(no body)')}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`Instagram API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

async function igGet(path, params, token) {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  let res;
  try {
    res = await withTimeout(
      fetch(`${IG_API}${path}?${qs}`),
      FETCH_TIMEOUT_MS
    );
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Instagram API request timeout after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new Error(`Instagram API network error: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`Instagram API HTTP ${res.status}: ${await res.text().catch(() => '(no body)')}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`Instagram API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

module.exports = { igGet, igPost };
