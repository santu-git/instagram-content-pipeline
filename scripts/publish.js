'use strict';

require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const Database = require('better-sqlite3');
const path = require('path');

const IG_API = 'https://graph.facebook.com/v25.0';

function env() {
  const {
    INSTAGRAM_ACCESS_TOKEN,
    INSTAGRAM_BUSINESS_ACCOUNT_ID,
    DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT,
    DO_SPACES_BUCKET, DO_SPACES_CDN_URL,
    DB_PATH = './data/instagram-pipeline.db',
  } = process.env;

  for (const [k, v] of Object.entries({ INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID })) {
    if (!v) throw new Error(`Missing required env var: ${k}`);
  }
  return { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID, DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT, DO_SPACES_BUCKET, DO_SPACES_CDN_URL, DB_PATH };
}

// POST helper for Instagram Graph API (form-encoded)
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

// GET helper
async function igGet(path, params, token) {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  const res = await fetch(`${IG_API}${path}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(`Instagram API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

// Wait until a container's status_code is FINISHED (polls up to 30s)
async function waitForContainer(containerId, token) {
  for (let i = 0; i < 15; i++) {
    const { status_code } = await igGet(`/${containerId}`, { fields: 'status_code' }, token);
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error(`Container ${containerId} entered status: ${status_code}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Container ${containerId} did not reach FINISHED within 30s`);
}

// Get ordered Spaces CDN URLs for a post
async function getImageUrls(spacesFolder) {
  const { DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT, DO_SPACES_BUCKET, DO_SPACES_CDN_URL } = env();

  const s3 = new S3Client({
    endpoint: DO_SPACES_ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: DO_SPACES_KEY, secretAccessKey: DO_SPACES_SECRET },
    forcePathStyle: false,
  });

  const result = await s3.send(new ListObjectsV2Command({
    Bucket: DO_SPACES_BUCKET,
    Prefix: `${spacesFolder}/`,
  }));

  if (!result.Contents?.length) throw new Error(`No files found in Spaces at ${spacesFolder}/`);

  const cdnBase = DO_SPACES_CDN_URL.replace(/\/$/, '');
  return result.Contents
    .map(o => o.Key)
    .filter(k => k.endsWith('.png'))
    .sort((a, b) => {
      const n = k => parseInt(k.match(/-(\d+)\.png$/)?.[1] ?? '0');
      return n(a) - n(b);
    })
    .map(k => `${cdnBase}/${k}`);
}

// Build the full caption string (caption + hashtags)
function buildCaption(post) {
  const parts = [];
  if (post.caption) parts.push(post.caption.trim());
  if (post.hashtags) parts.push(post.hashtags.trim());
  return parts.join('\n\n');
}

// Steps A + B: create all item containers then the carousel container
async function buildCarouselContainer(post, token, accountId, extraParams = {}) {
  const imageUrls = await getImageUrls(post.spaces_folder);
  if (imageUrls.length < 2) throw new Error('Instagram carousels require at least 2 images');
  if (imageUrls.length > 10) throw new Error('Instagram carousels support max 10 images');

  console.log(`  Creating ${imageUrls.length} carousel item containers...`);

  // Step A: create a container for each image
  const itemIds = [];
  for (const url of imageUrls) {
    const item = await igPost(`/${accountId}/media`, { image_url: url, is_carousel_item: 'true' }, token);
    await waitForContainer(item.id, token);
    itemIds.push(item.id);
    console.log(`    ✓ item container: ${item.id}`);
  }

  // Step B: create carousel container and wait for it to finish processing
  console.log('  Creating carousel container...');
  const carousel = await igPost(`/${accountId}/media`, {
    media_type: 'CAROUSEL',
    children: itemIds.join(','),
    caption: buildCaption(post),
    ...extraParams,
  }, token);

  await waitForContainer(carousel.id, token);
  console.log(`  ✓ carousel container: ${carousel.id}`);
  return carousel.id;
}

// publishNow — render + upload must be done before calling this
async function publishNow(postId) {
  const { INSTAGRAM_ACCESS_TOKEN: token, INSTAGRAM_BUSINESS_ACCOUNT_ID: accountId, DB_PATH } = env();
  const db = new Database(path.resolve(DB_PATH));

  const post = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(postId);
  if (!post) throw new Error(`Post "${postId}" not found in database`);
  if (!post.spaces_folder) throw new Error(`Post "${postId}" has no Spaces folder — run upload first`);

  console.log(`Publishing "${post.topic || postId}"...`);

  // Steps A + B
  const containerId = await buildCarouselContainer(post, token, accountId);

  // Step C: publish
  console.log('  Publishing...');
  const published = await igPost(`/${accountId}/media_publish`, { creation_id: containerId }, token);
  const instagramPostId = published.id;

  // Get permalink
  const { permalink } = await igGet(`/${instagramPostId}`, { fields: 'permalink' }, token);

  // Update DB
  db.prepare(`
    UPDATE scheduled_posts SET status = 'published', instagram_container_id = ? WHERE id = ?
  `).run(containerId, postId);

  db.prepare(`
    INSERT OR REPLACE INTO published_posts
      (id, topic, template, instagram_post_id, instagram_permalink, published_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(postId, post.topic, post.template, instagramPostId, permalink);

  db.close();

  console.log(`  ✓ Published: ${permalink}`);
  return { instagram_post_id: instagramPostId, permalink, status: 'published' };
}

// schedulePost — saves publish time to DB; preview-server scheduler publishes at the right time
async function schedulePost(postId, isoDatetime) {
  const { DB_PATH } = env();
  const db = new Database(path.resolve(DB_PATH));

  const post = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(postId);
  if (!post) throw new Error(`Post "${postId}" not found in database`);
  if (!post.spaces_folder) throw new Error(`Post "${postId}" has no Spaces folder — run upload first`);

  const scheduledDate = new Date(isoDatetime);
  if (isNaN(scheduledDate.getTime())) throw new Error('Invalid ISO datetime');
  if (scheduledDate.getTime() < Date.now() + 600_000) {
    throw new Error('Scheduled time must be at least 10 minutes in the future');
  }

  db.prepare(`
    UPDATE scheduled_posts
    SET status = 'scheduled', scheduled_time = ?, instagram_container_id = NULL
    WHERE id = ?
  `).run(isoDatetime, postId);

  db.close();

  console.log(`  ✓ Queued "${post.topic || postId}" for ${isoDatetime}`);
  return { publish_time: isoDatetime, status: 'scheduled' };
}

// getPostStatus — check a container's processing status
async function getPostStatus(instagramContainerId) {
  const { INSTAGRAM_ACCESS_TOKEN: token } = env();
  const data = await igGet(`/${instagramContainerId}`, { fields: 'status_code,status' }, token);
  return { container_id: instagramContainerId, status_code: data.status_code, status: data.status };
}

// cancelScheduled — delete container from Instagram + update DB
async function cancelScheduled(postId) {
  const { INSTAGRAM_ACCESS_TOKEN: token, DB_PATH } = env();
  const db = new Database(path.resolve(DB_PATH));

  const post = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(postId);
  if (!post) throw new Error(`Post "${postId}" not found`);
  if (post.status !== 'scheduled') throw new Error(`Post "${postId}" is not scheduled (status: ${post.status})`);

  if (post.instagram_container_id) {
    const res = await fetch(`${IG_API}/${post.instagram_container_id}?access_token=${token}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) console.warn('Instagram delete warning:', data.error.message);
  }

  db.prepare(`UPDATE scheduled_posts SET status = 'cancelled', instagram_container_id = NULL WHERE id = ?`).run(postId);
  db.close();

  return { id: postId, status: 'cancelled' };
}

module.exports = { publishNow, schedulePost, getPostStatus, cancelScheduled };
