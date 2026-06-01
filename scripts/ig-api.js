'use strict';

const IG_API = 'https://graph.facebook.com/v25.0';

async function igPost(path, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${IG_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Instagram API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

async function igGet(path, params, token) {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  const res = await fetch(`${IG_API}${path}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(`Instagram API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

module.exports = { igGet, igPost };
