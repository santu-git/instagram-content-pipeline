'use strict';

require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { generatePost } = require('./generate');
const { publishNow, schedulePost, cancelScheduled } = require('./publish');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/instagram-pipeline.db';

const app = express();
app.use(express.json());
app.use(express.static(path.resolve('preview-ui'), { index: false }));

const s3 = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
  forcePathStyle: false,
});

function getDb() {
  return new Database(path.resolve(DB_PATH));
}

function initDb() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id TEXT PRIMARY KEY,
      topic TEXT,
      template TEXT,
      instagram_container_id TEXT,
      scheduled_time DATETIME,
      status TEXT,
      caption TEXT,
      hashtags TEXT,
      spaces_folder TEXT,
      created_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS published_posts (
      id TEXT PRIMARY KEY,
      topic TEXT,
      template TEXT,
      instagram_post_id TEXT,
      instagram_permalink TEXT,
      published_at DATETIME,
      likes INTEGER,
      comments INTEGER,
      saves INTEGER,
      reach INTEGER,
      impressions INTEGER,
      stats_fetched_at DATETIME
    );
  `);
  try { db.exec(`ALTER TABLE scheduled_posts ADD COLUMN slides_json TEXT`); } catch {}
  db.close();
}

// ── Timezone helpers ─────────────────────────────────────────────────────────

// datetime-local inputs submit YYYY-MM-DDTHH:mm with no timezone.
// Append +05:30 so SQLite datetime() treats the value as IST, not UTC.
function normalizeToIST(isoStr) {
  if (!isoStr) return null;
  if (isoStr.includes('+') || isoStr.endsWith('Z')) return isoStr;
  const withSeconds = isoStr.length === 16 ? isoStr + ':00' : isoStr;
  return withSeconds + '+05:30';
}

// ── Schedule suggestion ──────────────────────────────────────────────────────

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const OPTIMAL_SLOTS = {
  0: [],
  1: [[16, 30, 'Monday afternoon']],
  2: [[16, 30, 'Tuesday afternoon']],
  3: [[16, 30, 'Wednesday afternoon']],
  4: [[16, 30, 'Thursday afternoon']],
  5: [[16, 30, 'Friday afternoon']],
  6: [],
};

function suggestScheduleTime(scheduledPosts) {
  const now = new Date();
  const minSlotTime = now.getTime() + 10 * 60 * 1000;
  const twoHours = 2 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const pad = n => String(n).padStart(2, '0');

  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    const midnightIST_UTC = Date.UTC(
      istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + dayOffset
    ) - IST_OFFSET_MS;
    const dow = new Date(midnightIST_UTC + IST_OFFSET_MS).getUTCDay();

    for (const [hour, min, label] of (OPTIMAL_SLOTS[dow] || [])) {
      const slotUTC = midnightIST_UTC + (hour * 60 + min) * 60 * 1000;
      if (slotUTC < minSlotTime) continue;

      const conflict = scheduledPosts.some(p => {
        if (!p.scheduled_time) return false;
        return Math.abs(new Date(p.scheduled_time).getTime() - slotUTC) < twoHours;
      });

      if (!conflict) {
        const d = new Date(midnightIST_UTC + IST_OFFSET_MS);
        return {
          suggested_time: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(hour)}:${pad(min)}:00+05:30`,
          reason: label,
        };
      }
    }
  }
  return null;
}

// Dashboard — list of all posts
app.get('/', (req, res) => {
  res.sendFile(path.resolve('preview-ui', 'list.html'));
});

// API — all posts ordered newest first
app.get('/api/posts', (req, res) => {
  const db = getDb();
  const posts = db.prepare('SELECT * FROM scheduled_posts ORDER BY created_at DESC').all();
  db.close();
  res.json(posts);
});

// Serve preview UI for any post ID
app.get('/preview/:id', (req, res) => {
  res.sendFile(path.resolve('preview-ui', 'index.html'));
});

// Serve draft review UI
app.get('/review/:id', (req, res) => {
  res.sendFile(path.resolve('preview-ui', 'review.html'));
});

