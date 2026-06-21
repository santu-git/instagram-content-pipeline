'use strict';

require('dotenv').config();
const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

async function generatePost(carouselJson) {
  const {
    DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT,
    DO_SPACES_BUCKET, DO_SPACES_CDN_URL,
    DB_PATH = './data/instagram-pipeline.db',
    PORT = 3000,
    NODE_APP_BASE_URL,
  } = process.env;

  if (!carouselJson.id) carouselJson.id = uuidv4();
  const { id, template, topic, category, tag, handle, caption, hashtags, slides } = carouselJson;

  if (!template || !slides?.length) {
    throw new Error('carousel_json must include template and slides');
  }

  // 1. Render PNGs
  const outputDir = path.resolve('output', 'posts', id);
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const filenames = [];

  try {
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const slideNum = i + 1;
      const tplPath = path.resolve('templates', template, `${slide.type}.html`);

      if (!fs.existsSync(tplPath)) throw new Error(`Template not found: ${tplPath}`);

      const ctx = { tag, handle, ...slide };
      // Normalise legacy body string → body_text so templates can use {{#each body}} cleanly
      if (typeof ctx.body === 'string') { ctx.body_text = ctx.body; delete ctx.body; }
      const html = Handlebars.compile(fs.readFileSync(tplPath, 'utf8'))(ctx);
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const filename = `${template}-${slide.type}-${slideNum}.png`;
      await page.screenshot({ path: path.join(outputDir, filename), fullPage: false });
      await page.close();
      filenames.push(filename);
    }
  } finally {
    await browser.close();
  }

  // 2. Upload to Spaces
  const s3 = new S3Client({
    endpoint: DO_SPACES_ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: DO_SPACES_KEY, secretAccessKey: DO_SPACES_SECRET },
    forcePathStyle: false,
  });

  const cdnBase = (DO_SPACES_CDN_URL || '').replace(/\/$/, '');
  const spacesFolder = `posts/${id}`;

  for (const filename of filenames) {
    await s3.send(new PutObjectCommand({
      Bucket: DO_SPACES_BUCKET,
      Key: `${spacesFolder}/${filename}`,
      Body: fs.readFileSync(path.join(outputDir, filename)),
      ContentType: 'image/png',
      ACL: 'public-read',
    }));
  }

  // Clean up local PNGs after successful upload
  fs.rmSync(outputDir, { recursive: true, force: true });

  // 3. Save to SQLite — include slides_json explicitly so INSERT OR REPLACE
  // (which deletes then re-inserts) doesn't wipe it
  const db = new Database(path.resolve(DB_PATH));
  db.prepare(`
    INSERT OR REPLACE INTO scheduled_posts
      (id, topic, template, category, status, spaces_folder, slides_json, caption, hashtags, created_at)
    VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, datetime('now'))
  `).run(id, topic || null, template, category || null, spacesFolder, JSON.stringify(carouselJson), caption || null, hashtags || null);
  db.close();

  const baseUrl = (NODE_APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  return {
    id,
    preview_url: `${baseUrl}/preview/${id}`,
    slide_count: slides.length,
    template,
    topic: topic || null,
  };
}

module.exports = { generatePost };
