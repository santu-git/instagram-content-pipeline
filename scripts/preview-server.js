'use strict';

require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
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

// Return post data + Spaces image URLs
app.get('/api/post/:id', async (req, res) => {
  const { id } = req.params;

  const db = getDb();
  const post = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(id);
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

// Approve a post with caption, hashtags, and optional schedule time
app.post('/api/approve', (req, res) => {
  const { id, caption, hashtags, scheduled_time } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const db = getDb();
  const result = db.prepare(`
    UPDATE scheduled_posts
    SET status = 'approved', caption = ?, hashtags = ?, scheduled_time = ?
    WHERE id = ?
  `).run(caption || null, hashtags || null, scheduled_time || null, id);
  db.close();

  if (result.changes === 0) {
    return res.status(404).json({ error: `Post "${id}" not found` });
  }

  res.json({ id, status: 'approved' });
});

app.listen(PORT, () => {
  console.log(`Preview server running at http://localhost:${PORT}`);
  console.log(`Open a post: http://localhost:${PORT}/preview/{post-id}`);
});