// Return post data + Spaces image URLs
app.get('/api/post/:id', async (req, res) => {
  const { id } = req.params;

  const db = getDb();
  const post = db.prepare(`
    SELECT sp.*, pp.published_at
    FROM scheduled_posts sp
    LEFT JOIN published_posts pp ON pp.id = sp.id
    WHERE sp.id = ?
  `).get(id);
  db.close();

  if (!post) {
    return res.status(404).json({ error: `Post "${id}" not found in database` });
  }

  let imageUrls = [];
  try {
    const cdnBase = (process.env.DO_SPACES_CDN_URL || '').replace(/\/$/, '');
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.DO_SPACES_BUCKET,
      Prefix: `${post.spaces_folder}/`,
    }));

    if (result.Contents) {
      imageUrls = result.Contents
        .map(obj => obj.Key)
        .filter(key => key.endsWith('.png'))
        .sort((a, b) => {
          const n = k => parseInt(k.match(/-(\d+)\.png$/)?.[1] ?? '0');
          return n(a) - n(b);
        })
        .map(key => `${cdnBase}/${key}`);
    }
  } catch (err) {
    console.error('Spaces list error:', err.message);
  }

  res.json({ ...post, image_urls: imageUrls });
});

// Update slides_json on an existing draft — used by Save JSON button
app.patch('/api/draft/:id', (req, res) => {
  const { slides_json } = req.body;
  if (!slides_json) return res.status(400).json({ error: 'slides_json is required' });
  const db = getDb();
  const result = db.prepare(`UPDATE scheduled_posts SET slides_json = ? WHERE id = ? AND status = 'draft'`).run(slides_json, req.params.id);
  db.close();
  if (result.changes === 0) return res.status(404).json({ error: 'Draft not found' });
  res.json({ id: req.params.id, status: 'saved' });
});

// Save carousel as draft (no rendering) — used by draft_carousel MCP tool
app.post('/api/draft', (req, res) => {
  const carousel = req.body;
  if (!carousel?.template || !carousel?.slides) {
    return res.status(400).json({ error: 'carousel_json must include template and slides' });
  }
  if (!carousel.id) carousel.id = require('crypto').randomUUID();

  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO scheduled_posts
      (id, topic, template, status, slides_json, created_at)
    VALUES (?, ?, ?, 'draft', ?, datetime('now'))
  `).run(carousel.id, carousel.topic || null, carousel.template, JSON.stringify(carousel));
  db.close();

  res.json({
    id: carousel.id,
    status: 'draft',
    preview_url: `${req.protocol}://${req.get('host')}/review/${carousel.id}`,
  });
});

// Render a single slide to HTML (no Puppeteer) — used by live preview iframe
app.post('/api/preview-html', (req, res) => {
  const { slides_json, slide_index = 0 } = req.body;
  const fs = require('fs');
  const Handlebars = require('handlebars');
  try {
    const carousel = JSON.parse(slides_json);
    const slide = carousel.slides?.[slide_index];
    if (!slide) return res.status(400).send('<p style="color:red;padding:20px">Slide not found</p>');

    const templatePath = path.resolve('templates', carousel.template, `${slide.type}.html`);
    const source = fs.readFileSync(templatePath, 'utf8');
    const ctx = { ...carousel, ...slide };
    if (typeof ctx.body === 'string') { ctx.body_text = ctx.body; delete ctx.body; }
    let html = Handlebars.compile(source)(ctx);
    // Scale and center the 1080×1080 template inside the preview iframe
    html = html.replace('</body>', `
<style>html,body{margin:0;padding:0;overflow:hidden;}</style>
<script>(function(){
  var s=Math.min(window.innerWidth/1080,window.innerHeight/1080);
  var dx=(window.innerWidth-1080*s)/2;
  var dy=(window.innerHeight-1080*s)/2;
  document.body.style.cssText='position:fixed;left:'+dx+'px;top:'+dy+'px;transform:scale('+s+');transform-origin:top left;width:1080px;height:1080px;overflow:hidden;';
})();</script>
</body>`);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(400).send(`<pre style="color:red;padding:20px;font-family:monospace">${err.message}</pre>`);
  }
});

// Render draft to PNGs + upload — triggered from the portal Render button
app.post('/api/render/:id', async (req, res) => {
  const db = getDb();
  const post = db.prepare('SELECT slides_json FROM scheduled_posts WHERE id = ?').get(req.params.id);
  db.close();

  if (!post?.slides_json) return res.status(404).json({ error: 'Draft not found or missing JSON' });

  try {
    const carousel = req.body?.slides_json
      ? JSON.parse(req.body.slides_json)
      : JSON.parse(post.slides_json);
    carousel.id = req.params.id;

    const result = await generatePost(carousel);
    result.preview_url = `${req.protocol}://${req.get('host')}/preview/${result.id}`;
    res.json(result);
  } catch (err) {
    console.error('Render failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate carousel: render + upload + save in one call (used by MCP)
app.post('/api/generate', async (req, res) => {
  const carouselJson = req.body;
  if (!carouselJson?.template || !carouselJson?.slides) {
    return res.status(400).json({ error: 'carousel_json must include template and slides' });
  }
  try {
    const result = await generatePost(carouselJson);
    // Use actual request host so preview_url works regardless of NODE_APP_BASE_URL
    result.preview_url = `${req.protocol}://${req.get('host')}/preview/${result.id}`;
    res.json(result);
  } catch (err) {
    console.error('Generate failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Approve a post with caption, hashtags, and optional schedule time
app.post('/api/approve', (req, res) => {
  const { id, caption, hashtags, scheduled_time } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const normalizedTime = normalizeToIST(scheduled_time);
  const newStatus = normalizedTime ? 'scheduled' : 'approved';

  const db = getDb();
  const result = db.prepare(`
    UPDATE scheduled_posts
    SET status = ?, caption = ?, hashtags = ?, scheduled_time = ?
    WHERE id = ?
  `).run(newStatus, caption || null, hashtags || null, normalizedTime || null, id);
  db.close();

  if (result.changes === 0) {
    return res.status(404).json({ error: `Post "${id}" not found` });
  }

  res.json({ id, status: newStatus });
});

// Publish a post immediately to Instagram
app.post('/api/publish/:id', async (req, res) => {
  try {
    const result = await publishNow(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('Publish failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Schedule a post via Instagram native scheduling
app.post('/api/schedule', async (req, res) => {
  const { id, iso_datetime } = req.body;
  if (!id || !iso_datetime) return res.status(400).json({ error: 'id and iso_datetime are required' });
  try {
    const result = await schedulePost(id, normalizeToIST(iso_datetime));
    res.json(result);
  } catch (err) {
    console.error('Schedule failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Cancel a scheduled post
app.delete('/api/schedule/:id', async (req, res) => {
  try {
    const result = await cancelScheduled(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('Cancel failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Reject a post — marks it as rejected and clears scheduled_time
app.post('/api/reject/:id', (req, res) => {
  const db = getDb();
  const post = db.prepare('SELECT status FROM scheduled_posts WHERE id = ?').get(req.params.id);
  if (!post) { db.close(); return res.status(404).json({ error: 'Post not found' }); }
  if (post.status === 'published') { db.close(); return res.status(400).json({ error: 'Cannot reject a published post' }); }

  db.prepare(`UPDATE scheduled_posts SET status = 'rejected', scheduled_time = NULL WHERE id = ?`).run(req.params.id);
  db.close();
  res.json({ id: req.params.id, status: 'rejected' });
});

// List all scheduled posts
app.get('/api/scheduled-posts', (req, res) => {
  const db = getDb();
  const posts = db.prepare(`SELECT * FROM scheduled_posts WHERE status = 'scheduled' ORDER BY scheduled_time ASC`).all();
  db.close();
  res.json(posts);
});

// Suggest next optimal publish time (IST)
app.get('/api/suggest-schedule', (req, res) => {
  const db = getDb();
  const scheduled = db.prepare(`SELECT scheduled_time FROM scheduled_posts WHERE status = 'scheduled'`).all();
  db.close();
  const suggestion = suggestScheduleTime(scheduled);
  res.json(suggestion || { suggested_time: null, reason: 'No optimal slot found in next 14 days' });
});

// Content calendar page
app.get('/calendar', (req, res) => {
  res.sendFile(path.resolve('preview-ui', 'calendar.html'));
});

async function publishDuePosts() {
  const db = getDb();
  const due = db.prepare(`
    SELECT id FROM scheduled_posts
    WHERE status = 'scheduled' AND datetime(scheduled_time) <= datetime('now')
  `).all();

  for (const { id } of due) {
    // Atomic claim: only proceed if we flipped status from 'scheduled' → 'publishing'.
    // If two scheduler ticks run concurrently and both see the same post, SQLite
    // serialises the writes — only one gets changes=1, the other skips.
    const result = db.prepare(
      `UPDATE scheduled_posts SET status = 'publishing' WHERE id = ? AND status = 'scheduled'`
    ).run(id);

    if (result.changes === 0) {
      console.log(`[scheduler] Skipping ${id} — already being published`);
      continue;
    }

    console.log(`[scheduler] Publishing: ${id}`);
    // Fire-and-forget: publishNow marks 'publishing' again (no-op) then updates to
    // 'published' on success. On failure it stays 'publishing' — visible stuck state,
    // reset manually to 'scheduled' to retry.
    publishNow(id).catch(err => {
      console.error(`[scheduler] Failed to publish ${id}:`, err.message);
    });
  }
  db.close();
}

setInterval(publishDuePosts, 60_000);

app.listen(PORT, async () => {
  initDb();
  console.log(`Preview server running at http://localhost:${PORT}`);
  await publishDuePosts();
});
